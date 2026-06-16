// Folio Catalog — base class: dialog state + the pure HTML/list builder methods.
// Split out of catalog.ts to stay within the line budget. CatalogDialog (catalog.ts)
// extends this with open/close + event-binding orchestration. Bodies are verbatim.
import { findIndexEntry, type CatalogIndexEntry } from '../../templates/builtin-loader';
import { getThemeById, type ThemeCardData } from '../../templates/theme-registry';
import type { DesignSpec, PaletteSpec, TypePackSpec, EffectsPackSpec } from '../../schema/types';
import { FEATURED_COMBOS, type FeaturedCombo } from './catalog-combos';
import type { PaletteIndexEntry } from '../../styles/palette-loader';
import type { TypePackIndexEntry } from '../../styles/type-pack-loader';
import { peekEffectsPack, type EffectsPackIndexEntry } from '../../styles/effects-pack-loader';
import { escapeHTML, escapeAttr } from './catalog-utils';

export type Tab = 'templates' | 'themes' | 'palettes' | 'type' | 'effects' | 'reports' | 'featured';

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

export interface OpenCallbacks {
  onOpen:   (design: DesignSpec, label: string, picks?: CatalogPicks) => void;
  onToast?: (msg: string, kind: 'success' | 'error') => void;
}

export interface FilterState {
  search: string;
  tag:    string | null;
}

