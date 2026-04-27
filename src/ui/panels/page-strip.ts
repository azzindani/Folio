import { type StateManager, type EditorState } from '../../editor/state';
import type { Page } from '../../schema/types';
import { renderPage } from '../../renderer/renderer';

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
    if (changedKeys.some(k => ['design', 'currentPageIndex', 'theme'].includes(k as string))) {
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
    addBtn.addEventListener('click', () => this.addPage());
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
      flex-shrink: 0; background: #fff; position: relative;
    `;

    try {
      const { theme } = this.state.get();
      const svg = renderPage(page.layers ?? [], docW, docH, { theme: theme ?? undefined });
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

    const design = this.state.get().design;
    if ((design?.pages?.length ?? 0) > 1) {
      menu.appendChild(item('Delete page', () => {
        const d = this.state.get().design;
        if (!d?.pages) return;
        const pages = d.pages.filter((_, i) => i !== pageIndex);
        const idx = Math.min(this.state.get().currentPageIndex, pages.length - 1);
        this.state.set('design', { ...d, pages });
        this.state.set('currentPageIndex', Math.max(0, idx), false);
      }));
    }

    document.body.appendChild(menu);

    const dismiss = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('click', dismiss, true); }
    };
    setTimeout(() => document.addEventListener('click', dismiss, true), 0);
  }

  private addPage(): void {
    const design = this.state.get().design;
    if (!design) return;

    const pages = design.pages ?? [];
    const newPage: Page = {
      id: `page_${pages.length + 1}`,
      label: `Page ${pages.length + 1}`,
      layers: [],
    };

    this.state.set('design', {
      ...design,
      pages: [...pages, newPage],
    });
    this.state.set('currentPageIndex', pages.length, false);
  }
}
