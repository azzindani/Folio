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
      ['design', 'theme', 'currentPageIndex', 'gridVisible'].includes(k),
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
      svg = renderPage(layers, width, height, { theme: theme ?? undefined, showGrid: this.state.get().gridVisible });
    } else {
      svg = renderDesign(design, { theme: theme ?? undefined, showGrid: this.state.get().gridVisible });
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
      const newX = Math.round(origX + dx);
      const newY = Math.round(origY + dy);
      this.state.updateLayer(layerId, { x: newX, y: newY });
      this.drawSmartGuides(layerId, newX, newY, layer);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      this.clearSmartGuides();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  private drawSmartGuides(
    draggedId: string,
    x: number,
    y: number,
    layer: Layer,
  ): void {
    this.clearSmartGuides();
    const w = typeof layer.width === 'number' ? layer.width : 0;
    const h = typeof layer.height === 'number' ? layer.height : 0;
    const others = this.state.getCurrentLayers().filter(l => l.id !== draggedId);
    const TOLERANCE = 4;

    const guides: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const doc = this.state.get().design?.document;
    const cw = doc?.width ?? 1080;
    const ch = doc?.height ?? 1080;

    for (const other of others) {
      const ox = other.x ?? 0;
      const oy = other.y ?? 0;
      const ow = typeof other.width === 'number' ? other.width : 0;
      const oh = typeof other.height === 'number' ? other.height : 0;

      // Horizontal edge alignments
      const hChecks = [
        [y, oy], [y, oy + oh], [y + h, oy], [y + h, oy + oh],
        [y + h / 2, oy + oh / 2],
      ];
      for (const [a, b] of hChecks) {
        if (Math.abs(a - b) < TOLERANCE) {
          guides.push({ x1: 0, y1: b, x2: cw, y2: b });
          break;
        }
      }

      // Vertical edge alignments
      const vChecks = [
        [x, ox], [x, ox + ow], [x + w, ox], [x + w, ox + ow],
        [x + w / 2, ox + ow / 2],
      ];
      for (const [a, b] of vChecks) {
        if (Math.abs(a - b) < TOLERANCE) {
          guides.push({ x1: b, y1: 0, x2: b, y2: ch });
          break;
        }
      }
    }

    if (guides.length === 0) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'smart-guides');
    svg.setAttribute('width', String(cw));
    svg.setAttribute('height', String(ch));
    svg.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:91;overflow:visible';
    for (const g of guides) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(g.x1));
      line.setAttribute('y1', String(g.y1));
      line.setAttribute('x2', String(g.x2));
      line.setAttribute('y2', String(g.y2));
      line.setAttribute('stroke', '#e94560');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-dasharray', '4 3');
      line.setAttribute('opacity', '0.8');
      svg.appendChild(line);
    }
    this.selectionOverlay.appendChild(svg);
  }

  private clearSmartGuides(): void {
    const el = this.selectionOverlay.querySelector('.smart-guides');
    if (el) el.remove();
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
