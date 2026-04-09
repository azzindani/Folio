import interact from 'interactjs';
import { StateManager } from './state';
import type { Layer } from '../schema/types';

export class InteractionManager {
  private state: StateManager;
  private svgContainer: HTMLElement;
  private activeInteractables: ReturnType<typeof interact>[] = [];

  constructor(svgContainer: HTMLElement, state: StateManager) {
    this.svgContainer = svgContainer;
    this.state = state;
  }

  enable(): void {
    this.setupDraggable();
    this.setupResizable();
  }

  disable(): void {
    for (const interactable of this.activeInteractables) {
      interactable.unset();
    }
    this.activeInteractables = [];
  }

  refresh(): void {
    this.disable();
    this.enable();
  }

  private setupDraggable(): void {
    const interactable = interact('[data-layer-id]', {
      context: this.svgContainer,
    }).draggable({
      listeners: {
        start: (event) => {
          const layerId = this.getLayerId(event.target);
          if (!layerId) return;
          const layer = this.findLayer(layerId);
          if (layer?.locked) return;
          this.state.set('selectedLayerIds', [layerId]);
        },
        move: (event) => {
          const layerId = this.getLayerId(event.target);
          if (!layerId) return;

          const layer = this.findLayer(layerId);
          if (!layer || layer.locked) return;

          const zoom = this.state.get().zoom;
          const dx = event.dx / zoom;
          const dy = event.dy / zoom;

          this.state.updateLayer(layerId, {
            x: Math.round((layer.x ?? 0) + dx),
            y: Math.round((layer.y ?? 0) + dy),
          });
        },
      },
      modifiers: [
        interact.modifiers.snap({
          targets: [interact.snappers.grid({ x: 8, y: 8 })],
          range: 12,
          relativePoints: [{ x: 0, y: 0 }],
          enabled: this.state.get().gridVisible,
        }),
      ],
    });

    this.activeInteractables.push(interactable);
  }

  private setupResizable(): void {
    const interactable = interact('.selection-handle', {
      context: this.svgContainer.parentElement!,
    }).draggable({
      listeners: {
        move: (event) => {
          const handle = (event.target as HTMLElement).dataset.handle;
          const layerId = (event.target as HTMLElement).dataset.layerId;
          if (!handle || !layerId) return;

          const layer = this.findLayer(layerId);
          if (!layer || layer.locked) return;

          const zoom = this.state.get().zoom;
          const dx = event.dx / zoom;
          const dy = event.dy / zoom;

          const updates = this.computeResize(layer, handle, dx, dy);
          this.state.updateLayer(layerId, updates);
        },
      },
    });

    this.activeInteractables.push(interactable);
  }

  private computeResize(
    layer: Layer,
    handle: string,
    dx: number,
    dy: number,
  ): Partial<Layer> {
    const x = layer.x ?? 0;
    const y = layer.y ?? 0;
    const w = typeof layer.width === 'number' ? layer.width : 0;
    const h = typeof layer.height === 'number' ? layer.height : 0;

    switch (handle) {
      case 'se':
        return { width: Math.max(10, Math.round(w + dx)), height: Math.max(10, Math.round(h + dy)) };
      case 'sw':
        return { x: Math.round(x + dx), width: Math.max(10, Math.round(w - dx)), height: Math.max(10, Math.round(h + dy)) };
      case 'ne':
        return { y: Math.round(y + dy), width: Math.max(10, Math.round(w + dx)), height: Math.max(10, Math.round(h - dy)) };
      case 'nw':
        return { x: Math.round(x + dx), y: Math.round(y + dy), width: Math.max(10, Math.round(w - dx)), height: Math.max(10, Math.round(h - dy)) };
      default:
        return {};
    }
  }

  private getLayerId(target: EventTarget): string | null {
    const el = target as SVGElement;
    const layerEl = el.closest?.('[data-layer-id]') ?? el;
    return layerEl.getAttribute?.('data-layer-id') ?? null;
  }

  private findLayer(id: string): Layer | undefined {
    return this.state.getCurrentLayers().find(l => l.id === id);
  }
}

