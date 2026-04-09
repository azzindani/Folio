import { type StateManager, type EditorState } from '../../editor/state';
import type { Layer } from '../../schema/types';

const Z_BANDS = [
  { label: 'Foreground', min: 70, max: 89 },
  { label: 'Overlay', min: 50, max: 69 },
  { label: 'Content', min: 20, max: 49 },
  { label: 'Structural', min: 10, max: 19 },
  { label: 'Background', min: 0, max: 9 },
];

function getLayerIcon(type: string): string {
  const icons: Record<string, string> = {
    rect: '\u25A1', circle: '\u25CB', path: '\u2712', polygon: '\u2B21',
    line: '\u2015', text: 'T', image: '\u{1F5BC}', icon: '\u272A',
    component: '\u29C9', mermaid: '\u27A1', chart: '\u2261',
    code: '<>', math: '\u03C0', group: '\u25A3',
  };
  return icons[type] ?? '?';
}

export class LayerPanelManager {
  private container: HTMLElement;
  private state: StateManager;
  private content!: HTMLElement;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.content = container.querySelector('.layer-panel-content') ?? container;
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private onStateChange(state: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.some(k => ['design', 'currentPageIndex', 'selectedLayerIds'].includes(k))) {
      this.render();
    }
  }

  render(): void {
    const layers = this.state.getCurrentLayers();
    const selectedIds = this.state.get().selectedLayerIds;

    if (layers.length === 0) {
      this.content.innerHTML = '<div style="color:var(--color-text-muted);padding:16px;font-size:12px">No layers</div>';
      return;
    }

    let html = '<div class="layer-list" style="display:flex;flex-direction:column;gap:2px">';

    for (const band of Z_BANDS) {
      const bandLayers = layers
        .filter(l => l.z >= band.min && l.z <= band.max)
        .sort((a, b) => b.z - a.z);

      if (bandLayers.length === 0) continue;

      html += `<div class="layer-band">
        <div class="layer-band-header" style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);padding:4px 8px;margin-top:4px">${band.label} (z:${band.min}-${band.max})</div>`;

      for (const layer of bandLayers) {
        const selected = selectedIds.includes(layer.id);
        const hidden = layer.visible === false;
        const locked = layer.locked === true;

        html += `<div class="layer-row ${selected ? 'selected' : ''}"
          data-layer-id="${layer.id}"
          style="display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;
                 border-radius:4px;font-size:12px;
                 ${selected ? 'background:var(--color-primary);color:white' : ''}
                 ${hidden ? 'opacity:0.4' : ''}">
          <span style="width:16px;text-align:center;font-size:14px">${getLayerIcon(layer.type)}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${layer.id}</span>
          <span style="font-size:10px;color:${selected ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)'}">${layer.z}</span>
          ${locked ? '<span title="Locked" style="font-size:10px">&#x1F512;</span>' : ''}
        </div>`;
      }

      html += '</div>';
    }

    html += '</div>';
    this.content.innerHTML = html;

    // Bind click events
    this.content.querySelectorAll('.layer-row').forEach(row => {
      row.addEventListener('click', (e) => {
        const id = (row as HTMLElement).dataset.layerId!;
        const ev = e as MouseEvent;
        if (ev.shiftKey) {
          const current = this.state.get().selectedLayerIds;
          if (current.includes(id)) {
            this.state.set('selectedLayerIds', current.filter(i => i !== id));
          } else {
            this.state.set('selectedLayerIds', [...current, id]);
          }
        } else {
          this.state.set('selectedLayerIds', [id]);
        }
      });
    });
  }

  getLayersByBand(layers: Layer[]): Map<string, Layer[]> {
    const map = new Map<string, Layer[]>();
    for (const band of Z_BANDS) {
      const filtered = layers.filter(l => l.z >= band.min && l.z <= band.max);
      if (filtered.length > 0) {
        map.set(band.label, filtered.sort((a, b) => b.z - a.z));
      }
    }
    return map;
  }
}