export abstract class CatalogDialogBase {
  protected overlay: HTMLElement | null = null;
  protected cb: OpenCallbacks | null = null;
  protected tab: Tab = 'templates';
  protected selectedTemplateId:    string | null = null;
  protected selectedThemeId:       string | null = null;
  protected selectedPaletteId:     string | null = null;
  protected selectedTypePackId:    string | null = null;
  protected selectedEffectsPackId: string | null = null;
  protected index:        CatalogIndexEntry[]     = [];
  protected themes:       ThemeCardData[]         = [];
  protected palettes:     PaletteIndexEntry[]     = [];
  protected typePacks:    TypePackIndexEntry[]    = [];
  protected effectsPacks: EffectsPackIndexEntry[] = [];
  // Style overlay picks resolved lazily — full specs only fetched on demand
  // so opening the dialog doesn't trigger N parallel YAML fetches.
  protected resolvedPalette:     PaletteSpec     | undefined;
  protected resolvedTypePack:    TypePackSpec    | undefined;
  protected resolvedEffectsPack: EffectsPackSpec | undefined;
  protected filter: FilterState = { search: '', tag: null };
  /** Which page of a paged design is shown in the rail. Resets to 0
   * whenever the selected template changes. */
  protected previewPageIndex = 0;
  protected io: IntersectionObserver | null = null;
  protected thumbCache = new Map<string, string>();
  protected effectTokenCache = new Map<string, boolean>();
  protected shellHTML(): string {
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

  protected filterBarHTML(): string {
    // Style overlay tabs render their own simple list; templates/reports
    // share the search + tag chip bar.
    if (this.tab === 'themes' || this.tab === 'featured' ||
        this.tab === 'palettes' || this.tab === 'type' || this.tab === 'effects') return '';
    const kind = this.tab as 'templates' | 'reports';
    // Cap visible chips. With 332 templates the raw tag set runs to
    // ~600 entries; rendering all of them used to flood the filter bar
    // and shove the card grid off-screen after any tab switch. Show the
    // top-N most-common tags (a curated, useful subset) plus the
    // currently-active filter so the user can always see + clear it.
    const VISIBLE_CHIP_LIMIT = 24;
    const ranked = this.collectTagsRanked(kind);
    const visible = ranked.slice(0, VISIBLE_CHIP_LIMIT);
    if (this.filter.tag && !visible.includes(this.filter.tag)) visible.push(this.filter.tag);
    const overflow = Math.max(0, ranked.length - VISIBLE_CHIP_LIMIT);
    const chips = visible.map(tg => {
      const sel = this.filter.tag === tg ? ' selected' : '';
      return `<button class="tag-chip${sel}" data-tag="${escapeAttr(tg)}" type="button">${escapeHTML(tg)}</button>`;
    }).join('');
    const clear = this.filter.tag ? `<button class="tag-chip clear" data-tag="" type="button">clear ×</button>` : '';
    const more = overflow > 0 ? `<span class="tag-chip-more" title="${overflow} more tags hidden">+${overflow}</span>` : '';
    return `
      <input class="catalog-search" type="search" placeholder="Search ${kind}…"
             value="${escapeAttr(this.filter.search)}" data-input="search" />
      <div class="catalog-chips">${chips}${clear}${more}</div>
      <span class="catalog-count" data-pane="count"></span>
    `;
  }

  protected tabHTML(): string {
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

  protected renderStyleCards(kind: 'palettes' | 'type' | 'effects'): string {
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
  protected clearStyleChip(kind: 'palettes' | 'type' | 'effects'): string {
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

  protected paletteCardHTML(p: PaletteIndexEntry): string {
    const tags = p.tags.slice(0, 3).map(tg =>
      `<span class="tmpl-tag">${escapeHTML(tg)}</span>`).join('');
    const selected = p.id === this.selectedPaletteId ? ' selected' : '';
    // Conventional ordering in our palette YAMLs: [bg, surface, primary,
    // secondary, text, …]. Pull positionally with safe fallbacks so a
    // sparse palette still produces a readable preview.
    const bg     = p.swatches[0] ?? '#0d0d14';
    const sf     = p.swatches[1] ?? bg;
    const accent = p.swatches[2] ?? '#6c5ce7';
    const second = p.swatches[3] ?? accent;
    const text   = p.swatches[4] ?? this.contrastingText(bg);
    const swatchStrip = p.swatches.slice(0, 6).map(c =>
      `<span class="theme-swatch" style="background:${c}" title="${escapeAttr(c)}"></span>`).join('');
    return `
      <button class="tmpl-card theme-card${selected}" data-palette-id="${escapeAttr(p.id)}" type="button">
        <div class="theme-preview" style="background:${bg};color:${text};padding:10px;min-height:120px;display:flex;flex-direction:column;justify-content:space-between;gap:6px">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:22px;font-weight:800;letter-spacing:-0.01em">Aa</span>
            <span style="display:inline-block;width:22px;height:8px;background:${accent};border-radius:2px"></span>
            <span style="display:inline-block;width:22px;height:8px;background:${second};border-radius:2px"></span>
          </div>
          <div style="font-size:11px;opacity:0.85;line-height:1.35">Headline on background — body in text.</div>
          <div style="display:flex;align-items:center;gap:6px;justify-content:space-between">
            <span style="background:${accent};color:${this.contrastingText(accent)};font-size:10px;font-weight:700;padding:3px 8px;border-radius:3px">Action</span>
            <span style="background:${sf};color:${text};font-size:10px;padding:3px 6px;border-radius:3px;opacity:0.85">surface</span>
          </div>
          <div class="theme-swatches">${swatchStrip}</div>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${escapeHTML(p.name)}</div>
          <div class="tmpl-sub">${escapeHTML(p.description)}</div>
          <div class="tmpl-tags">${tags}</div>
        </div>
      </button>
    `;
  }

  /**
   * Renders a pick-chip with a click-target × that drops that axis.
   * `kind` is the data-drop value: 'palette' | 'type' | 'effects'.
   */
  protected removableChip(kind: 'palette' | 'type' | 'effects', icon: string, name: string): string {
    return `
      <span class="rail-chip rail-chip--removable" title="${escapeAttr(kind)} pack">
        <span>${icon} ${escapeHTML(name)}</span>
        <button class="rail-chip-x" data-drop="${kind}" aria-label="Remove ${escapeAttr(name)}" type="button">×</button>
      </span>
    `;
  }

  /**
   * Cheap check: does the resolved template YAML reference any of the
   * tokens an effects pack overrides? Result is memoized per template id
   * so flipping back and forth doesn't re-scan the spec.
   */
  protected contrastingText(hex: string): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return '#FFFFFF';
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    // Rec. 709 luminance — same heuristic used by theme-registry.isLight.
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? '#0a0a0a' : '#FFFFFF';
  }

  protected typePackCardHTML(t: TypePackIndexEntry): string {
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

  protected effectsCardHTML(e: EffectsPackIndexEntry): string {
    const selected = e.id === this.selectedEffectsPackId ? ' selected' : '';
    const keys = e.effectKeys.slice(0, 4).map(k =>
      `<span class="tmpl-tag" style="font-family:var(--font-mono);font-size:10px">${escapeHTML(k)}</span>`).join('');
    // Pull the actual effect strings from the resolved spec (pre-fetched
    // in parallel after open). Falls back to the index keys list while
    // the spec is in flight so the card never looks empty.
    const spec = peekEffectsPack(e.id);
    const card  = String(spec?.effects['shadow_card']  ?? '0 4px 12px rgba(0,0,0,0.25)');
    const glow  = String(spec?.effects['shadow_glow']  ?? '0 0 24px rgba(108,92,231,0.5)');
    const blur  = Number(spec?.effects['blur_glass']   ?? 0);
    const inset = String(spec?.effects['shadow_inset'] ?? '');
    // Surface tint sometimes ships as a color hint; pluck the first one
    // we recognize to vary the card background slightly per pack.
    const tintRaw = spec?.effects['tint_overlay'] ?? spec?.effects['highlight'] ?? '';
    const surface = typeof tintRaw === 'string' && tintRaw.startsWith('#')
      ? tintRaw : 'var(--color-surface-2)';
    return `
      <button class="tmpl-card theme-card${selected}" data-effects-id="${escapeAttr(e.id)}" type="button">
        <div class="theme-preview" style="background:${surface};min-height:120px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(${Math.min(blur, 12)}px)">
          <span style="display:block;width:56px;height:56px;border-radius:14px;background:var(--color-primary);box-shadow:${card}, ${glow}${inset ? ', ' + inset : ''}"></span>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${escapeHTML(e.name)}</div>
          <div class="tmpl-sub">${escapeHTML(e.description)}</div>
          <div class="tmpl-tags">${keys}</div>
        </div>
      </button>
    `;
  }

  protected renderIndexCards(list: CatalogIndexEntry[]): string {
    if (list.length === 0) return '<p class="tmpl-empty">No matches.</p>';
    return `<div class="tmpl-grid">${list.map(e => this.indexCardHTML(e)).join('')}</div>`;
  }

  protected indexCardHTML(e: CatalogIndexEntry): string {
    const tags = e.tags.slice(0, 4)
      .map(tg => `<span class="tmpl-tag">${escapeHTML(tg)}</span>`).join('');
    const pageInfo = e.pages > 0 ? ` · ${e.pages} pages` : '';
    const selected = e.id === this.selectedTemplateId ? ' selected' : '';
    // Report dashboards render faint at thumbnail scale and read as generic
    // grey skeletons. A corner type-badge + a flat surface frame makes them
    // identifiable at a glance. The badge sits on .tmpl-card (not the thumb)
    // because hydrateCard overwrites the thumb's innerHTML on hydration.
    const isReport = e.type === 'report';
    const badge = isReport ? `<span class="tmpl-thumb-badge">Report</span>` : '';
    const thumbCls = isReport ? 'tmpl-thumb tmpl-thumb--report' : 'tmpl-thumb';
    return `
      <button class="tmpl-card${selected}" data-template="${escapeAttr(e.id)}" type="button">
        ${badge}
        <div class="${thumbCls}" data-template-thumb="${escapeAttr(e.id)}">
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

  protected themeCardHTML(t: ThemeCardData): string {
    const tags = t.tags.slice(0, 3).map(tg =>
      `<span class="tmpl-tag">${escapeHTML(tg)}</span>`).join('');
    const selected = t.id === this.selectedThemeId ? ' selected' : '';
    const swatches = t.swatches.map(c =>
      `<span class="theme-swatch" style="background:${c}" title="${c}"></span>`).join('');
    const sampleColor = t.light ? '#0a0a0a' : '#ffffff';
    // Pull the theme's actual heading family so "Aa" reads as Playfair
    // on Editorial Cream, Anton on High Contrast, Orbitron on Cyber
    // Synthwave, etc. — making the typography differentiation visible.
    const headingFamily = escapeAttr(t.spec.typography.families.heading);
    const bodyFamily    = escapeAttr(t.spec.typography.families.body);
    return `
      <button class="tmpl-card theme-card${selected}" data-theme-id="${escapeAttr(t.id)}" type="button">
        <div class="theme-preview" style="background:${t.swatches[0]};color:${sampleColor}">
          <div class="theme-preview-row">
            <span class="theme-preview-h" style="font-family:'${headingFamily}',sans-serif">Aa</span>
            <span class="theme-preview-dot" style="background:${t.swatches[2]}"></span>
            <span class="theme-preview-dot" style="background:${t.swatches[3]}"></span>
          </div>
          <div style="font-family:'${bodyFamily}',sans-serif;font-size:11px;opacity:0.7;margin-top:6px">The quick brown fox</div>
          <div class="theme-swatches">${swatches}</div>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${escapeHTML(t.name)}</div>
          <div class="tmpl-sub">${headingFamily} · ${bodyFamily}</div>
          <div class="tmpl-tags">${tags}</div>
        </div>
      </button>
    `;
  }

  protected featuredCardHTML(c: FeaturedCombo): string {
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

  protected railHTML(): string {
    return `
      <div class="catalog-rail-head">
        <div class="rail-label-row">
          <div class="rail-label">Live preview</div>
          <button class="btn-shuffle" data-action="shuffle" title="Random combination" aria-label="Shuffle">🎲 Shuffle</button>
        </div>
        <div class="rail-pick" data-rail="pick"></div>
        <div class="rail-hint" data-rail="hint"></div>
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

  protected filteredEntries(kind: 'templates' | 'reports'): CatalogIndexEntry[] {
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
        // Tags may slip through as numbers (e.g. the 1099 form template
        // lists `1099` unquoted in YAML); coerce so search doesn't throw.
        e.tags.some(t => String(t).toLowerCase().includes(q))
      );
    });
  }

  protected collectTags(kind: 'templates' | 'reports'): string[] {
    const set = new Set<string>();
    const isReport = kind === 'reports';
    for (const e of this.index) {
      if (isReport ? e.type !== 'report' : e.type === 'report') continue;
      for (const t of e.tags) set.add(String(t));
    }
    return [...set].sort();
  }

  /**
   * Returns tag names ordered by how many entries reference them — most
   * common first. Lets the filter bar surface high-signal tags like
   * "poster" or "card" before niche one-offs.
   */
  protected collectTagsRanked(kind: 'templates' | 'reports'): string[] {
    const counts = new Map<string, number>();
    const isReport = kind === 'reports';
    for (const e of this.index) {
      if (isReport ? e.type !== 'report' : e.type === 'report') continue;
      for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t);
  }

  // ── Event wiring + virtualization (filled below) ────────────

}
