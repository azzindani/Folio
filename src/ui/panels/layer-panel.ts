import { type StateManager, type EditorState } from '../../editor/state';
import type { Layer, GroupLayer } from '../../schema/types';

const LAYER_ICONS: Record<string, string> = {
  rect: '▭', circle: '◯', path: '✒', polygon: '⬡',
  line: '—', text: 'T', image: '🖼', icon: '✦',
  component: '⊞', mermaid: '➡', chart: '≡',
  code: '<>', math: 'π', group: '▣', qrcode: '⊞',
};

interface TreeNode {
  layer: Layer;
  depth: number;
  collapsed: boolean;
  hasChildren: boolean;
}

function flattenTree(layers: Layer[], collapsed: Set<string>, depth = 0): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (const layer of [...layers].sort((a, b) => b.z - a.z)) {
    const isGroup = layer.type === 'group';
    const children = isGroup ? (layer as GroupLayer).layers ?? [] : [];
    const isCollapsed = collapsed.has(layer.id);
    nodes.push({ layer, depth, collapsed: isCollapsed, hasChildren: children.length > 0 });
    if (isGroup && !isCollapsed && children.length > 0) {
      nodes.push(...flattenTree(children, collapsed, depth + 1));
    }
  }
  return nodes;
}

export class LayerPanelManager {
  private container: HTMLElement;
  private state: StateManager;
  private list!: HTMLElement;
  private collapsed = new Set<string>();
  private draggingId: string | null = null;
  private dropTarget: string | null = null;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.build();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private build(): void {
    this.list = document.createElement('div');
    this.list.className = 'layer-list';
    this.list.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;min-height:0';
    // Persistent delegated listeners — bound once, never removed
    this.list.addEventListener('click', this.onClick.bind(this));
    this.list.addEventListener('dblclick', this.onDblClick.bind(this));
    this.container.appendChild(this.list);
    this.render();
  }

  private onStateChange(_s: EditorState, keys: (keyof EditorState)[]): void {
    if (keys.some(k => ['design', 'currentPageIndex'].includes(k as string))) {
      this.render();
    } else if (keys.includes('selectedLayerIds')) {
      this.updateSelectionClasses();
    }
  }

  private updateSelectionClasses(): void {
    const selected = this.state.get().selectedLayerIds;
    this.list.querySelectorAll<HTMLElement>('.layer-row').forEach(row => {
      const id = row.dataset.layerId;
      row.classList.toggle('selected', !!id && selected.includes(id));
    });
  }

  render(): void {
    const layers = this.state.getCurrentLayers();
    const nodes = flattenTree(layers, this.collapsed);
    const selected = this.state.get().selectedLayerIds;

    let html = '';
    for (const node of nodes) {
      html += this.renderRow(node, selected);
    }
    if (!html) {
      html = '<div class="layer-empty">No layers</div>';
    }
    this.list.innerHTML = html;
    this.bindDragDrop();
  }

