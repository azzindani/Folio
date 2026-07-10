import { type StateManager, type EditorState } from '../../editor/state';
import type { Page } from '../../schema/types';
import { renderPage } from '../../renderer/renderer';
import { composeTheme } from '../../styles/compose';

export class PageStrip {
  private container: HTMLElement;
  private state: StateManager;
  private strip!: HTMLDivElement;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.build();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private build(): void {
    this.strip = document.createElement('div');
    this.strip.className = 'page-strip';
    this.strip.style.cssText = `
      display: flex; gap: 8px; padding: 8px; overflow-x: auto;
      align-items: center; min-height: 80px;
    `;
    this.container.appendChild(this.strip);
  }

  private onStateChange(state: EditorState, changedKeys: (keyof EditorState)[]): void {
    // Watch the SAME appearance keys the main canvas does (theme + the picked
    // overlay primitives) so thumbnails never drift from the viewport — a stale
    // strip after picking a palette/font/effect is the "preview isn't the same"
    // confusion.
    if (changedKeys.some(k => ['design', 'currentPageIndex', 'theme', 'palette', 'typePack', 'effectsPack'].includes(k as string))) {
      this.render();
    }
  }

  render(): void {
    const { design, currentPageIndex } = this.state.get();
    if (!design?.pages || design.pages.length === 0) {
      this.strip.style.display = 'none';
      return;
    }

    this.strip.style.display = 'flex';
    this.strip.innerHTML = '';

    design.pages.forEach((page, index) => {
      const thumb = this.createThumbnail(page, index, index === currentPageIndex, design.document.width, design.document.height);
      this.strip.appendChild(thumb);
    });

    // Add "+" button
    const addBtn = document.createElement('div');
    addBtn.style.cssText = `
      min-width: 60px; height: 60px; border: 2px dashed var(--color-border);
      border-radius: var(--radius-sm); display: flex; align-items: center;
      justify-content: center; cursor: pointer; color: var(--color-text-muted);
      font-size: 20px; flex-shrink: 0;
    `;
    addBtn.textContent = '+';
    addBtn.title = 'Add page';
    addBtn.addEventListener('click', () => this.state.addPage());
    this.strip.appendChild(addBtn);
  }

  private createThumbnail(page: Page, index: number, active: boolean, docW: number, docH: number): HTMLElement {
    const THUMB_W = 72;
    const aspect = docH / (docW || 1);
    const THUMB_H = Math.round(THUMB_W * aspect);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position: relative; flex-shrink: 0; cursor: pointer;
      border: 2px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'};
      border-radius: var(--radius-sm);
      ${active ? 'box-shadow: 0 0 0 2px var(--color-primary);' : ''}
      width: ${THUMB_W}px; height: ${THUMB_H + 18}px;
      background: var(--color-surface-2);
      display: flex; flex-direction: column; overflow: hidden;
    `;
    wrapper.title = page.label ?? `Page ${index + 1}`;

    // SVG thumbnail
    const svgWrap = document.createElement('div');
    svgWrap.style.cssText = `
      width: ${THUMB_W}px; height: ${THUMB_H}px; overflow: hidden;
      flex-shrink: 0; background: var(--color-surface-2); position: relative;
    `;

    try {
      const { theme, palette, typePack, effectsPack } = this.state.get();
      // Compose the theme with the picked overlays exactly like the main canvas
      // (composeTheme returns the base theme by reference when nothing is picked),
      // so a thumbnail always matches the viewport for the same page.
      const composed = theme
        ? composeTheme(theme, { palette: palette ?? undefined, typePack: typePack ?? undefined, effectsPack: effectsPack ?? undefined })
        : undefined;
      const svg = renderPage(page.layers ?? [], docW, docH, { theme: composed });
      svg.setAttribute('width', String(THUMB_W));
      svg.setAttribute('height', String(THUMB_H));
      svg.style.display = 'block';
      svg.style.pointerEvents = 'none';
      svgWrap.appendChild(svg);
    } catch {
      // Render failed — show blank thumbnail
      svgWrap.style.background = 'var(--color-surface-3)';
    }

    // Page label
    const label = document.createElement('div');
    label.style.cssText = `
      height: 18px; line-height: 18px; font-size: 9px; text-align: center;
      color: var(--color-text-muted); white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; padding: 0 4px; flex-shrink: 0;
      background: var(--color-surface);
      ${active ? 'color: var(--color-primary); font-weight: 600;' : ''}
    `;
    label.textContent = page.label ?? `${index + 1}`;

    wrapper.appendChild(svgWrap);
    wrapper.appendChild(label);

    wrapper.addEventListener('click', () => {
      this.state.set('currentPageIndex', index, false);
    });

    // Right-click context menu for rename/delete
    wrapper.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.openPageContextMenu(e, index);
    });

    return wrapper;
  }

  private openPageContextMenu(e: MouseEvent, pageIndex: number): void {
    const existing = document.querySelector('.page-context-menu');
    existing?.remove();

    const menu = document.createElement('div');
    menu.className = 'page-context-menu';
    menu.style.cssText = `
      position: fixed; left: ${e.clientX}px; top: ${e.clientY}px;
      background: var(--color-surface-2); border: 1px solid var(--color-border);
      border-radius: var(--radius-sm); box-shadow: var(--shadow-md);
      z-index: 500; min-width: 140px; overflow: hidden; font-size: 12px;
    `;

    const item = (label: string, action: () => void) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `
        display: block; width: 100%; padding: 6px 12px; border: none;
        background: transparent; color: var(--color-text); cursor: pointer;
        text-align: left; font-size: 12px;
      `;
      btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--color-surface-3)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
      btn.addEventListener('click', () => { menu.remove(); action(); });
      return btn;
    };

    const pageCount = this.state.get().design?.pages?.length ?? 0;

    menu.appendChild(item('Duplicate page', () => {
      this.state.goToPage(pageIndex);
      this.state.duplicateCurrentPage();
    }));

    if (pageIndex > 0) {
      menu.appendChild(item('Move left', () => { this.state.goToPage(pageIndex); this.state.movePage(-1); }));
    }
    if (pageCount > 1 && pageIndex < pageCount - 1) {
      menu.appendChild(item('Move right', () => { this.state.goToPage(pageIndex); this.state.movePage(1); }));
    }

    menu.appendChild(item('Rename page…', () => {
      const design = this.state.get().design;
      if (!design?.pages) return;
      const current = design.pages[pageIndex]?.label ?? `Page ${pageIndex + 1}`;
      const name = prompt('Page name:', current);
      if (name !== null && name.trim()) {
        const pages = design.pages.map((p, i) => i === pageIndex ? { ...p, label: name.trim() } : p);
        this.state.set('design', { ...design, pages });
      }
    }));

    if (pageCount > 1) {
      menu.appendChild(item('Delete page', () => {
        this.state.goToPage(pageIndex);
        this.state.deleteCurrentPage();
      }));
    }

    document.body.appendChild(menu);

    const dismiss = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('click', dismiss, true); }
    };
    setTimeout(() => document.addEventListener('click', dismiss, true), 0);
  }

}
