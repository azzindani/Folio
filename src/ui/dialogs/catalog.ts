/**
 * Folio Catalog — full-screen dialog for browsing Templates, Themes, and
 * Reports at scale (thousands of entries).
 *
 * Architecture for scale:
 *   - Index-driven: browse uses a small metadata JSON (loadCatalogIndex),
 *     full TemplateSpec is fetched lazily only for the selected card.
 *   - Virtualized cards: content-visibility: auto + IntersectionObserver
 *     hydrate thumbnails on viewport entry. Off-screen cards cost ~nothing.
 *   - Search + tag filter: live-filter the index, re-render visible window.
 *
 * Composition model unchanged: a "selection" is { templateId, themeId },
 * orthogonal axes joined via injectIntoTemplate + theme.ref override.
 */

import {
  loadCatalogIndex,
  loadFullTemplate,
  findIndexEntry,
  peekTemplate,
  type CatalogIndexEntry,
} from '../../templates/builtin-loader';
import { loadThemeCatalog, type ThemeCardData, getThemeById } from '../../templates/theme-registry';
import { injectIntoTemplate, type TemplateSpec } from '../../schema/template';
import { serializeYAML } from '../../schema/parser';
import { renderDesign } from '../../renderer/renderer';
import type { DesignSpec, PaletteSpec, TypePackSpec, EffectsPackSpec } from '../../schema/types';
import { BUILTIN_THEMES } from '../../themes/builtin';
import { FEATURED_COMBOS, type FeaturedCombo } from './catalog-combos';
import {
  loadPaletteIndex, loadFullPalette, type PaletteIndexEntry,
} from '../../styles/palette-loader';
import {
  loadTypePackIndex, loadFullTypePack, type TypePackIndexEntry,
} from '../../styles/type-pack-loader';
import {
  loadEffectsPackIndex, loadFullEffectsPack, type EffectsPackIndexEntry,
} from '../../styles/effects-pack-loader';
import { composeTheme } from '../../styles/compose';

type Tab = 'templates' | 'themes' | 'palettes' | 'type' | 'effects' | 'reports' | 'featured';

/**
 * The catalog picks four orthogonal axes; the editor needs all of them to
 * fully restore what the user previewed in the rail. Each pack is the
 * fully-resolved spec, not just an id, because the loaders cache them and
 * the editor would otherwise have to re-fetch.
 */
export interface CatalogPicks {
  palette?:     PaletteSpec;
  typePack?:    TypePackSpec;
  effectsPack?: EffectsPackSpec;
}

interface OpenCallbacks {
  onOpen:   (design: DesignSpec, label: string, picks?: CatalogPicks) => void;
  onToast?: (msg: string, kind: 'success' | 'error') => void;
}

interface FilterState {
  search: string;
  tag:    string | null;
}

export class CatalogDialog {
  private overlay: HTMLElement | null = null;
  private cb: OpenCallbacks | null = null;
  private tab: Tab = 'templates';
  private selectedTemplateId:    string | null = null;
  private selectedThemeId:       string | null = null;
  private selectedPaletteId:     string | null = null;
  private selectedTypePackId:    string | null = null;
  private selectedEffectsPackId: string | null = null;
  private index:        CatalogIndexEntry[]     = [];
  private themes:       ThemeCardData[]         = [];
  private palettes:     PaletteIndexEntry[]     = [];
  private typePacks:    TypePackIndexEntry[]    = [];
  private effectsPacks: EffectsPackIndexEntry[] = [];
  // Style overlay picks resolved lazily — full specs only fetched on demand
  // so opening the dialog doesn't trigger N parallel YAML fetches.
  private resolvedPalette:     PaletteSpec     | undefined;
  private resolvedTypePack:    TypePackSpec    | undefined;
  private resolvedEffectsPack: EffectsPackSpec | undefined;
  private filter: FilterState = { search: '', tag: null };
  private io: IntersectionObserver | null = null;
  private thumbCache = new Map<string, string>();

