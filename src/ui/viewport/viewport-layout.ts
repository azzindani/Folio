/**
 * ViewportLayoutManager — multi-pane canvas viewport.
 *
 * Supports layout modes:
 *   single  — one canvas (default)
 *   split-h — 2 panes side by side (2×1)
 *   split-v — 2 panes stacked (1×2)
 *   grid22  — 2×2 grid (4 panes)
 *   cols3   — 3 panes side by side (3×1)
 *
 * Each pane gets its own canvas container. The shared StateManager drives
 * all panes from the same design; each pane may track a different page index.
 */

export type ViewportMode = 'single' | 'split-h' | 'split-v' | 'grid22' | 'cols3';

export interface PaneDescriptor {
  id: string;
  element: HTMLElement;
  pageIndex: number;
}

export class ViewportLayoutManager {
  private container: HTMLElement;
  private mode: ViewportMode = 'single';
  private panes: PaneDescriptor[] = [];
  private activePaneId: string = 'pane-0';

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.className = 'viewport-layout viewport-layout--single';
    this.applyMode('single');
  }

  getMode(): ViewportMode {
    return this.mode;
  }

  setMode(mode: ViewportMode): void {
    this.mode = mode;
    this.applyMode(mode);
  }

  getActivePaneEl(): HTMLElement | null {
    const pane = this.panes.find(p => p.id === this.activePaneId);
    return pane?.element ?? null;
  }

  getPanes(): PaneDescriptor[] {
    return [...this.panes];
  }

  setActivePaneById(id: string): void {
    if (this.panes.some(p => p.id === id)) {
      this.activePaneId = id;
      this.updateActiveStyles();
    }
  }

  private applyMode(mode: ViewportMode): void {
    const counts: Record<ViewportMode, number> = {
      single: 1,
      'split-h': 2,
      'split-v': 2,
      grid22: 4,
      cols3: 3,
    };

    const count = counts[mode];
    this.container.innerHTML = '';
    this.container.className = `viewport-layout viewport-layout--${mode}`;
    this.panes = [];

    for (let i = 0; i < count; i++) {
      const paneWrapper = document.createElement('div');
      paneWrapper.className = 'viewport-pane';
      const id = `pane-${i}`;
      paneWrapper.dataset.paneId = id;

      // Inner canvas area (CanvasManager will mount here)
      const inner = document.createElement('div');
      inner.className = 'canvas-area';
      paneWrapper.appendChild(inner);

      paneWrapper.addEventListener('click', () => {
        this.activePaneId = id;
        this.updateActiveStyles();
      });

      this.container.appendChild(paneWrapper);
      this.panes.push({ id, element: inner, pageIndex: i });
    }

    this.activePaneId = this.panes[0]?.id ?? 'pane-0';
    this.updateActiveStyles();
  }

  private updateActiveStyles(): void {
    this.container.querySelectorAll('.viewport-pane').forEach(p => {
      const el = p as HTMLElement;
      el.classList.toggle('active', el.dataset.paneId === this.activePaneId);
    });
  }
}
