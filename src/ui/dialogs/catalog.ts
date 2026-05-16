/**
 * Folio Catalog — full-screen dialog for browsing Templates, Themes, and
 * Reports, with a right-rail live preview and 3 export actions (open in
 * editor, copy MCP prompt, copy YAML payload).
 *
 * Composition model: a "selection" is { templateId, themeId }. Templates
 * and Themes are orthogonal — when both are picked, the template's spec
 * is rebased onto the theme via injectIntoTemplate + theme.ref override.
 */

import { loadBuiltinTemplates, type BuiltinTemplate } from '../../templates/builtin-loader';
import { loadThemeCatalog, type ThemeCardData, getThemeById } from '../../templates/theme-registry';
import { injectIntoTemplate } from '../../schema/template';
import { serializeYAML } from '../../schema/parser';
import { renderDesign } from '../../renderer/renderer';
import type { DesignSpec } from '../../schema/types';
import { BUILTIN_THEMES } from '../../themes/builtin';
import { FEATURED_COMBOS, type FeaturedCombo } from './catalog-combos';

type Tab = 'templates' | 'themes' | 'reports' | 'featured';

interface OpenCallbacks {
  onOpen: (design: DesignSpec, label: string) => void;
  onToast?: (msg: string, kind: 'success' | 'error') => void;
}

export class CatalogDialog {
  private overlay: HTMLElement | null = null;
  private cb: OpenCallbacks | null = null;
  private tab: Tab = 'templates';
  private selectedTemplateId: string | null = null;
  private selectedThemeId: string | null = null;
  private templates: BuiltinTemplate[] = [];
  private themes: ThemeCardData[] = [];

  open(cb: OpenCallbacks): void {
    this.close();
    this.cb = cb;
    this.templates = loadBuiltinTemplates();
    this.themes = loadThemeCatalog();
    // Seed defaults so preview shows something useful immediately.
    this.selectedTemplateId = this.templates[0]?.id ?? null;
    this.selectedThemeId = this.themes[0]?.id ?? null;
    this.tab = 'templates';

    this.overlay = document.createElement('div');
    this.overlay.className = 'dialog-overlay catalog-overlay';
    this.overlay.innerHTML = this.shellHTML();
    document.body.appendChild(this.overlay);

    this.bindShell();
    this.renderTab();
    this.renderPreview();

    document.addEventListener('keydown', this.onKey);
  }

