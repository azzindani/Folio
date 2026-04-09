import { type StateManager, type EditorState } from '../../editor/state';
import type { EditorApp } from '../../editor/app';

export class ToolbarManager {
  private container: HTMLElement;
  private state: StateManager;
  private app: EditorApp;

  constructor(container: HTMLElement, state: StateManager, app: EditorApp) {
    this.container = container;
    this.state = state;
    this.app = app;
    this.build();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private build(): void {
    this.container.innerHTML = `
      <div class="toolbar-left" style="display:flex;align-items:center;gap:12px;flex:1">
        <strong style="color:var(--color-primary);font-size:16px">Folio</strong>
        <span class="toolbar-project-name" style="color:var(--color-text-muted);font-size:13px">Untitled</span>
      </div>
      <div class="toolbar-center" style="display:flex;align-items:center;gap:8px">
        <div class="mode-toggle">
          <button class="mode-btn active" data-mode="visual">Visual</button>
          <button class="mode-btn" data-mode="payload">Payload</button>
        </div>
      </div>
      <div class="toolbar-right" style="display:flex;align-items:center;gap:8px">
        <span class="toolbar-zoom" style="color:var(--color-text-muted);font-size:12px;min-width:48px;text-align:center">100%</span>
        <button class="btn btn-sm" data-action="zoom-fit" title="Fit to screen">Fit</button>
        <button class="btn btn-sm" data-action="undo" title="Undo">&#8617;</button>
        <button class="btn btn-sm" data-action="redo" title="Redo">&#8618;</button>
        <button class="btn btn-primary btn-sm" data-action="export" title="Export PNG">Export</button>
      </div>
    `;

    this.container.addEventListener('click', this.onClick.bind(this));
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;

    // Mode toggle
    if (target.classList.contains('mode-btn')) {
      const mode = target.dataset.mode as 'visual' | 'payload';
      this.state.set('mode', mode, false);
    }

    // Actions
    const action = target.dataset.action;
    if (action === 'undo') this.state.undo();
    if (action === 'redo') this.state.redo();
    if (action === 'zoom-fit') this.app.canvas.fitToScreen();
    if (action === 'export') this.triggerExport();
  }

  private async triggerExport(): Promise<void> {
    const svgStr = this.app.exportSVG();
    if (!svgStr) return;

    // Export as SVG download for now
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = this.state.get().design?.meta?.name ?? 'design';
    a.download = `${name}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private onStateChange(state: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.includes('zoom')) {
      const zoomEl = this.container.querySelector('.toolbar-zoom');
      if (zoomEl) zoomEl.textContent = `${Math.round(state.zoom * 100)}%`;
    }

    if (changedKeys.includes('mode')) {
      const btns = this.container.querySelectorAll('.mode-btn');
      btns.forEach(btn => {
        const el = btn as HTMLElement;
        el.classList.toggle('active', el.dataset.mode === state.mode);
      });
    }

    if (changedKeys.includes('design') && state.design) {
      const nameEl = this.container.querySelector('.toolbar-project-name');
      if (nameEl) nameEl.textContent = state.design.meta.name;
    }
  }
}
