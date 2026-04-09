import { StateManager, type EditorState, type ToolId } from './state';
import { renderDesign, renderPage } from '../renderer/renderer';
import type { Layer } from '../schema/types';

let layerCounter = 0;

export class CanvasManager {
  private container: HTMLElement;
  private state: StateManager;
  private viewport!: HTMLDivElement;
  private svgContainer!: HTMLDivElement;
  private selectionOverlay!: HTMLDivElement;
  private currentSVG: SVGSVGElement | null = null;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.buildCanvas();
    this.bindEvents();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private buildCanvas(): void {
    this.viewport = document.createElement('div');
    this.viewport.className = 'canvas-viewport';

    this.svgContainer = document.createElement('div');
    this.svgContainer.className = 'canvas-svg-container';
    this.svgContainer.style.position = 'relative';

    this.selectionOverlay = document.createElement('div');
    this.selectionOverlay.className = 'canvas-selection-overlay';
    this.selectionOverlay.style.position = 'absolute';
    this.selectionOverlay.style.inset = '0';
    this.selectionOverlay.style.pointerEvents = 'none';
    this.selectionOverlay.style.zIndex = '90';

    this.viewport.appendChild(this.svgContainer);
    this.viewport.appendChild(this.selectionOverlay);
    this.container.appendChild(this.viewport);
  }

  private bindEvents(): void {
    this.svgContainer.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.container.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
  }

  private onStateChange(state: EditorState, changedKeys: (keyof EditorState)[]): void {
    const needsRender = changedKeys.some(k =>
      ['design', 'theme', 'currentPageIndex'].includes(k),
    );

    if (needsRender) {
      this.render();
    }

    if (changedKeys.includes('selectedLayerIds')) {
      this.updateSelectionOverlay();
    }

    if (changedKeys.includes('zoom') || changedKeys.includes('panX') || changedKeys.includes('panY')) {
      this.updateTransform();
    }

    if (changedKeys.includes('activeTool')) {
      const isDraw = state.activeTool !== 'select';
      this.container.classList.toggle('tool-draw', isDraw);
    }
  }

  render(): void {
    const { design, theme } = this.state.get();
    if (!design) return;

    const { width, height } = design.document;

    // Check if we're in paged mode
    const pages = design.pages;
    const currentPageIndex = this.state.get().currentPageIndex;

    let svg: SVGSVGElement;

    if (pages && pages.length > 0) {
      const pageIdx = Math.min(currentPageIndex, pages.length - 1);
      const page = pages[pageIdx];
      const layers = page?.layers ?? [];
      svg = renderPage(layers, width, height, { theme: theme ?? undefined });
    } else {
      svg = renderDesign(design, { theme: theme ?? undefined });
    }

    // Replace SVG
    this.svgContainer.innerHTML = '';
    this.svgContainer.appendChild(svg);
    this.currentSVG = svg;

    // Size viewport
    this.viewport.style.width = `${width}px`;
    this.viewport.style.height = `${height}px`;
    this.updateTransform();
  }

  private updateTransform(): void {
    const { zoom, panX, panY } = this.state.get();
    this.viewport.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    this.viewport.style.transformOrigin = 'center center';
  }

