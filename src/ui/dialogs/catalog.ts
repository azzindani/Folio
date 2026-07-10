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
import { chromeIcon } from '../../editor/chrome-icons';
import { loadCatalogIndex, loadFullTemplate, findIndexEntry, peekTemplate } from '../../templates/builtin-loader';
import { loadThemeCatalog, getThemeById } from '../../templates/theme-registry';
import { injectIntoTemplate, type TemplateSpec } from '../../schema/template';
import { serializeYAML } from '../../schema/parser';
import { renderDesign, renderPage } from '../../renderer/renderer';
import type { DesignSpec } from '../../schema/types';
import { BUILTIN_THEMES } from '../../themes/builtin';
import { FEATURED_COMBOS } from './catalog-combos';
import { loadPaletteIndex, loadFullPalette } from '../../styles/palette-loader';
import { loadTypePackIndex, loadFullTypePack } from '../../styles/type-pack-loader';
import { loadEffectsPackIndex, loadFullEffectsPack } from '../../styles/effects-pack-loader';
import { composeTheme } from '../../styles/compose';
import { ensureTypePackFonts } from '../../styles/font-loader';
import { CatalogDialogBase } from './catalog-base';
import type { Tab, OpenCallbacks, CatalogPicks } from './catalog-base';
import { escapeHTML } from './catalog-utils';
export type { CatalogPicks } from './catalog-base';

export class CatalogDialog extends CatalogDialogBase {
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
    // Pull every family the type-pack index declares and ask the runtime
    // loader to inject one Google Fonts link covering them all. Without
    // this, the type-pack cards render every "Aa" in Inter because the
    // declared family never loads.
    const families: string[] = [];
    for (const tp of this.typePacks) {
      families.push(tp.families.heading, tp.families.body, tp.families.mono);
    }
    ensureTypePackFonts(families);
    // Pre-resolve all effects packs in parallel so cards can preview the
    // pack's actual shadow/glow instead of a hardcoded glyph. 43 packs
    // = 43 tiny YAML fetches, parallel, behind the rail's first paint.
    // Re-render only when the user is sitting on the Effects tab; other
    // tabs don't care so we avoid extra DOM churn.
    void Promise.all(this.effectsPacks.map(e => loadFullEffectsPack(e.id))).then(() => {
      if (this.tab === 'effects') this.renderTab();
    });
    this.selectedTemplateId = this.index[0]?.id ?? null;
    this.selectedThemeId    = this.themes[0]?.id ?? null;
    // refreshFilterBar() because shellHTML() was built before the index
    // resolved — at that point collectTagsRanked returned []. Without
    // this re-render the chips only appear after the user clicks away
    // and back to Templates.
    this.refreshFilterBar();
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

  private async templateUsesEffectTokens(id: string): Promise<boolean> {
    const cached = this.effectTokenCache.get(id);
    if (cached !== undefined) return cached;
    let spec: TemplateSpec | undefined = peekTemplate(id);
    spec ??= await loadFullTemplate(id);
    if (!spec) return false;
    // Stringify the spec once and check for any of the effect-pack token
    // references. Cheaper and more robust than walking the layer tree.
    const json = JSON.stringify(spec);
    const used = /\$shadow_(card|glow|inset|text)|\$blur_(glass|backdrop)/.test(json);
    this.effectTokenCache.set(id, used);
    return used;
  }