  close(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    document.removeEventListener('keydown', this.onKey);
    this.cb = null;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  // ── HTML scaffolding ─────────────────────────────────────────

  private shellHTML(): string {
    return `
      <div class="catalog" role="dialog" aria-label="Folio Catalog">
        <div class="catalog-header">
          <h2 class="catalog-title">Folio Catalog</h2>
          <div class="catalog-tabs">
            <button class="catalog-tab active" data-tab="templates">Templates</button>
            <button class="catalog-tab"        data-tab="themes">Themes</button>
            <button class="catalog-tab"        data-tab="reports">Reports</button>
            <button class="catalog-tab"        data-tab="featured">Featured</button>
          </div>
          <button class="dialog-close" data-action="close" aria-label="Close">×</button>
        </div>
        <div class="catalog-body">
          <div class="catalog-list" data-pane="list">${this.tabHTML()}</div>
          <aside class="catalog-rail" data-pane="rail">${this.railHTML()}</aside>
        </div>
      </div>
    `;
  }

  private tabHTML(): string {
    switch (this.tab) {
      case 'templates': return this.renderTemplateCards(this.templates.filter(t => t.spec.meta.type !== 'report'));
      case 'reports':   return this.renderTemplateCards(this.templates.filter(t => t.spec.meta.type === 'report'));
      case 'themes':    return this.renderThemeCards();
      case 'featured':  return this.renderFeaturedCards();
    }
  }

  private renderTemplateCards(list: BuiltinTemplate[]): string {
    if (list.length === 0) {
      return '<p class="tmpl-empty">Nothing here yet.</p>';
    }
    return `<div class="tmpl-grid">${list.map(t => this.templateCardHTML(t)).join('')}</div>`;
  }

  private templateCardHTML(t: BuiltinTemplate): string {
    const { meta, document: doc } = t.spec;
    const tags = ((meta as { tags?: string[] }).tags ?? []).slice(0, 4)
      .map(tg => `<span class="tmpl-tag">${escapeHTML(tg)}</span>`)
      .join('');
    const pageInfo = t.spec.pages ? ` · ${t.spec.pages.length} pages` : '';
    const slots = t.spec.slots.length;
    const selected = t.id === this.selectedTemplateId ? ' selected' : '';
    return `
      <button class="tmpl-card${selected}" data-template="${t.id}" type="button">
        <div class="tmpl-thumb" data-template-thumb="${t.id}">
          <span class="tmpl-thumb-dim">${doc.width} × ${doc.height}</span>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${escapeHTML(meta.name)}</div>
          <div class="tmpl-sub">${escapeHTML(meta.type)}${pageInfo} · ${slots} editable</div>
          <div class="tmpl-tags">${tags}</div>
        </div>
      </button>
    `;
  }

  private renderThemeCards(): string {
    return `<div class="tmpl-grid theme-grid">${
      this.themes.map(t => this.themeCardHTML(t)).join('')
    }</div>`;
  }

  private themeCardHTML(t: ThemeCardData): string {
    const tags = t.tags.slice(0, 3).map(tg =>
      `<span class="tmpl-tag">${escapeHTML(tg)}</span>`,
    ).join('');
    const selected = t.id === this.selectedThemeId ? ' selected' : '';
    const swatches = t.swatches.map(c =>
      `<span class="theme-swatch" style="background:${c}" title="${c}"></span>`,
    ).join('');
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

  private renderFeaturedCards(): string {
    return `<div class="tmpl-grid">${
      FEATURED_COMBOS.map(c => this.featuredCardHTML(c)).join('')
    }</div>`;
  }

  private featuredCardHTML(c: FeaturedCombo): string {
    const theme = getThemeById(c.themeId);
    const tpl   = this.templates.find(t => t.id === c.templateId);
    const swatches = theme ? theme.swatches.map(col =>
      `<span class="theme-swatch sm" style="background:${col}"></span>`,
    ).join('') : '';
    return `
      <button class="tmpl-card combo-card" data-combo-id="${escapeAttr(c.id)}" type="button">
        <div class="combo-thumb">
          <span class="combo-thumb-title">${escapeHTML(c.name)}</span>
          <div class="theme-swatches">${swatches}</div>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${escapeHTML(c.name)}</div>
          <div class="tmpl-sub">${escapeHTML(tpl?.spec.meta.name ?? c.templateId)} × ${escapeHTML(theme?.name ?? c.themeId)}</div>
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

  // ── Event wiring ─────────────────────────────────────────────

  private bindShell(): void {
    if (!this.overlay) return;
    this.overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      if (target.classList.contains('catalog-overlay')) {
        this.close();
        return;
      }
      if (target.dataset.action === 'close') {
        this.close();
        return;
      }

      const tabBtn = target.closest<HTMLElement>('[data-tab]');
      if (tabBtn) {
        this.tab = tabBtn.dataset.tab as Tab;
        this.refreshTabs();
        this.renderTab();
        return;
      }

      const tCard = target.closest<HTMLElement>('[data-template]');
      if (tCard) {
        this.selectedTemplateId = tCard.dataset.template!;
        this.renderTab();
        this.renderPreview();
        return;
      }

      const thCard = target.closest<HTMLElement>('[data-theme-id]');
      if (thCard) {
        this.selectedThemeId = thCard.dataset.themeId!;
        this.renderTab();
        this.renderPreview();
        return;
      }

      const combo = target.closest<HTMLElement>('[data-combo-id]');
      if (combo) {
        const id = combo.dataset.comboId!;
        const found = FEATURED_COMBOS.find(c => c.id === id);
        if (found) {
          this.selectedTemplateId = found.templateId;
          this.selectedThemeId    = found.themeId;
          this.renderPreview();
        }
        return;
      }

      const actionEl = target.closest<HTMLElement>('[data-action]');
      if (actionEl) {
        this.handleAction(actionEl.dataset.action!);
      }
    });
  }

  private refreshTabs(): void {
    if (!this.overlay) return;
    this.overlay.querySelectorAll<HTMLElement>('.catalog-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === this.tab);
    });
  }

  private renderTab(): void {
    if (!this.overlay) return;
    const list = this.overlay.querySelector<HTMLElement>('[data-pane="list"]');
    if (list) list.innerHTML = this.tabHTML();
  }

  // ── Live preview + actions wired in the next module ─────────

  private renderPreview(): void {
    if (!this.overlay) return;
    const preview = this.overlay.querySelector<HTMLElement>('[data-rail="preview"]');
    const pick    = this.overlay.querySelector<HTMLElement>('[data-rail="pick"]');
    if (!preview || !pick) return;
    const t = this.templates.find(x => x.id === this.selectedTemplateId);
    const th = this.themes.find(x => x.id === this.selectedThemeId);
    pick.innerHTML = `
      <span class="rail-chip">${escapeHTML(t?.spec.meta.name ?? '—')}</span>
      <span class="rail-x">×</span>
      <span class="rail-chip">${escapeHTML(th?.name ?? '—')}</span>
    `;
    preview.innerHTML = '';
    const design = this.composedDesign();
    if (!design) {
      preview.innerHTML = '<div class="rail-empty">Pick a template to preview.</div>';
      return;
    }
    try {
      const svg = renderDesign(design, { theme: th?.spec });
      this.fitSVG(svg, design);
      preview.appendChild(svg);
    } catch (err) {
      preview.innerHTML = `<div class="rail-empty">Preview failed: ${escapeHTML((err as Error).message)}</div>`;
    }
  }

  private fitSVG(svg: SVGSVGElement, design: DesignSpec): void {
    // Preserve aspect ratio inside a box of fixed width.
    const w = design.document.width;
    const h = design.document.height;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.maxHeight = '420px';
    svg.style.display = 'block';
  }

  private composedDesign(): DesignSpec | null {
    const t = this.templates.find(x => x.id === this.selectedTemplateId);
    if (!t) return null;
    const design = injectIntoTemplate(t.spec, {});
    // Theme orthogonality: if user picked a theme, swap the ref. The
    // template's overrides survive — they're per-layer color refs into
    // $primary etc., which get resolved against the new theme.
    if (this.selectedThemeId) {
      design.theme = { ref: this.selectedThemeId };
    }
    design.meta = {
      ...design.meta,
      id: `from-${t.id}-${Date.now().toString(36)}`,
      name: `Untitled (${t.spec.meta.name})`,
    };
    return design;
  }

  private handleAction(action: string): void {
    const design = this.composedDesign();
    if (!design) {
      this.toast('Pick a template first.', 'error');
      return;
    }
    switch (action) {
      case 'open':          this.cb?.onOpen(design, design.meta.name); this.close(); break;
      case 'copy-mcp':      void this.copyMCPPrompt(design); break;
      case 'copy-yaml':     void this.copyYAML(design); break;
      case 'copy-payload':  void this.copyJSONPayload(design); break;
    }
  }

  private async copyYAML(design: DesignSpec): Promise<void> {
    try {
      await navigator.clipboard.writeText(serializeYAML(design));
      this.toast('YAML copied to clipboard.', 'success');
    } catch {
      this.toast('Could not copy.', 'error');
    }
  }

  private async copyJSONPayload(design: DesignSpec): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(design, null, 2));
      this.toast('JSON payload copied.', 'success');
    } catch {
      this.toast('Could not copy.', 'error');
    }
  }

  private async copyMCPPrompt(design: DesignSpec): Promise<void> {
    const t = this.templates.find(x => x.id === this.selectedTemplateId);
    const th = this.themes.find(x => x.id === this.selectedThemeId);
    const slotLines = (t?.spec.slots ?? []).map(s => `  - ${s.id}: ${JSON.stringify(s.default ?? '')}`).join('\n');
    const themeName = th?.name ?? 'Dark Tech';
    const themeId = th?.id ?? 'dark-tech';
    const prompt = [
      `Use the Folio MCP tools to create a design from a built-in template.`,
      ``,
      `Template id: ${t?.spec.meta.id ?? t?.id ?? ''}`,
      `Template name: ${t?.spec.meta.name ?? ''}`,
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
    } catch {
      this.toast('Could not copy.', 'error');
    }
  }

  private toast(msg: string, kind: 'success' | 'error'): void {
    this.cb?.onToast?.(msg, kind);
  }
}

// ── Helpers ────────────────────────────────────────────────────

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHTML(s);
}
void escapeAttr;

// Keep BUILTIN_THEMES referenced so tree-shaking doesn't drop it
// before the renderer evaluates `theme.ref`.
void BUILTIN_THEMES;

export const catalogDialog = new CatalogDialog();