  private updateSelectionOverlay(): void {
    this.selectionOverlay.innerHTML = '';
    const { selectedLayerIds, design } = this.state.get();

    if (!design || selectedLayerIds.length === 0) return;

    for (const id of selectedLayerIds) {
      const el = this.svgContainer.querySelector(`[data-layer-id="${id}"]`);
      if (!el) continue;

      const bbox = (el as SVGGraphicsElement).getBBox?.();
      if (!bbox) continue;

      // Selection box
      const box = document.createElement('div');
      box.className = 'selection-box';
      box.style.left = `${bbox.x}px`;
      box.style.top = `${bbox.y}px`;
      box.style.width = `${bbox.width}px`;
      box.style.height = `${bbox.height}px`;
      this.selectionOverlay.appendChild(box);

      // Resize handles (corners)
      const positions = [
        { cls: 'nw', x: bbox.x - 4, y: bbox.y - 4, cursor: 'nw-resize' },
        { cls: 'ne', x: bbox.x + bbox.width - 4, y: bbox.y - 4, cursor: 'ne-resize' },
        { cls: 'sw', x: bbox.x - 4, y: bbox.y + bbox.height - 4, cursor: 'sw-resize' },
        { cls: 'se', x: bbox.x + bbox.width - 4, y: bbox.y + bbox.height - 4, cursor: 'se-resize' },
      ];

      for (const pos of positions) {
        const handle = document.createElement('div');
        handle.className = `selection-handle handle-${pos.cls}`;
        handle.style.left = `${pos.x}px`;
        handle.style.top = `${pos.y}px`;
        handle.style.cursor = pos.cursor;
        handle.style.pointerEvents = 'auto';
        handle.dataset.handle = pos.cls;
        handle.dataset.layerId = id;
        this.selectionOverlay.appendChild(handle);
      }

      // Rotate handle — centered above the top edge
      const rotateHandle = document.createElement('div');
      rotateHandle.className = 'selection-handle handle-rotate';
      rotateHandle.style.left = `${bbox.x + bbox.width / 2 - 4}px`;
      rotateHandle.style.top = `${bbox.y - 28}px`;
      rotateHandle.style.cursor = 'crosshair';
      rotateHandle.style.pointerEvents = 'auto';
      rotateHandle.style.borderRadius = '50%';
      rotateHandle.style.background = 'var(--color-primary)';
      rotateHandle.dataset.handle = 'rotate';
      rotateHandle.dataset.layerId = id;
      rotateHandle.title = 'Rotate';
      rotateHandle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.startRotate(e, id, bbox);
      });
      this.selectionOverlay.appendChild(rotateHandle);
    }
  }

  private startRotate(
    e: PointerEvent,
    layerId: string,
    bbox: DOMRect | SVGRect,
  ): void {
    const layer = this.state.getCurrentLayers().find(l => l.id === layerId);
    if (!layer || layer.locked) return;

    // Center of the bounding box in viewport coordinates
    const zoom = this.state.get().zoom;
    const vpRect = this.viewport.getBoundingClientRect();
    const cx = vpRect.left + (bbox.x + bbox.width / 2) * zoom;
    const cy = vpRect.top + (bbox.y + bbox.height / 2) * zoom;

    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - cx;
      const dy = me.clientY - cy;
      const angle = Math.round(Math.atan2(dy, dx) * (180 / Math.PI) + 90);
      const normalized = ((angle % 360) + 360) % 360;
      this.state.updateLayer(layerId, { rotation: normalized });
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  private onPointerDown(e: PointerEvent): void {
    const { activeTool } = this.state.get();

    // Drawing tool — create a new layer at click position
    if (activeTool !== 'select') {
      this.createLayerAt(e, activeTool);
      // Switch back to select after placing
      this.state.set('activeTool', 'select', false);
      return;
    }

    const target = e.target as SVGElement;
    const layerEl = target.closest('[data-layer-id]') as SVGElement | null;

    if (!layerEl) {
      // Click on empty canvas — deselect
      this.state.set('selectedLayerIds', []);
      return;
    }

    const layerId = layerEl.getAttribute('data-layer-id')!;

    if (e.shiftKey) {
      const current = this.state.get().selectedLayerIds;
      if (current.includes(layerId)) {
        this.state.set('selectedLayerIds', current.filter(id => id !== layerId));
      } else {
        this.state.set('selectedLayerIds', [...current, layerId]);
      }
    } else {
      this.state.set('selectedLayerIds', [layerId]);
      this.startDrag(e, layerId);
    }
  }

  private createLayerAt(e: PointerEvent, tool: Exclude<ToolId, 'select'>): void {
    const vpRect = this.viewport.getBoundingClientRect();
    const zoom = this.state.get().zoom;
    const canvasX = Math.round((e.clientX - vpRect.left) / zoom);
    const canvasY = Math.round((e.clientY - vpRect.top) / zoom);
    const id = `${tool}-${++layerCounter}`;

    const base = { id, z: 20 + layerCounter };

    const newLayer: Layer = (() => {
      switch (tool) {
        case 'rect': return {
          ...base, type: 'rect', x: canvasX - 50, y: canvasY - 50, width: 100, height: 100,
          fill: { type: 'solid', color: '#6c5ce7' },
        } as Layer;
        case 'circle': return {
          ...base, type: 'circle', x: canvasX - 50, y: canvasY - 50, width: 100, height: 100,
          fill: { type: 'solid', color: '#6c5ce7' },
        } as Layer;
        case 'line': return {
          ...base, type: 'line', x: canvasX, y: canvasY, x1: canvasX, y1: canvasY,
          x2: canvasX + 100, y2: canvasY, width: 100, height: 0,
          stroke: { color: '#6c5ce7', width: 2 },
        } as Layer;
        case 'text': return {
          ...base, type: 'text', x: canvasX - 75, y: canvasY - 12, width: 150, height: 'auto',
          content: { type: 'plain', value: 'Text' },
          style: { font_family: 'Inter', font_size: 24, font_weight: 400, color: '#FFFFFF' },
        } as Layer;
      }
    })();

    this.state.addLayer(newLayer);
    this.state.set('selectedLayerIds', [id]);
  }

  private startDrag(e: PointerEvent, layerId: string): void {
    const layer = this.state.getCurrentLayers().find(l => l.id === layerId);
    if (!layer || layer.locked) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = layer.x ?? 0;
    const origY = layer.y ?? 0;
    const zoom = this.state.get().zoom;

    const onMove = (me: PointerEvent) => {
      const dx = (me.clientX - startX) / zoom;
      const dy = (me.clientY - startY) / zoom;
      this.state.updateLayer(layerId, {
        x: Math.round(origX + dx),
        y: Math.round(origY + dy),
      });
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(5, Math.max(0.1, this.state.get().zoom * delta));
      this.state.set('zoom', newZoom, false);
    } else {
      // Pan
      const { panX, panY } = this.state.get();
      this.state.batch(() => {
        this.state.set('panX', panX - e.deltaX, false);
        this.state.set('panY', panY - e.deltaY, false);
      });
    }
  }

  exportSVG(): string {
    if (!this.currentSVG) return '';
    return new XMLSerializer().serializeToString(this.currentSVG);
  }

  fitToScreen(): void {
    const { design } = this.state.get();
    if (!design) return;

    const containerRect = this.container.getBoundingClientRect();
    const scaleX = (containerRect.width - 80) / design.document.width;
    const scaleY = (containerRect.height - 80) / design.document.height;
    const zoom = Math.min(scaleX, scaleY, 1);

    this.state.batch(() => {
      this.state.set('zoom', zoom, false);
      this.state.set('panX', 0, false);
      this.state.set('panY', 0, false);
    });
  }
}