  /**
   * Pick a random combination across all four axes for the active
   * template. Resolves the full spec for every overlay so the
   * composed preview renders with real data, not just an id chip.
   */
  private async shuffle(): Promise<void> {
    const pick = <T>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)];
    const theme = pick(this.themes);
    const pal   = pick(this.palettes);
    const tp    = pick(this.typePacks);
    const ep    = pick(this.effectsPacks);
    if (theme) this.selectedThemeId       = theme.id;
    if (pal)   this.selectedPaletteId     = pal.id;
    if (tp)    this.selectedTypePackId    = tp.id;
    if (ep)    this.selectedEffectsPackId = ep.id;
    // Kick the lazy loaders in parallel so the rail can render the
    // composed preview as soon as all three packs land.
    const [resolvedPal, resolvedTp, resolvedEp] = await Promise.all([
      pal ? loadFullPalette(pal.id)     : Promise.resolve(undefined),
      tp  ? loadFullTypePack(tp.id)     : Promise.resolve(undefined),
      ep  ? loadFullEffectsPack(ep.id)  : Promise.resolve(undefined),
    ]);
    this.resolvedPalette     = resolvedPal;
    this.resolvedTypePack    = resolvedTp;
    this.resolvedEffectsPack = resolvedEp;
    this.renderTab();
    void this.renderPreview();
  }

  /**
   * Pick black/white text against a hex bg so palette cards stay legible
   * even when authored swatches don't include a `text` slot in position 4.
   */
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
        this.previewPageIndex = 0;
        this.renderTab();
        void this.renderPreview();
        return;
      }

      // Page-nav arrows for paged template previews in the rail.
      const pageNav = target.closest<HTMLElement>('[data-page-nav]');
      if (pageNav) {
        e.stopPropagation();
        const dir = pageNav.dataset.pageNav === 'next' ? 1 : -1;
        this.previewPageIndex += dir;
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

      const drop = target.closest<HTMLElement>('[data-drop]');
      if (drop) {
        e.stopPropagation();
        const kind = drop.dataset.drop;
        if (kind === 'palette') { this.selectedPaletteId     = null; this.resolvedPalette     = undefined; }
        if (kind === 'type')    { this.selectedTypePackId    = null; this.resolvedTypePack    = undefined; }
        if (kind === 'effects') { this.selectedEffectsPackId = null; this.resolvedEffectsPack = undefined; }
        // Re-render the active tab too so the corresponding card loses
        // its "selected" highlight in real time.
        this.renderTab();
        void this.renderPreview();
        return;
      }

      const actionEl = target.closest<HTMLElement>('[data-action]');
      if (actionEl) {
        if (actionEl.dataset.action === 'shuffle') {
          void this.shuffle();
          return;
        }
        void this.handleAction(actionEl.dataset.action!);
      }
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
    const hint    = this.overlay.querySelector<HTMLElement>('[data-rail="hint"]');
    if (!preview || !pick) return;
    const tEntry = this.selectedTemplateId ? findIndexEntry(this.selectedTemplateId) : undefined;
    const th     = this.themes.find(x => x.id === this.selectedThemeId);
    const pal    = this.palettes.find(x => x.id === this.selectedPaletteId);
    const tp     = this.typePacks.find(x => x.id === this.selectedTypePackId);
    const ep     = this.effectsPacks.find(x => x.id === this.selectedEffectsPackId);

    // Build the pick chip row. Style overlays render as removable chips —
    // click the × to drop that axis without leaving the current tab. The
    // template+theme chips stay non-removable since the preview needs at
    // least those two to render anything.
    const chips: string[] = [
      `<span class="rail-chip">${escapeHTML(tEntry?.name ?? '—')}</span>`,
      `<span class="rail-x">×</span>`,
      `<span class="rail-chip">${escapeHTML(th?.name ?? '—')}</span>`,
    ];
    if (pal) chips.push(`<span class="rail-x">+</span>`, this.removableChip('palette', chromeIcon('palette', 12), pal.name));
    if (tp)  chips.push(`<span class="rail-x">+</span>`, this.removableChip('type',    'Aa', tp.name));
    if (ep)  chips.push(`<span class="rail-x">+</span>`, this.removableChip('effects', chromeIcon('sparkles', 12), ep.name));
    pick.innerHTML = chips.join('');

    // Honest status when the picked effects pack can't visibly land on
    // the chosen template. Currently zero of the 332 built-in templates
    // bind $shadow_card / $shadow_glow / $blur_*; until they do, an
    // effects pick will be silently no-op. Tell the user instead of
    // letting it look broken.
    if (hint) {
      hint.innerHTML = '';
      if (ep && this.selectedTemplateId) {
        const usesEffectTokens = await this.templateUsesEffectTokens(this.selectedTemplateId);
        if (!usesEffectTokens) {
          hint.innerHTML = `<span class="rail-hint-text">✨ <em>${escapeHTML(ep.name)}</em> is selected, but this template doesn't bind <code>$shadow_*</code> / <code>$blur_*</code> tokens, so the effect won't be visible on the canvas.</span>`;
        }
      }
    }

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
      // Paged designs (carousels, decks, multi-slide LinkedIn posts) need
      // renderPage with explicit layers — renderDesign only walks
      // top-level spec.layers and silently produces empty SVG for paged
      // specs. Render the currently-selected page and surface nav arrows.
      const pages = design.pages ?? [];
      const hasPages = pages.length > 0;
      let svg: SVGSVGElement;
      let nav = '';
      if (hasPages) {
        const idx = Math.max(0, Math.min(this.previewPageIndex, pages.length - 1));
        this.previewPageIndex = idx;
        const page = pages[idx];
        const prevDisabled = idx === 0 ? 'disabled' : '';
        const nextDisabled = idx === pages.length - 1 ? 'disabled' : '';
        nav = `
          <div class="rail-page-nav">
            <button data-page-nav="prev" ${prevDisabled} aria-label="Previous page" type="button">‹</button>
            <span class="rail-page-counter">${idx + 1} / ${pages.length}${page.label ? ' · ' + escapeHTML(page.label) : ''}</span>
            <button data-page-nav="next" ${nextDisabled} aria-label="Next page" type="button">›</button>
          </div>
        `;
        svg = renderPage(page.layers ?? [], design.document.width, design.document.height, { theme: composedTheme });
      } else {
        svg = renderDesign(design, { theme: composedTheme });
      }
      this.fitSVG(svg, design);
      preview.innerHTML = nav;
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
      `  1. inject_template with template_path: "${entry?.id ?? id}" and the slot values above`,
      `     (the built-in id works directly — no file path needed; list_templates browses the catalog)`,
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

// Keep BUILTIN_THEMES referenced so tree-shaking doesn't drop it before the
// renderer evaluates `theme.ref`.
void BUILTIN_THEMES;

export const catalogDialog = new CatalogDialog();
