import { type StateManager, type EditorState } from '../../editor/state';
import type { Layer } from '../../schema/types';

const Z_BANDS = [
  { label: 'Foreground', min: 70, max: 89 },
  { label: 'Overlay', min: 50, max: 69 },
  { label: 'Content', min: 20, max: 49 },
  { label: 'Structural', min: 10, max: 19 },
  { label: 'Background', min: 0, max: 9 },
];

const ROW_HEIGHT = 32; // px per row
const HEADER_HEIGHT = 24; // px per band header
const BUFFER_ROWS = 2;

function getLayerIcon(type: string): string {
  const icons: Record<string, string> = {
    rect: '\u25A1', circle: '\u25CB', path: '\u2712', polygon: '\u2B21',
    line: '\u2015', text: 'T', image: '\u{1F5BC}', icon: '\u272A',
    component: '\u29C9', mermaid: '\u27A1', chart: '\u2261',
    code: '<>', math: '\u03C0', group: '\u25A3',
  };
  return icons[type] ?? '?';
}

// Virtual scroll row: either a band header or a layer row
type VRow =
  | { kind: 'header'; label: string; height: number }
  | { kind: 'layer'; layer: Layer; height: number };

export class LayerPanelManager {
  private container: HTMLElement;
  private state: StateManager;
  private content!: HTMLElement;
  private rows: VRow[] = [];
  private editingLayerId: string | null = null;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.content = container.querySelector('.layer-panel-content') ?? container;
    this.buildVirtualScroll();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private buildVirtualScroll(): void {
    this.content.style.cssText = 'position:relative;overflow-y:auto;height:100%';
    this.content.addEventListener('scroll', this.onScroll.bind(this));

    // Single delegated click listener
    this.content.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-layer-id]');
      if (!row) return;
      if ((e.target as HTMLElement).tagName === 'INPUT') return; // editing
      const id = row.dataset.layerId!;
      if ((e as MouseEvent).shiftKey) {
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

    // Double-click to rename layer
    this.content.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-layer-id]');
      if (!row) return;
      const id = row.dataset.layerId!;
      this.startRename(row, id);
    });
  }

  private startRename(row: HTMLElement, layerId: string): void {
    const nameSpan = row.querySelector<HTMLElement>('.layer-name');
    if (!nameSpan) return;

    this.editingLayerId = layerId;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = layerId;
    input.style.cssText = `
      background: var(--color-surface-2); border: 1px solid var(--color-primary);
      color: var(--color-text); font-size: 12px; padding: 0 4px;
      border-radius: 3px; width: 100%; outline: none;
    `;

    const commitRename = (): void => {
      const newId = input.value.trim();
      this.editingLayerId = null;
      if (newId && newId !== layerId) {
        this.state.renameLayer(layerId, newId);
      } else {
        this.render(); // restore original display
      }
    };

    input.addEventListener('blur', commitRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { this.editingLayerId = null; this.render(); }
    });

    nameSpan.replaceWith(input);
    input.select();
    input.focus();
  }

  private onStateChange(_state: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.some(k => ['design', 'currentPageIndex', 'selectedLayerIds'].includes(k))) {
      this.render();
    }
  }

  render(): void {
    const layers = this.state.getCurrentLayers();
    this.rows = this.buildRows(layers);
    this.paintViewport();
  }

  private buildRows(layers: Layer[]): VRow[] {
    const rows: VRow[] = [];
    for (const band of Z_BANDS) {
      const bandLayers = layers
        .filter(l => l.z >= band.min && l.z <= band.max)
        .sort((a, b) => b.z - a.z);
      if (bandLayers.length === 0) continue;
      rows.push({ kind: 'header', label: `${band.label} (z:${band.min}-${band.max})`, height: HEADER_HEIGHT });
      for (const layer of bandLayers) {
        rows.push({ kind: 'layer', layer, height: ROW_HEIGHT });
      }
    }
    return rows;
  }

  private paintViewport(): void {
    if (this.rows.length === 0) {
      this.content.innerHTML = '<div style="color:var(--color-text-muted);padding:16px;font-size:12px">No layers</div>';
      return;
    }

    const selectedIds = this.state.get().selectedLayerIds;
    const totalHeight = this.rows.reduce((s, r) => s + r.height, 0);
    const panelHeight = this.content.clientHeight || 200;
    const scrollTop = this.content.scrollTop;

    // Compute cumulative offsets once
    const offsets: number[] = [];
    let acc = 0;
    for (const row of this.rows) {
      offsets.push(acc);
      acc += row.height;
    }

    // Find first row whose bottom edge is visible — use index param, not indexOf
    let startIdx = offsets.findIndex((o, idx) => o + this.rows[idx].height > scrollTop);
    if (startIdx < 0) startIdx = 0;
    startIdx = Math.max(0, startIdx - BUFFER_ROWS);

    let endIdx = startIdx;
    while (endIdx < this.rows.length && offsets[endIdx] < scrollTop + panelHeight) {
      endIdx++;
    }
    endIdx = Math.min(this.rows.length, endIdx + BUFFER_ROWS);

    // Render: spacer top + visible rows + spacer bottom
    const topSpace = offsets[startIdx] ?? 0;
    const bottomSpace = totalHeight - (offsets[endIdx - 1] ?? totalHeight) - (this.rows[endIdx - 1]?.height ?? 0);

    let html = `<div class="layer-vscroll-inner" style="position:relative">`;
    html += `<div style="height:${topSpace}px"></div>`;

    for (let i = startIdx; i < endIdx; i++) {
      const row = this.rows[i];
      if (row.kind === 'header') {
        html += `<div class="layer-band-header" style="height:${HEADER_HEIGHT}px;line-height:${HEADER_HEIGHT}px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);padding:0 8px">${row.label}</div>`;
      } else {
        const layer = row.layer;
        const selected = selectedIds.includes(layer.id);
        const hidden = layer.visible === false;
        const locked = layer.locked === true;
        html += `<div class="layer-row${selected ? ' selected' : ''}" data-layer-id="${layer.id}"
          style="height:${ROW_HEIGHT}px;display:flex;align-items:center;gap:6px;padding:0 8px;cursor:pointer;border-radius:4px;font-size:12px;${selected ? 'background:var(--color-primary);color:white;' : ''}${hidden ? 'opacity:0.4;' : ''}">
          <span style="width:16px;text-align:center;font-size:14px">${getLayerIcon(layer.type)}</span>
          <span class="layer-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${layer.id}</span>
          <span style="font-size:10px;color:${selected ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)'}">${layer.z}</span>
          ${locked ? '<span title="Locked" style="font-size:10px">&#x1F512;</span>' : ''}
        </div>`;
      }
    }

    html += `<div style="height:${Math.max(0, bottomSpace)}px"></div>`;
    html += `</div>`;

    this.content.innerHTML = html;
  }

  private onScroll(): void {
    this.paintViewport();
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