// ── Alignment Utilities ─────────────────────────────────────
export interface Bounds { x: number; y: number; width: number; height: number }

function getLayerBounds(layer: Layer): Bounds {
  return {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: typeof layer.width === 'number' ? layer.width : 0,
    height: typeof layer.height === 'number' ? layer.height : 0,
  };
}

export function alignLeft(state: StateManager): void {
  const layers = state.getSelectedLayers();
  if (layers.length < 2) return;
  const minX = Math.min(...layers.map(l => l.x ?? 0));
  for (const l of layers) state.updateLayer(l.id, { x: minX });
}

export function alignRight(state: StateManager): void {
  const layers = state.getSelectedLayers();
  if (layers.length < 2) return;
  const maxRight = Math.max(...layers.map(l => (l.x ?? 0) + (typeof l.width === 'number' ? l.width : 0)));
  for (const l of layers) {
    const w = typeof l.width === 'number' ? l.width : 0;
    state.updateLayer(l.id, { x: maxRight - w });
  }
}

export function alignTop(state: StateManager): void {
  const layers = state.getSelectedLayers();
  if (layers.length < 2) return;
  const minY = Math.min(...layers.map(l => l.y ?? 0));
  for (const l of layers) state.updateLayer(l.id, { y: minY });
}

export function alignBottom(state: StateManager): void {
  const layers = state.getSelectedLayers();
  if (layers.length < 2) return;
  const maxBottom = Math.max(...layers.map(l => (l.y ?? 0) + (typeof l.height === 'number' ? l.height : 0)));
  for (const l of layers) {
    const h = typeof l.height === 'number' ? l.height : 0;
    state.updateLayer(l.id, { y: maxBottom - h });
  }
}

export function alignCenterH(state: StateManager): void {
  const layers = state.getSelectedLayers();
  if (layers.length < 2) return;
  const bounds = layers.map(getLayerBounds);
  const avgCx = bounds.reduce((s, b) => s + b.x + b.width / 2, 0) / bounds.length;
  for (let i = 0; i < layers.length; i++) {
    state.updateLayer(layers[i].id, { x: Math.round(avgCx - bounds[i].width / 2) });
  }
}

export function alignCenterV(state: StateManager): void {
  const layers = state.getSelectedLayers();
  if (layers.length < 2) return;
  const bounds = layers.map(getLayerBounds);
  const avgCy = bounds.reduce((s, b) => s + b.y + b.height / 2, 0) / bounds.length;
  for (let i = 0; i < layers.length; i++) {
    state.updateLayer(layers[i].id, { y: Math.round(avgCy - bounds[i].height / 2) });
  }
}

export function distributeH(state: StateManager): void {
  const layers = state.getSelectedLayers();
  if (layers.length < 3) return;
  const sorted = [...layers].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  const bounds = sorted.map(getLayerBounds);
  const totalWidth = bounds.reduce((s, b) => s + b.width, 0);
  const firstX = bounds[0].x;
  const lastX = bounds[bounds.length - 1].x + bounds[bounds.length - 1].width;
  const gap = (lastX - firstX - totalWidth) / (layers.length - 1);

  let currentX = firstX;
  for (let i = 0; i < sorted.length; i++) {
    state.updateLayer(sorted[i].id, { x: Math.round(currentX) });
    currentX += bounds[i].width + gap;
  }
}

export function distributeV(state: StateManager): void {
  const layers = state.getSelectedLayers();
  if (layers.length < 3) return;
  const sorted = [...layers].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  const bounds = sorted.map(getLayerBounds);
  const totalHeight = bounds.reduce((s, b) => s + b.height, 0);
  const firstY = bounds[0].y;
  const lastY = bounds[bounds.length - 1].y + bounds[bounds.length - 1].height;
  const gap = (lastY - firstY - totalHeight) / (layers.length - 1);

  let currentY = firstY;
  for (let i = 0; i < sorted.length; i++) {
    state.updateLayer(sorted[i].id, { y: Math.round(currentY) });
    currentY += bounds[i].height + gap;
  }
}