  private renderRow(node: TreeNode, selected: string[]): string {
    const { layer, depth, collapsed, hasChildren } = node;
    const sel = selected.includes(layer.id);
    const hidden = layer.visible === false;
    const locked = layer.locked === true;
    const icon = LAYER_ICONS[layer.type] ?? '?';
    const indent = depth * 16;

    return `<div class="layer-row${sel ? ' selected' : ''}${hidden ? ' layer-hidden' : ''}"
      data-layer-id="${layer.id}" data-depth="${depth}"
      draggable="true" tabindex="0">
      <div class="layer-row-indent" style="width:${indent}px;flex-shrink:0"></div>
      <button class="layer-collapse-btn${hasChildren ? '' : ' invisible'}"
        data-action="collapse" data-layer-id="${layer.id}"
        aria-label="${collapsed ? 'Expand' : 'Collapse'}" aria-expanded="${!collapsed}">
        ${hasChildren ? (collapsed ? '▶' : '▼') : ''}
      </button>
      <span class="layer-icon">${icon}</span>
      <span class="layer-name" title="${layer.id}">${layer.id}</span>
      <span class="layer-z">${layer.z}</span>
      <button class="layer-vis-btn" data-action="toggle-vis" data-layer-id="${layer.id}"
        title="${hidden ? 'Show layer' : 'Hide layer'}" aria-pressed="${hidden}">
        ${hidden ? '🙈' : '👁'}
      </button>
      <button class="layer-lock-btn${locked ? ' active' : ''}" data-action="toggle-lock"
        data-layer-id="${layer.id}" title="${locked ? 'Unlock' : 'Lock'}" aria-pressed="${locked}">
        ${locked ? '🔒' : '🔓'}
      </button>
    </div>`;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-action]');
    if (btn) {
      e.stopPropagation();
      this.handleAction(btn.dataset.action!, btn.dataset.layerId!);
      return;
    }
    const row = target.closest<HTMLElement>('[data-layer-id]');
    if (!row) return;
    const id = row.dataset.layerId!;
    const cur = this.state.get().selectedLayerIds;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      this.state.set('selectedLayerIds', cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
    } else {
      this.state.set('selectedLayerIds', [id]);
    }
  }

  private onDblClick(e: MouseEvent): void {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-layer-id]');
    if (!row) return;
    const id = row.dataset.layerId!;
    const nameEl = row.querySelector<HTMLElement>('.layer-name');
    if (!nameEl) return;
    this.startRename(nameEl, id);
  }

  private handleAction(action: string, layerId: string): void {
    if (action === 'collapse') {
      if (this.collapsed.has(layerId)) this.collapsed.delete(layerId);
      else this.collapsed.add(layerId);
      this.render();
      return;
    }
    const layer = this.state.getCurrentLayers().find(l => l.id === layerId);
    if (!layer) return;
    if (action === 'toggle-vis') {
      this.state.updateLayer(layerId, { visible: layer.visible !== false ? false : true });
    } else if (action === 'toggle-lock') {
      this.state.updateLayer(layerId, { locked: !layer.locked });
    }
    // state.updateLayer triggers design change → onStateChange → render()
  }

  private startRename(el: HTMLElement, layerId: string): void {
    const input = document.createElement('input');
    input.className = 'layer-rename-input';
    input.value = layerId;
    const commit = (): void => {
      const v = input.value.trim();
      if (v && v !== layerId) this.state.renameLayer(layerId, v);
      else this.render();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') this.render();
    });
    el.replaceWith(input);
    input.select();
    input.focus();
  }

  private bindDragDrop(): void {
    this.list.querySelectorAll<HTMLElement>('.layer-row[draggable]').forEach(row => {
      row.addEventListener('dragstart', (e) => {
        this.draggingId = row.dataset.layerId ?? null;
        e.dataTransfer?.setData('text/plain', this.draggingId ?? '');
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        this.draggingId = null;
        this.dropTarget = null;
        this.list.querySelectorAll('.drop-target').forEach(r => r.classList.remove('drop-target'));
        row.classList.remove('dragging');
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (row.dataset.layerId === this.draggingId) return;
        this.dropTarget = row.dataset.layerId ?? null;
        this.list.querySelectorAll('.drop-target').forEach(r => r.classList.remove('drop-target'));
        row.classList.add('drop-target');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromId = this.draggingId;
        const toId = row.dataset.layerId ?? null;
        if (fromId && toId && fromId !== toId) {
          this.moveLayerBefore(fromId, toId);
        }
      });
    });
  }

  private moveLayerBefore(fromId: string, beforeId: string): void {
    const layers = [...this.state.getCurrentLayers()];
    const fromIdx = layers.findIndex(l => l.id === fromId);
    const toIdx   = layers.findIndex(l => l.id === beforeId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = layers.splice(fromIdx, 1);
    const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
    layers.splice(insertAt, 0, moved);
    // Reassign z values to preserve display order
    layers.forEach((l, i) => { l.z = layers.length - i; });
    const design = this.state.get().design;
    if (!design) return;
    if (design.pages?.length) {
      const pages = design.pages.map((p, i) => {
        if (i === this.state.get().currentPageIndex) return { ...p, layers };
        return p;
      });
      this.state.set('design', { ...design, pages });
    } else {
      this.state.set('design', { ...design, layers });
    }
  }

  getLayersByBand(layers: Layer[]): Map<string, Layer[]> {
    const map = new Map<string, Layer[]>();
    map.set('All', layers);
    return map;
  }
}