  async open(cb: OpenCallbacks): Promise<void> {
    this.close();
    this.cb = cb;
    this.themes = loadThemeCatalog();
    this.tab = 'templates';
    this.filter = { search: '', tag: null };
    this.resolvedPalette = this.resolvedTypePack = this.resolvedEffectsPack = undefined;

    // Render shell synchronously with a loading placeholder so the
    // dialog appears instantly; fill in cards once the index resolves.
    this.overlay = document.createElement('div');
    this.overlay.className = 'dialog-overlay catalog-overlay';
    this.overlay.innerHTML = this.shellHTML();
    document.body.appendChild(this.overlay);

    this.installObserver();
    this.bindShell();
    document.addEventListener('keydown', this.onKey);

    // Load all four indices in parallel — they're independent fetches and
    // sequential awaits would stall the first paint on the slowest one.
    const [tpls, pals, tps, eps] = await Promise.all([
      loadCatalogIndex(),
      loadPaletteIndex(),
      loadTypePackIndex(),
      loadEffectsPackIndex(),
    ]);
    this.index        = tpls;
    this.palettes     = pals;
    this.typePacks    = tps;
    this.effectsPacks = eps;
    this.selectedTemplateId = this.index[0]?.id ?? null;
    this.selectedThemeId    = this.themes[0]?.id ?? null;
    this.renderTab();
    void this.renderPreview();
  }

