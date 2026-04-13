import { type StateManager } from '../../editor/state';
import { ALL_ICON_NAMES, LUCIDE_ICONS } from '../../renderer/lucide-icons';
import type { IconLayer } from '../../schema/types';

export class IconBrowserManager {
  private container: HTMLElement;
  private state: StateManager;
  private searchEl!: HTMLInputElement;
  private gridEl!: HTMLElement;
  private filter = '';

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.build();
  }

  private build(): void {
    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
        <div style="padding:6px 8px;border-bottom:1px solid var(--color-border)">
          <input class="ib-search" type="search" placeholder="Search icons…"
            style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);
                   border-radius:4px;padding:4px 8px;color:var(--color-text);font-size:11px;
                   outline:none;box-sizing:border-box">
        </div>
        <div class="ib-grid"
          style="flex:1;overflow-y:auto;display:grid;
                 grid-template-columns:repeat(auto-fill,minmax(44px,1fr));
                 gap:2px;padding:6px;align-content:start">
        </div>
        <div class="ib-footer"
          style="padding:4px 8px;border-top:1px solid var(--color-border);
                 font-size:10px;color:var(--color-text-muted)">
          ${ALL_ICON_NAMES.length} icons
        </div>
      </div>`;

    this.searchEl = this.container.querySelector<HTMLInputElement>('.ib-search')!;
    this.gridEl   = this.container.querySelector<HTMLElement>('.ib-grid')!;

    this.searchEl.addEventListener('input', () => {
      this.filter = this.searchEl.value.trim().toLowerCase();
      this.renderGrid();
    });

    this.renderGrid();
  }

  private renderGrid(): void {
    const names = this.filter
      ? ALL_ICON_NAMES.filter(n => n.includes(this.filter))
      : ALL_ICON_NAMES;

    // Update footer count
    const footer = this.container.querySelector<HTMLElement>('.ib-footer');
    if (footer) footer.textContent = `${names.length} icons`;

    // Build icon tiles
    const frag = document.createDocumentFragment();
    for (const name of names) {
      const btn = document.createElement('button');
      btn.className = 'ib-tile';
      btn.title = name;
      btn.style.cssText =
        'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'gap:2px;padding:4px 2px;border:none;border-radius:4px;cursor:pointer;' +
        'background:transparent;color:var(--color-text);';

      // Inline SVG preview (16×16)
      const inner = LUCIDE_ICONS[name];
      btn.innerHTML =
        `<svg viewBox="0 0 24 24" width="18" height="18"
          stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"
          fill="none" style="pointer-events:none">${inner}</svg>` +
        `<span style="font-size:7px;color:var(--color-text-muted);
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          max-width:42px;pointer-events:none">${name}</span>`;

      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'var(--color-surface)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
      });
      btn.addEventListener('click', () => this.insertIcon(name));
      frag.appendChild(btn);
    }

    this.gridEl.innerHTML = '';
    this.gridEl.appendChild(frag);
  }

  private insertIcon(name: string): void {
    const design = this.state.get().design;
    if (!design) return;

    const layers = design.layers ?? design.pages?.[0]?.layers ?? [];
    const maxZ = layers.reduce((m, l) => Math.max(m, l.z), 0);

    const layer: IconLayer = {
      id: `icon-${name}-${Date.now()}`,
      type: 'icon',
      z: maxZ + 1,
      x: 100, y: 100,
      width: 48, height: 48,
      name,
      size: 48,
      color: '#ffffff',
    };

    this.state.addLayer(layer);
    this.state.set('selectedLayerIds', [layer.id]);
  }
}
