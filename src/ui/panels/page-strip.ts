import { type StateManager, type EditorState } from '../../editor/state';
import type { Page } from '../../schema/types';

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
    if (changedKeys.some(k => ['design', 'currentPageIndex'].includes(k))) {
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
      const thumb = this.createThumbnail(page, index, index === currentPageIndex);
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

  private createThumbnail(page: Page, index: number, active: boolean): HTMLElement {
    const thumb = document.createElement('div');
    const aspect = (this.state.get().design?.document.height ?? 1080) / (this.state.get().design?.document.width ?? 1080);

    thumb.style.cssText = `
      min-width: 60px; height: ${60 * aspect}px; background: var(--color-surface-2);
      border: 2px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'};
      border-radius: var(--radius-sm); cursor: pointer; position: relative;
      flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      font-size: 10px; color: var(--color-text-muted);
      ${active ? 'box-shadow: 0 0 0 2px var(--color-primary)' : ''};
    `;

    thumb.textContent = page.label ?? `${index + 1}`;
    thumb.title = page.label ?? `Page ${index + 1}`;

    thumb.addEventListener('click', () => {
      this.state.set('currentPageIndex', index, false);
    });

    return thumb;
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