  close(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.io?.disconnect();
    this.io = null;
    document.removeEventListener('keydown', this.onKey);
    this.cb = null;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  // ── HTML scaffolding (filled in subsequent sections) ─────────

  private shellHTML(): string {
    return `
      <div class="catalog" role="dialog" aria-label="Folio Catalog">
        <div class="catalog-header">
          <h2 class="catalog-title">Folio Catalog</h2>
          <div class="catalog-tabs">
            <button class="catalog-tab active" data-tab="templates">Templates</button>
            <button class="catalog-tab"        data-tab="themes">Themes</button>
            <button class="catalog-tab"        data-tab="palettes">Palettes</button>
            <button class="catalog-tab"        data-tab="type">Type</button>
            <button class="catalog-tab"        data-tab="effects">Effects</button>
            <button class="catalog-tab"        data-tab="reports">Reports</button>
            <button class="catalog-tab"        data-tab="featured">Featured</button>
          </div>
          <button class="dialog-close" data-action="close" aria-label="Close">×</button>
        </div>
        <div class="catalog-filter" data-pane="filter">${this.filterBarHTML()}</div>
        <div class="catalog-body">
          <div class="catalog-list" data-pane="list">${this.tabHTML()}</div>
          <aside class="catalog-rail" data-pane="rail">${this.railHTML()}</aside>
        </div>
      </div>
    `;
  }

  private filterBarHTML(): string {
    // Style overlay tabs render their own simple list; templates/reports
    // share the search + tag chip bar.
    if (this.tab === 'themes' || this.tab === 'featured' ||
        this.tab === 'palettes' || this.tab === 'type' || this.tab === 'effects') return '';
    const kind = this.tab as 'templates' | 'reports';
    const tags = this.collectTags(kind);
    const chips = tags.map(tg => {
      const sel = this.filter.tag === tg ? ' selected' : '';
      return `<button class="tag-chip${sel}" data-tag="${escapeAttr(tg)}" type="button">${escapeHTML(tg)}</button>`;
    }).join('');
    const clear = this.filter.tag ? `<button class="tag-chip clear" data-tag="" type="button">clear ×</button>` : '';
    return `
      <input class="catalog-search" type="search" placeholder="Search ${kind}…"
             value="${escapeAttr(this.filter.search)}" data-input="search" />
      <div class="catalog-chips">${chips}${clear}</div>
      <span class="catalog-count" data-pane="count"></span>
    `;
  }

  private tabHTML(): string {
    switch (this.tab) {
      case 'templates': return this.renderIndexCards(this.filteredEntries('templates'));
      case 'reports':   return this.renderIndexCards(this.filteredEntries('reports'));
      case 'themes':    return `<div class="tmpl-grid theme-grid">${this.themes.map(t => this.themeCardHTML(t)).join('')}</div>`;
      case 'palettes':  return this.renderStyleCards('palettes');
      case 'type':      return this.renderStyleCards('type');
      case 'effects':   return this.renderStyleCards('effects');
      case 'featured':  return `<div class="tmpl-grid">${FEATURED_COMBOS.map(c => this.featuredCardHTML(c)).join('')}</div>`;
    }
  }

  private renderStyleCards(kind: 'palettes' | 'type' | 'effects'): string {
    if (kind === 'palettes') {
      if (!this.palettes.length) return '<p class="tmpl-empty">No palettes available.</p>';
      const cards = this.palettes.map(p => this.paletteCardHTML(p)).join('');
      return `<div class="tmpl-grid theme-grid">${this.clearStyleChip(kind)}${cards}</div>`;
    }
    if (kind === 'type') {
      if (!this.typePacks.length) return '<p class="tmpl-empty">No type packs available.</p>';
      const cards = this.typePacks.map(t => this.typePackCardHTML(t)).join('');
      return `<div class="tmpl-grid theme-grid">${this.clearStyleChip(kind)}${cards}</div>`;
    }
    if (!this.effectsPacks.length) return '<p class="tmpl-empty">No effects packs available.</p>';
    const cards = this.effectsPacks.map(e => this.effectsCardHTML(e)).join('');
    return `<div class="tmpl-grid theme-grid">${this.clearStyleChip(kind)}${cards}</div>`;
  }

  /**
   * Each style tab has a "Clear" pseudo-card so users can drop an overlay
   * without hunting through the rail. The button has no spec to load.
   */
  private clearStyleChip(kind: 'palettes' | 'type' | 'effects'): string {
    return `
      <button class="tmpl-card style-clear-card" type="button" data-style-clear="${kind}">
        <div class="theme-preview" style="background:transparent;border:2px dashed var(--color-border);display:flex;align-items:center;justify-content:center;min-height:120px">
          <span style="color:var(--color-text-muted);font-size:13px">✕ no overlay</span>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">Clear</div>
          <div class="tmpl-sub">use the theme's defaults</div>
        </div>
      </button>
    `;
  }

  private paletteCardHTML(p: PaletteIndexEntry): string {
    const tags = p.tags.slice(0, 3).map(tg =>
      `<span class="tmpl-tag">${escapeHTML(tg)}</span>`).join('');
    const selected = p.id === this.selectedPaletteId ? ' selected' : '';
    const swatches = p.swatches.slice(0, 6).map(c =>
      `<span class="theme-swatch" style="background:${c}" title="${escapeAttr(c)}"></span>`).join('');
    const bg = p.swatches[0] ?? 'var(--color-surface-2)';
    return `
      <button class="tmpl-card theme-card${selected}" data-palette-id="${escapeAttr(p.id)}" type="button">
        <div class="theme-preview" style="background:${bg};min-height:120px">
          <div class="theme-swatches">${swatches}</div>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${escapeHTML(p.name)}</div>
          <div class="tmpl-sub">${escapeHTML(p.description)}</div>
          <div class="tmpl-tags">${tags}</div>
        </div>
      </button>
    `;
  }

  private typePackCardHTML(t: TypePackIndexEntry): string {
    const tags = t.tags.slice(0, 3).map(tg =>
      `<span class="tmpl-tag">${escapeHTML(tg)}</span>`).join('');
    const selected = t.id === this.selectedTypePackId ? ' selected' : '';
    // Live-render the actual family so users see Anton vs Playfair, not a generic chip.
    const heading = escapeHTML(t.families.heading);
    const body    = escapeHTML(t.families.body);
    const mono    = escapeHTML(t.families.mono);
    return `
      <button class="tmpl-card theme-card${selected}" data-typepack-id="${escapeAttr(t.id)}" type="button">
        <div class="theme-preview" style="background:var(--color-surface-2);min-height:120px;padding:10px;display:flex;flex-direction:column;justify-content:center;gap:4px">
          <div style="font-family:'${heading}',sans-serif;font-size:28px;font-weight:800;line-height:1.05;color:var(--color-text)">Aa</div>
          <div style="font-family:'${body}',sans-serif;font-size:13px;color:var(--color-text-muted)">The quick brown fox.</div>
          <div style="font-family:'${mono}',monospace;font-size:11px;color:var(--color-text-muted)">{ mono: 0123 }</div>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${escapeHTML(t.name)}</div>
          <div class="tmpl-sub">${heading} · ${body} · ${mono}</div>
          <div class="tmpl-tags">${tags}</div>
        </div>
      </button>
    `;
  }

  private effectsCardHTML(e: EffectsPackIndexEntry): string {
    const selected = e.id === this.selectedEffectsPackId ? ' selected' : '';
    // Effect cards show effect keys (shadow_card, blur_glass, …) rather
    // than free-form tags — they describe what the pack overrides.
    const keys = e.effectKeys.slice(0, 4).map(k =>
      `<span class="tmpl-tag" style="font-family:var(--font-mono);font-size:10px">${escapeHTML(k)}</span>`).join('');
    return `
      <button class="tmpl-card theme-card${selected}" data-effects-id="${escapeAttr(e.id)}" type="button">
        <div class="theme-preview" style="background:var(--color-surface-2);min-height:120px;display:flex;align-items:center;justify-content:center">
          <span style="display:block;width:56px;height:56px;border-radius:50%;background:var(--color-primary);box-shadow:0 0 24px var(--color-primary),0 0 64px color-mix(in srgb,var(--color-primary) 40%,transparent)"></span>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${escapeHTML(e.name)}</div>
          <div class="tmpl-sub">${escapeHTML(e.description)}</div>
          <div class="tmpl-tags">${keys}</div>
        </div>
      </button>
    `;
  }

  private renderIndexCards(list: CatalogIndexEntry[]): string {
    if (list.length === 0) return '<p class="tmpl-empty">No matches.</p>';
    return `<div class="tmpl-grid">${list.map(e => this.indexCardHTML(e)).join('')}</div>`;
  }

  private indexCardHTML(e: CatalogIndexEntry): string {
    const tags = e.tags.slice(0, 4)
      .map(tg => `<span class="tmpl-tag">${escapeHTML(tg)}</span>`).join('');
    const pageInfo = e.pages > 0 ? ` · ${e.pages} pages` : '';
    const selected = e.id === this.selectedTemplateId ? ' selected' : '';
    return `
      <button class="tmpl-card${selected}" data-template="${escapeAttr(e.id)}" type="button">
        <div class="tmpl-thumb" data-template-thumb="${escapeAttr(e.id)}">
          <span class="tmpl-thumb-dim">${e.width} × ${e.height}</span>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${escapeHTML(e.name)}</div>
          <div class="tmpl-sub">${escapeHTML(e.type)}${pageInfo} · ${e.slots} editable</div>
          <div class="tmpl-tags">${tags}</div>
        </div>
      </button>
    `;
  }

  private themeCardHTML(t: ThemeCardData): string {
    const tags = t.tags.slice(0, 3).map(tg =>
      `<span class="tmpl-tag">${escapeHTML(tg)}</span>`).join('');
    const selected = t.id === this.selectedThemeId ? ' selected' : '';
    const swatches = t.swatches.map(c =>
      `<span class="theme-swatch" style="background:${c}" title="${c}"></span>`).join('');
    const sampleColor = t.light ? '#0a0a0a' : '#ffffff';
    return `
      <button class="tmpl-card theme-card${selected}" data-theme-id="${escapeAttr(t.id)}" type="button">
        <div class="theme-preview" style="background:${t.swatches[0]};color:${sampleColor}">
          <div class="theme-preview-row">
            <span class="theme-preview-h">Aa</span>
            <span class="theme-preview-dot" style="background:${t.swatches[2]}"></span>
            <span class="theme-preview-dot" style="background:${t.swatches[3]}"></span>
          </div>
          <div class="theme-swatches">${swatches}</div>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${escapeHTML(t.name)}</div>
          <div class="tmpl-sub">${t.light ? 'light' : 'dark'} · ${t.tags.length} tags</div>
          <div class="tmpl-tags">${tags}</div>
        </div>
      </button>
    `;
  }

  private featuredCardHTML(c: FeaturedCombo): string {
    const theme = getThemeById(c.themeId);
    const tpl   = findIndexEntry(c.templateId);
    const swatches = theme ? theme.swatches.map(col =>
      `<span class="theme-swatch sm" style="background:${col}"></span>`).join('') : '';
    return `
      <button class="tmpl-card combo-card" data-combo-id="${escapeAttr(c.id)}" type="button">
        <div class="combo-thumb">
          <span class="combo-thumb-title">${escapeHTML(c.name)}</span>
          <div class="theme-swatches">${swatches}</div>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${escapeHTML(c.name)}</div>
          <div class="tmpl-sub">${escapeHTML(tpl?.name ?? c.templateId)} × ${escapeHTML(theme?.name ?? c.themeId)}</div>
          <div class="tmpl-sub" style="opacity:.7">${escapeHTML(c.description ?? '')}</div>
        </div>
      </button>
    `;
  }

  private railHTML(): string {
    return `
      <div class="catalog-rail-head">
        <div class="rail-label">Live preview</div>
        <div class="rail-pick" data-rail="pick"></div>
      </div>
      <div class="rail-preview" data-rail="preview"></div>
      <div class="catalog-rail-actions">
        <button class="btn btn-primary" data-action="open">Open in editor</button>
        <button class="btn"               data-action="copy-mcp">Copy MCP prompt</button>
        <button class="btn"               data-action="copy-yaml">Copy YAML payload</button>
        <button class="btn-link"          data-action="copy-payload">Copy LLM payload (JSON)</button>
      </div>
    `;
  }

  // ── Filter pipeline ─────────────────────────────────────────

  private filteredEntries(kind: 'templates' | 'reports'): CatalogIndexEntry[] {
    const isReport = kind === 'reports';
    const q = this.filter.search.trim().toLowerCase();
    const tag = this.filter.tag;
    return this.index.filter(e => {
      if (isReport ? e.type !== 'report' : e.type === 'report') return false;
      if (tag && !e.tags.includes(tag)) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
      );
    });
  }

