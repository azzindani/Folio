// Folio editor — selection actions shared by KeyboardManager, the canvas
// context menu, and panel buttons. Extracted from keyboard.ts so every
// surface drives the SAME implementation.
import { StateManager } from './state';
import type { Layer } from '../schema/types';
import { serializeYAML, parseYAML } from '../schema/parser';

let duplicateCounter = 0;
let groupCounter = 0;

export function deleteSelected(state: StateManager): void {
  const ids = state.get().selectedLayerIds;
  for (const id of ids) state.removeLayer(id);
  state.set('selectedLayerIds', []);
}

export function duplicateSelected(state: StateManager): void {
  const layers = state.getSelectedLayers();
  for (const layer of layers) {
    const clone = {
      ...layer,
      id: `${layer.id}-copy-${++duplicateCounter}`,
      x: (layer.x ?? 0) + 20,
      y: (layer.y ?? 0) + 20,
      z: layer.z + 1,
    };
    state.addLayer(clone);
  }
}

export function adjustZ(state: StateManager, delta: number): void {
  const ids = state.get().selectedLayerIds;
  for (const id of ids) {
    const layer = state.getCurrentLayers().find(l => l.id === id);
    if (layer) state.updateLayer(id, { z: layer.z + delta * 10 });
  }
}

export function copySelected(state: StateManager): void {
  const layers = state.getSelectedLayers();
  if (layers.length === 0) return;
  const snippet = serializeYAML(layers.length === 1 ? layers[0] : layers);
  navigator.clipboard?.writeText(snippet).catch(() => {/* clipboard not available */});
}

export function pasteFromClipboard(state: StateManager): void {
  navigator.clipboard?.readText().then(text => {
    try {
      const parsed = parseYAML<Layer[] | Layer>(text);
      const rawLayers: Layer[] = Array.isArray(parsed) ? parsed : [parsed];
      const newIds: string[] = [];
      for (const layer of rawLayers) {
        if (typeof layer !== 'object' || !layer || !('type' in layer)) continue;
        const newId = `${layer.id}-paste-${++duplicateCounter}`;
        newIds.push(newId);
        state.addLayer({ ...layer, id: newId, x: (layer.x ?? 0) + 20, y: (layer.y ?? 0) + 20 } as Layer);
      }
      if (newIds.length > 0) state.set('selectedLayerIds', newIds);
    } catch {
      // Invalid clipboard content — ignore
    }
  }).catch(() => {/* clipboard not available */});
}

export function groupSelected(state: StateManager): void {
  const layers = state.getSelectedLayers();
  if (layers.length < 2) return;
  const maxZ = Math.max(...layers.map(l => l.z));
  const groupId = `group-${++groupCounter}`;
  const minX = Math.min(...layers.map(l => l.x ?? 0));
  const minY = Math.min(...layers.map(l => l.y ?? 0));
  const maxX = Math.max(...layers.map(l => (l.x ?? 0) + (typeof l.width  === 'number' ? l.width  : 0)));
  const maxY = Math.max(...layers.map(l => (l.y ?? 0) + (typeof l.height === 'number' ? l.height : 0)));
  const groupLayer: Layer = {
    id: groupId,
    type: 'group',
    z: maxZ,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    layers: layers,
  } as unknown as Layer;

  for (const l of layers) state.removeLayer(l.id);
  state.addLayer(groupLayer);
  state.set('selectedLayerIds', [groupId]);
}

export function ungroupSelected(state: StateManager): void {
  const selected = state.getSelectedLayers();
  const groups = selected.filter(l => l.type === 'group');
  for (const group of groups) {
    const children: Layer[] = (group as unknown as { layers: Layer[] }).layers ?? [];
    state.removeLayer(group.id);
    for (const child of children) state.addLayer(child);
  }
  if (groups.length > 0) {
    const childIds = groups.flatMap(g => ((g as unknown as { layers: Layer[] }).layers ?? []).map((l: Layer) => l.id));
    state.set('selectedLayerIds', childIds);
  }
}

export function toggleLockSelected(state: StateManager): void {
  const layers = state.getSelectedLayers();
  if (layers.length === 0) return;
  const anyUnlocked = layers.some(l => !(l as { locked?: boolean }).locked);
  for (const l of layers) state.updateLayer(l.id, { locked: anyUnlocked } as Partial<Layer>);
}
