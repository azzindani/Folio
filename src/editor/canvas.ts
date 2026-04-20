import { StateManager, type EditorState, type ToolId, type RulerUnit } from './state';
import { renderDesign, renderPage } from '../renderer/renderer';
import type { Layer } from '../schema/types';
import { computeRulerTicks } from '../utils/ruler-units';

let layerCounter = 0;

const RULER_SIZE = 20; // px width/height of ruler strips

export class CanvasManager {
  private container: HTMLElement;
  private state: StateManager;
  private viewport!: HTMLDivElement;
  private svgContainer!: HTMLDivElement;
  private selectionOverlay!: HTMLDivElement;
  private currentSVG: SVGSVGElement | null = null;
  private rulerH!: HTMLCanvasElement;
  private rulerV!: HTMLCanvasElement;

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
    this.buildRulers();
  }

  private buildRulers(): void {
    // Corner box
    const corner = document.createElement('div');
    corner.className = 'ruler-corner';
    corner.style.cssText =
      `position:absolute;top:0;left:0;width:${RULER_SIZE}px;height:${RULER_SIZE}px;` +
      `background:var(--color-surface);border-right:1px solid var(--color-border);` +
      `border-bottom:1px solid var(--color-border);z-index:30;`;

    this.rulerH = document.createElement('canvas');
    this.rulerH.className = 'ruler-h';
    this.rulerH.height = RULER_SIZE;
    this.rulerH.style.cssText =
      `position:absolute;top:0;left:${RULER_SIZE}px;right:0;height:${RULER_SIZE}px;` +
      `z-index:29;cursor:default;`;

    this.rulerV = document.createElement('canvas');
    this.rulerV.className = 'ruler-v';
    this.rulerV.width = RULER_SIZE;
    this.rulerV.style.cssText =
      `position:absolute;left:0;top:${RULER_SIZE}px;bottom:0;width:${RULER_SIZE}px;` +
      `z-index:29;cursor:default;`;

    this.container.appendChild(corner);
    this.container.appendChild(this.rulerH);
    this.container.appendChild(this.rulerV);

    // Offset viewport to make room for rulers
    this.viewport.style.marginTop  = `${RULER_SIZE}px`;
    this.viewport.style.marginLeft = `${RULER_SIZE}px`;
  }

  private updateRulers(): void {
    const { zoom = 1, panX = 0, panY = 0, rulerUnit = 'px' } = this.state.get();
    const containerW = this.container.clientWidth  - RULER_SIZE;
    const containerH = this.container.clientHeight - RULER_SIZE;

    // ── Horizontal ruler ────────────────────────────────────
    this.rulerH.width = Math.max(1, containerW);
    const ctxH = this.rulerH.getContext('2d');
    if (ctxH) {
      drawRuler(ctxH, containerW, RULER_SIZE, zoom, panX, 'h', rulerUnit);
    }

    // ── Vertical ruler ──────────────────────────────────────
    this.rulerV.height = Math.max(1, containerH);
    const ctxV = this.rulerV.getContext('2d');
    if (ctxV) {
      drawRuler(ctxV, containerH, RULER_SIZE, zoom, panY, 'v', rulerUnit);
    }
  }

  private bindEvents(): void {
    this.svgContainer.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.container.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    this.container.addEventListener('mousemove', this.onMouseMoveForAnnotations.bind(this));
    this.container.addEventListener('mouseleave', () => this.clearAnnotations());
  }

  // ── Distance annotation overlay ─────────────────────────────
  private annotationOverlay: HTMLCanvasElement | null = null;

  private getOrCreateAnnotationOverlay(): HTMLCanvasElement {
    if (!this.annotationOverlay) {
      const cv = document.createElement('canvas');
      cv.className = 'annotation-overlay';
      cv.style.cssText =
        'position:absolute;inset:0;pointer-events:none;z-index:80;';
      this.container.appendChild(cv);
      this.annotationOverlay = cv;
    }
    this.annotationOverlay.width  = this.container.clientWidth;
    this.annotationOverlay.height = this.container.clientHeight;
    return this.annotationOverlay;
  }

  private clearAnnotations(): void {
    if (!this.annotationOverlay) return;
    const ctx = this.annotationOverlay.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, this.annotationOverlay.width, this.annotationOverlay.height);
  }

  private onMouseMoveForAnnotations(e: MouseEvent): void {
    if (!e.altKey) { this.clearAnnotations(); return; }

    const { selectedLayerIds, zoom = 1, panX = 0, panY = 0 } = this.state.get();
    if (!selectedLayerIds.length || !this.currentSVG) { this.clearAnnotations(); return; }

    // Get selected layer bbox in canvas-px
    const selId = selectedLayerIds[0];
    const selEl = this.svgContainer.querySelector<SVGGraphicsElement>(`[data-layer-id="${selId}"]`);
    if (!selEl) { this.clearAnnotations(); return; }

    const selBBox = selEl.getBBox();
    const containerRect = this.container.getBoundingClientRect();

    // Convert SVG coords → screen px within container
    const toScreen = (sx: number, sy: number) => ({
      x: sx * zoom + panX + RULER_SIZE,
      y: sy * zoom + panY + RULER_SIZE,
    });

    // Find hovered element
    const mx = e.clientX - containerRect.left - RULER_SIZE;
    const my = e.clientY - containerRect.top  - RULER_SIZE;
    // Convert to design coords
    const dx = (mx - panX) / zoom;
    const dy = (my - panY) / zoom;

    // Find any layer bbox under cursor (excluding selected)
    const layers = this.state.getCurrentLayers();
    let hovBBox: SVGRect | null = null;
    for (const l of layers) {
      if (l.id === selId) continue;
      const el = this.svgContainer.querySelector<SVGGraphicsElement>(`[data-layer-id="${l.id}"]`);
      if (!el) continue;
      const bb = el.getBBox();
      if (dx >= bb.x && dx <= bb.x + bb.width && dy >= bb.y && dy <= bb.y + bb.height) {
        hovBBox = bb;
        break;
      }
    }

    const cv = this.getOrCreateAnnotationOverlay();
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);

    const refBBox = hovBBox ?? ({ x: 0, y: 0, width: this.currentSVG.viewBox.baseVal.width, height: this.currentSVG.viewBox.baseVal.height } as SVGRect);

    // Draw distance lines between selBBox and refBBox
    ctx.strokeStyle = '#e94560';
    ctx.fillStyle   = '#e94560';
    ctx.font = 'bold 10px sans-serif';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);

    const gaps = measureGaps(selBBox, refBBox);
    const selS  = { x: toScreen(selBBox.x, selBBox.y), w: selBBox.width * zoom, h: selBBox.height * zoom };
    const refS  = { x: toScreen(refBBox.x, refBBox.y), w: refBBox.width * zoom, h: refBBox.height * zoom };

    // Left gap
    if (gaps.left !== null) {
      const y = selS.x.y + selS.h / 2;
      const x1 = refS.x.x + refS.w;
      const x2 = selS.x.x;
      drawArrowLine(ctx, x1, y, x2, y);
      drawLabel(ctx, (x1 + x2) / 2, y - 4, `${Math.round(gaps.left)}`);
    }
    // Right gap
    if (gaps.right !== null) {
      const y = selS.x.y + selS.h / 2;
      const x1 = selS.x.x + selS.w;
      const x2 = refS.x.x;
      drawArrowLine(ctx, x1, y, x2, y);
      drawLabel(ctx, (x1 + x2) / 2, y - 4, `${Math.round(gaps.right)}`);
    }
    // Top gap
    if (gaps.top !== null) {
      const x = selS.x.x + selS.w / 2;
      const y1 = refS.x.y + refS.h;
      const y2 = selS.x.y;
      drawArrowLine(ctx, x, y1, x, y2);
      drawLabel(ctx, x + 4, (y1 + y2) / 2, `${Math.round(gaps.top)}`);
    }
    // Bottom gap
    if (gaps.bottom !== null) {
      const x = selS.x.x + selS.w / 2;
      const y1 = selS.x.y + selS.h;
      const y2 = refS.x.y;
      drawArrowLine(ctx, x, y1, x, y2);
      drawLabel(ctx, x + 4, (y1 + y2) / 2, `${Math.round(gaps.bottom)}`);
    }
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

    if (changedKeys.includes('zoom') || changedKeys.includes('panX') || changedKeys.includes('panY') || changedKeys.includes('rulerUnit')) {
      this.updateTransform();
      this.updateRulers();
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
    this.updateRulers();
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
        case 'polygon': return {
          ...base, type: 'polygon', x: canvasX - 50, y: canvasY - 50, width: 100, height: 100,
          sides: 6, fill: { type: 'solid', color: '#6c5ce7' },
        } as Layer;
        default: return {
          ...base, type: 'rect', x: canvasX - 50, y: canvasY - 50, width: 100, height: 100,
          fill: { type: 'solid', color: '#6c5ce7' },
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

// ── Ruler drawing helper ─────────────────────────────────────
function drawRuler(
  ctx: CanvasRenderingContext2D,
  length: number,
  thickness: number,
  zoom: number,
  pan: number,
  axis: 'h' | 'v',
  unit: RulerUnit = 'px',
): void {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const bg      = isDark ? '#1e1e2e' : '#f0efee';
  const border  = isDark ? '#2d2d4e' : '#d1cfc9';
  const tickClr = isDark ? '#555577' : '#aaa9a5';
  const textClr = isDark ? '#7a7a9a' : '#888682';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0,
    axis === 'h' ? length : thickness,
    axis === 'h' ? thickness : length,
  );

  // Border line along the canvas edge
  ctx.fillStyle = border;
  if (axis === 'h') {
    ctx.fillRect(0, thickness - 1, length, 1);
  } else {
    ctx.fillRect(thickness - 1, 0, 1, length);
  }

  ctx.font = `9px sans-serif`;
  ctx.textBaseline = 'top';

  // Design-px range visible in the viewport
  const startDesignPx = -pan / zoom;
  const endDesignPx   = (length / zoom) - pan / zoom;

  const ticks = computeRulerTicks(startDesignPx, endDesignPx, unit, zoom);

  for (const tick of ticks) {
    const screenPx = Math.round(tick.px * zoom + pan);
    if (screenPx < 0 || screenPx > length) continue;

    if (axis === 'h') {
      ctx.fillStyle = tickClr;
      ctx.fillRect(screenPx, thickness - 6, 1, 6);
      ctx.fillStyle = textClr;
      ctx.fillText(tick.label, screenPx + 2, 2);
    } else {
      ctx.fillStyle = tickClr;
      ctx.fillRect(thickness - 6, screenPx, 6, 1);
      ctx.save();
      ctx.fillStyle = textClr;
      ctx.translate(2, screenPx - 1);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(tick.label, 0, 0);
      ctx.restore();
    }
  }
}

// ── Distance annotation helpers ──────────────────────────────

function measureGaps(
  sel: SVGRect,
  ref: SVGRect,
): { left: number | null; right: number | null; top: number | null; bottom: number | null } {
  const left   = sel.x > ref.x + ref.width  ? sel.x - (ref.x + ref.width)  : null;
  const right  = ref.x > sel.x + sel.width  ? ref.x - (sel.x + sel.width)  : null;
  const top    = sel.y > ref.y + ref.height ? sel.y - (ref.y + ref.height) : null;
  const bottom = ref.y > sel.y + sel.height ? ref.y - (sel.y + sel.height) : null;
  return { left, right, top, bottom };
}

function drawArrowLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
): void {
  if (Math.abs(x2 - x1) < 2 && Math.abs(y2 - y1) < 2) return;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  // Small end ticks
  const isH = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  ctx.setLineDash([]);
  ctx.beginPath();
  if (isH) {
    ctx.moveTo(x1, y1 - 4); ctx.lineTo(x1, y1 + 4);
    ctx.moveTo(x2, y2 - 4); ctx.lineTo(x2, y2 + 4);
  } else {
    ctx.moveTo(x1 - 4, y1); ctx.lineTo(x1 + 4, y1);
    ctx.moveTo(x2 - 4, y2); ctx.lineTo(x2 + 4, y2);
  }
  ctx.stroke();
  ctx.setLineDash([3, 3]);
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  text: string,
): void {
  const w = ctx.measureText(text).width + 6;
  ctx.setLineDash([]);
  ctx.fillStyle = '#e94560';
  ctx.fillRect(x - w / 2, y - 10, w, 14);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x - w / 2 + 3, y);
  ctx.setLineDash([3, 3]);
  ctx.fillStyle = '#e94560';
}