  private collectTags(kind: 'templates' | 'reports'): string[] {
    const set = new Set<string>();
    const isReport = kind === 'reports';
    for (const e of this.index) {
      if (isReport ? e.type !== 'report' : e.type === 'report') continue;
      for (const t of e.tags) set.add(t);
    }
    return [...set].sort();
  }

  // ── Event wiring + virtualization (filled below) ────────────

  private bindShell(): void {
    if (!this.overlay) return;
    this.overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('catalog-overlay')) { this.close(); return; }
      if (target.dataset.action === 'close')             { this.close(); return; }

      const tabBtn = target.closest<HTMLElement>('[data-tab]');
      if (tabBtn) {
        this.tab = tabBtn.dataset.tab as Tab;
        this.filter = { search: '', tag: null };
        this.refreshTabs();
        this.refreshFilterBar();
        this.renderTab();
        return;
      }

      const chip = target.closest<HTMLElement>('[data-tag]');
      if (chip) {
        const tg = chip.dataset.tag ?? '';
        this.filter.tag = tg ? tg : null;
        this.refreshFilterBar();
        this.renderTab();
        return;
      }

      const tCard = target.closest<HTMLElement>('[data-template]');
      if (tCard) {
        this.selectedTemplateId = tCard.dataset.template!;
        this.renderTab();
        void this.renderPreview();
        return;
      }

      const thCard = target.closest<HTMLElement>('[data-theme-id]');
      if (thCard) {
        this.selectedThemeId = thCard.dataset.themeId!;
        this.renderTab();
        void this.renderPreview();
        return;
      }

      const palCard = target.closest<HTMLElement>('[data-palette-id]');
      if (palCard) {
        this.selectedPaletteId = palCard.dataset.paletteId!;
        void loadFullPalette(this.selectedPaletteId).then(p => {
          this.resolvedPalette = p;
          this.renderTab();
          void this.renderPreview();
        });
        return;
      }

      const tpCard = target.closest<HTMLElement>('[data-typepack-id]');
      if (tpCard) {
        this.selectedTypePackId = tpCard.dataset.typepackId!;
        void loadFullTypePack(this.selectedTypePackId).then(tp => {
          this.resolvedTypePack = tp;
          this.renderTab();
          void this.renderPreview();
        });
        return;
      }

      const epCard = target.closest<HTMLElement>('[data-effects-id]');
      if (epCard) {
        this.selectedEffectsPackId = epCard.dataset.effectsId!;
        void loadFullEffectsPack(this.selectedEffectsPackId).then(ep => {
          this.resolvedEffectsPack = ep;
          this.renderTab();
          void this.renderPreview();
        });
        return;
      }

      const clear = target.closest<HTMLElement>('[data-style-clear]');
      if (clear) {
        const kind = clear.dataset.styleClear;
        if (kind === 'palettes') { this.selectedPaletteId = null;     this.resolvedPalette = undefined; }
        if (kind === 'type')     { this.selectedTypePackId = null;    this.resolvedTypePack = undefined; }
        if (kind === 'effects')  { this.selectedEffectsPackId = null; this.resolvedEffectsPack = undefined; }
        this.renderTab();
        void this.renderPreview();
        return;
      }

      const combo = target.closest<HTMLElement>('[data-combo-id]');
      if (combo) {
        const found = FEATURED_COMBOS.find(c => c.id === combo.dataset.comboId);
        if (found) {
          this.selectedTemplateId = found.templateId;
          this.selectedThemeId    = found.themeId;
          void this.renderPreview();
        }
        return;
      }

      const actionEl = target.closest<HTMLElement>('[data-action]');
      if (actionEl) this.handleAction(actionEl.dataset.action!);
    });

    // Search input — live filter, debounced one tick.
    this.overlay.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.input !== 'search') return;
      this.filter.search = t.value;
      // Re-render grid only; leave the input focused.
      const list = this.overlay?.querySelector<HTMLElement>('[data-pane="list"]');
      if (list) list.innerHTML = this.tabHTML();
      this.observeThumbs();
      this.updateCount();
    });
  }

  private installObserver(): void {
    // Hydrate thumbnails when cards enter the viewport. Off-screen cards
    // never trigger renderDesign — that's the trick that lets the catalog
    // hold thousands of entries without melting.
    if (typeof IntersectionObserver === 'undefined') return;
    this.io = new IntersectionObserver((records) => {
      for (const r of records) {
        if (!r.isIntersecting) continue;
        void this.hydrateCard(r.target as HTMLElement);
        this.io?.unobserve(r.target);
      }
    }, { root: null, rootMargin: '200px', threshold: 0.01 });
  }

  private observeThumbs(): void {
    if (!this.overlay || !this.io) return;
    this.overlay.querySelectorAll<HTMLElement>('[data-template-thumb]').forEach(el => {
      const id = el.dataset.templateThumb!;
      const cached = this.thumbCache.get(id);
      if (cached) {
        el.innerHTML = cached;
        return;
      }
      this.io!.observe(el);
    });
  }

  private renderTab(): void {
    if (!this.overlay) return;
    const list = this.overlay.querySelector<HTMLElement>('[data-pane="list"]');
    if (list) list.innerHTML = this.tabHTML();
    this.observeThumbs();
    this.updateCount();
  }

  private refreshTabs(): void {
    if (!this.overlay) return;
    this.overlay.querySelectorAll<HTMLElement>('.catalog-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === this.tab);
    });
  }

  private refreshFilterBar(): void {
    if (!this.overlay) return;
    const bar = this.overlay.querySelector<HTMLElement>('[data-pane="filter"]');
    if (bar) bar.innerHTML = this.filterBarHTML();
  }

  private updateCount(): void {
    if (!this.overlay) return;
    const el = this.overlay.querySelector<HTMLElement>('[data-pane="count"]');
    if (!el) return;
    let n = 0;
    if (this.tab === 'templates') n = this.filteredEntries('templates').length;
    else if (this.tab === 'reports') n = this.filteredEntries('reports').length;
    else if (this.tab === 'themes') n = this.themes.length;
    else n = FEATURED_COMBOS.length;
    el.textContent = `${n} result${n === 1 ? '' : 's'}`;
  }

  private async hydrateCard(card: HTMLElement): Promise<void> {
    const id = card.dataset.templateThumb;
    if (!id) return;
    if (this.thumbCache.has(id)) {
      card.innerHTML = this.thumbCache.get(id)!;
      return;
    }
    const spec = await loadFullTemplate(id);
    if (!spec) return;
    try {
      const design = injectIntoTemplate(spec, {});
      // Multi-page templates declare layers under pages[0]. Promote them
      // to top-level so the single-page thumbnail renderer sees content.
      if ((!design.layers || design.layers.length === 0) && design.pages?.[0]?.layers?.length) {
        design.layers = design.pages[0].layers;
      }
      const themeId = (typeof design.theme === 'object' && design.theme && 'ref' in design.theme)
        ? (design.theme as { ref?: string }).ref
        : undefined;
      const themeSpec = themeId ? getThemeById(themeId)?.spec : undefined;
      const svg = renderDesign(design, { theme: themeSpec });
      svg.setAttribute('viewBox', `0 0 ${design.document.width} ${design.document.height}`);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.style.display = 'block';
      const html = svg.outerHTML;
      this.thumbCache.set(id, html);
      card.innerHTML = html;
    } catch {
      // Leave placeholder dim text on failure.
    }
  }

  // ── Preview + actions (filled below) ────────────────────────

  private async renderPreview(): Promise<void> {
    if (!this.overlay) return;
    const preview = this.overlay.querySelector<HTMLElement>('[data-rail="preview"]');
    const pick    = this.overlay.querySelector<HTMLElement>('[data-rail="pick"]');
    if (!preview || !pick) return;
    const tEntry = this.selectedTemplateId ? findIndexEntry(this.selectedTemplateId) : undefined;
    const th     = this.themes.find(x => x.id === this.selectedThemeId);
    const pal    = this.palettes.find(x => x.id === this.selectedPaletteId);
    const tp     = this.typePacks.find(x => x.id === this.selectedTypePackId);
    const ep     = this.effectsPacks.find(x => x.id === this.selectedEffectsPackId);

    // Build the pick chip row. Style overlays only appear when picked so
    // the rail stays uncluttered for the common template × theme case.
    const chips: string[] = [
      `<span class="rail-chip">${escapeHTML(tEntry?.name ?? '—')}</span>`,
      `<span class="rail-x">×</span>`,
      `<span class="rail-chip">${escapeHTML(th?.name ?? '—')}</span>`,
    ];
    if (pal) chips.push(`<span class="rail-x">+</span>`, `<span class="rail-chip" title="palette">🎨 ${escapeHTML(pal.name)}</span>`);
    if (tp)  chips.push(`<span class="rail-x">+</span>`, `<span class="rail-chip" title="type pack">Aa ${escapeHTML(tp.name)}</span>`);
    if (ep)  chips.push(`<span class="rail-x">+</span>`, `<span class="rail-chip" title="effects pack">✨ ${escapeHTML(ep.name)}</span>`);
    pick.innerHTML = chips.join('');

    preview.innerHTML = '<div class="rail-empty">Loading preview…</div>';

    const design = await this.composedDesign();
    if (!design) {
      preview.innerHTML = '<div class="rail-empty">Pick a template to preview.</div>';
      return;
    }
    try {
      // composeTheme overlays the picked style primitives on top of the
      // selected theme. With no picks it returns the base theme by ref
      // — same behavior as before.
      const composedTheme = th?.spec
        ? composeTheme(th.spec, {
            palette: this.resolvedPalette,
            typePack: this.resolvedTypePack,
            effectsPack: this.resolvedEffectsPack,
          })
        : undefined;
      const svg = renderDesign(design, { theme: composedTheme });
      this.fitSVG(svg, design);
      preview.innerHTML = '';
      preview.appendChild(svg);
    } catch (err) {
      preview.innerHTML = `<div class="rail-empty">Preview failed: ${escapeHTML((err as Error).message)}</div>`;
    }
  }

  private fitSVG(svg: SVGSVGElement, design: DesignSpec): void {
    const w = design.document.width;
    const h = design.document.height;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.maxHeight = '420px';
    svg.style.display   = 'block';
  }

  private async composedDesign(): Promise<DesignSpec | null> {
    const id = this.selectedTemplateId;
    if (!id) return null;
    let spec: TemplateSpec | undefined = peekTemplate(id);
    spec ??= await loadFullTemplate(id);
    if (!spec) return null;
    const design = injectIntoTemplate(spec, {});
    if (this.selectedThemeId) {
      design.theme = { ref: this.selectedThemeId };
    }
    // Persist style overlay picks onto the design itself so the YAML the
    // user copies or opens has the same look as the rail preview. The
    // editor's resolveStyleRefs re-fetches the full specs on load.
    if (this.selectedPaletteId)     design.palette      = { ref: this.selectedPaletteId };
    if (this.selectedTypePackId)    design.type_pack    = { ref: this.selectedTypePackId };
    if (this.selectedEffectsPackId) design.effects_pack = { ref: this.selectedEffectsPackId };

    const entry = findIndexEntry(id);
    design.meta = {
      ...design.meta,
      id:   `from-${id}-${Date.now().toString(36)}`,
      name: `Untitled (${entry?.name ?? id})`,
    };
    return design;
  }

  private async handleAction(action: string): Promise<void> {
    const design = await this.composedDesign();
    if (!design) { this.toast('Pick a template first.', 'error'); return; }
    const picks: CatalogPicks = {
      palette:     this.resolvedPalette,
      typePack:    this.resolvedTypePack,
      effectsPack: this.resolvedEffectsPack,
    };
    switch (action) {
      case 'open':         this.cb?.onOpen(design, design.meta.name, picks); this.close(); break;
      case 'copy-mcp':     await this.copyMCPPrompt(design); break;
      case 'copy-yaml':    await this.copyYAML(design); break;
      case 'copy-payload': await this.copyJSONPayload(design); break;
    }
  }

  private async copyYAML(design: DesignSpec): Promise<void> {
    try {
      await navigator.clipboard.writeText(serializeYAML(design));
      this.toast('YAML copied to clipboard.', 'success');
    } catch { this.toast('Could not copy.', 'error'); }
  }

  private async copyJSONPayload(design: DesignSpec): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(design, null, 2));
      this.toast('JSON payload copied.', 'success');
    } catch { this.toast('Could not copy.', 'error'); }
  }

  private async copyMCPPrompt(design: DesignSpec): Promise<void> {
    const id = this.selectedTemplateId ?? '';
    const entry = findIndexEntry(id);
    const spec  = peekTemplate(id);
    const th    = this.themes.find(x => x.id === this.selectedThemeId);
    const slotLines = (spec?.slots ?? []).map(s =>
      `  - ${s.id}: ${JSON.stringify(s.default ?? '')}`).join('\n');
    const themeName = th?.name ?? 'Dark Tech';
    const themeId   = th?.id   ?? 'dark-tech';
    const prompt = [
      `Use the Folio MCP tools to create a design from a built-in template.`,
      ``,
      `Template id: ${entry?.id ?? id}`,
      `Template name: ${entry?.name ?? ''}`,
      `Theme: ${themeName} (id: ${themeId})`,
      `Canvas: ${design.document.width} × ${design.document.height}`,
      ``,
      `Slots (replace values to taste):`,
      slotLines || '  (none)',
      ``,
      `Steps:`,
      `  1. inject_template with the slot values above`,
      `  2. apply_theme with theme_id: ${themeId}`,
      `  3. export_design to svg/html/png/pdf as needed`,
      ``,
      `Voice: keep copy concise. Defaults are deliberately punchy — match that tone.`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(prompt);
      this.toast('MCP prompt copied to clipboard.', 'success');
    } catch { this.toast('Could not copy.', 'error'); }
  }
  private toast(msg: string, kind: 'success' | 'error'): void {
    this.cb?.onToast?.(msg, kind);
  }
}

// ── Helpers ────────────────────────────────────────────────────

function escapeHTML(s: string | number | null | undefined): string {
  // Defensive coercion: YAML parsing can yield numeric tags (e.g. an
  // unquoted `404` tag becomes Number 404), and calling .replace on a
  // non-string throws TypeError. Coerce to string so any catalog entry
  // with a numeric tag still renders instead of breaking the whole tab.
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHTML(s);
}

// Keep BUILTIN_THEMES referenced so tree-shaking doesn't drop it
// before the renderer evaluates `theme.ref`.
void BUILTIN_THEMES;
void escapeAttr;

export const catalogDialog = new CatalogDialog();
