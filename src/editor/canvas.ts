import { StateManager, type EditorState, type ToolId, type RulerUnit, type Guide } from './state';
import { renderDesign, renderPage } from '../renderer/renderer';
import type { Layer, TextLayer } from '../schema/types';
import { computeRulerTicks } from '../utils/ruler-units';

let guideCounter = 0;

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
  private marqueeEl: HTMLDivElement | null = null;

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
    this.svgContainer.addEventListener('dblclick', this.onDblClick.bind(this));
    this.container.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    this.container.addEventListener('mousemove', this.onMouseMoveForAnnotations.bind(this));
    this.container.addEventListener('mouseleave', () => this.clearAnnotations());
    this.rulerH.addEventListener('pointerdown', (e) => this.startGuide(e, 'h'));
    this.rulerV.addEventListener('pointerdown', (e) => this.startGuide(e, 'v'));
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
      // Keep selection handles in sync with the moved/resized layer
      if (this.state.get().selectedLayerIds.length > 0) {
        this.updateSelectionOverlay();
      }
    }

    if (changedKeys.includes('selectedLayerIds')) {
      this.updateSelectionOverlay();
    }

    if (changedKeys.includes('zoom') || changedKeys.includes('panX') || changedKeys.includes('panY') || changedKeys.includes('rulerUnit')) {
      this.updateTransform();
      this.updateRulers();
    }

    if (changedKeys.includes('guides') || changedKeys.includes('zoom') || changedKeys.includes('panX') || changedKeys.includes('panY')) {
      this.renderGuideLines();
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

    // Set viewport bg color BEFORE the SVG swap so any transparent gap
    // between old/new SVG shows the correct paper color, not the dark
    // editor surface (the "dimming" the user reported).
    const paper = inferCanvasPaper(design);
    if (paper) this.viewport.style.setProperty('--canvas-paper', paper);

    let svg: SVGSVGElement;

    if (pages && pages.length > 0) {
      const pageIdx = Math.min(currentPageIndex, pages.length - 1);
      const page = pages[pageIdx];
      const layers = page?.layers ?? [];
      svg = renderPage(layers, width, height, { theme: theme ?? undefined, showGrid: this.state.get().gridVisible });
    } else {
      svg = renderDesign(design, { theme: theme ?? undefined, showGrid: this.state.get().gridVisible });
    }

    // Atomic swap — no blank white frame between renders
    if (this.currentSVG && this.currentSVG.parentElement === this.svgContainer) {
      this.currentSVG.replaceWith(svg);
    } else {
      this.svgContainer.innerHTML = '';
      this.svgContainer.appendChild(svg);
    }
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

    const frag = document.createDocumentFragment();

    for (const id of selectedLayerIds) {
      const el = this.svgContainer.querySelector(`[data-layer-id="${id}"]`);
      if (!el) continue;
      const bbox = (el as SVGGraphicsElement).getBBox?.();
      if (!bbox) continue;

      const box = document.createElement('div');
      box.className = 'selection-box';
      box.style.left = `${bbox.x}px`;
      box.style.top = `${bbox.y}px`;
      box.style.width = `${bbox.width}px`;
      box.style.height = `${bbox.height}px`;
      frag.appendChild(box);

      const cx = bbox.x + bbox.width / 2;
      const cy = bbox.y + bbox.height / 2;
      const handles8 = [
        { cls: 'nw', x: bbox.x,              y: bbox.y,               cursor: 'nw-resize' },
        { cls: 'n',  x: cx,                   y: bbox.y,               cursor: 'n-resize'  },
        { cls: 'ne', x: bbox.x + bbox.width,  y: bbox.y,               cursor: 'ne-resize' },
        { cls: 'e',  x: bbox.x + bbox.width,  y: cy,                   cursor: 'e-resize'  },
        { cls: 'se', x: bbox.x + bbox.width,  y: bbox.y + bbox.height, cursor: 'se-resize' },
        { cls: 's',  x: cx,                   y: bbox.y + bbox.height, cursor: 's-resize'  },
        { cls: 'sw', x: bbox.x,               y: bbox.y + bbox.height, cursor: 'sw-resize' },
        { cls: 'w',  x: bbox.x,               y: cy,                   cursor: 'w-resize'  },
      ];

      const layerData = this.state.getCurrentLayers().find(l => l.id === id) as unknown as Record<string, unknown> | undefined;
      const origX = typeof layerData?.['x'] === 'number' ? (layerData['x'] as number) : bbox.x;
      const origY = typeof layerData?.['y'] === 'number' ? (layerData['y'] as number) : bbox.y;
      const origW = typeof layerData?.['width']  === 'number' ? (layerData['width']  as number) : bbox.width;
      const origH = typeof layerData?.['height'] === 'number' ? (layerData['height'] as number) : bbox.height;

      for (const pos of handles8) {
        const handle = document.createElement('div');
        handle.className = `selection-handle handle-${pos.cls}`;
        handle.style.left = `${pos.x - 5}px`;
        handle.style.top  = `${pos.y - 5}px`;
        handle.style.cursor = pos.cursor;
        handle.style.pointerEvents = 'auto';
        handle.dataset.handle = pos.cls;
        handle.dataset.layerId = id;
        handle.addEventListener('pointerdown', (ev) => {
          this.startResize(ev, id, pos.cls, origX, origY, origW, origH);
        });
        // Double-click on handle opens inline text editor for text layers
        handle.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          const layer = this.state.getCurrentLayers().find(l => l.id === id);
          if (layer?.type === 'text') {
            const svgEl = this.svgContainer.querySelector<SVGElement>(`[data-layer-id="${id}"]`);
            if (svgEl) this.openInlineTextEditor(layer as TextLayer, svgEl);
          }
        });
        frag.appendChild(handle);
      }

      // Double-click on selection box also opens inline editor
      box.style.pointerEvents = 'auto';
      box.style.cursor = 'move';
      box.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        const layer = this.state.getCurrentLayers().find(l => l.id === id);
        if (layer?.type === 'text') {
          const svgEl = this.svgContainer.querySelector<SVGElement>(`[data-layer-id="${id}"]`);
          if (svgEl) this.openInlineTextEditor(layer as TextLayer, svgEl);
        }
      });

      const rotateHandle = document.createElement('div');
      rotateHandle.className = 'selection-handle handle-rotate';
      rotateHandle.style.left = `${cx - 7}px`;
      rotateHandle.style.top  = `${bbox.y - 32}px`;
      rotateHandle.style.cursor = 'grab';
      rotateHandle.style.pointerEvents = 'auto';
      rotateHandle.dataset.handle = 'rotate';
      rotateHandle.dataset.layerId = id;
      rotateHandle.title = 'Rotate (Shift = 15° snap)';
      rotateHandle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.startRotate(e, id, bbox);
      });
      frag.appendChild(rotateHandle);
    }

    this.selectionOverlay.appendChild(frag);
  }

  private startRotate(
    e: PointerEvent,
    layerId: string,
    bbox: DOMRect | SVGRect,
  ): void {
    const layer = this.state.getCurrentLayers().find(l => l.id === layerId);
    if (!layer || layer.locked) return;

    const zoom = this.state.get().zoom;
    const panX = this.state.get().panX;
    const panY = this.state.get().panY;
    const vpRect = this.container.getBoundingClientRect();

    // Center in screen coordinates (accounting for ruler offset)
    const cx = vpRect.left + RULER_SIZE + ((bbox.x + bbox.width / 2) * zoom + panX);
    const cy = vpRect.top  + RULER_SIZE + ((bbox.y + bbox.height / 2) * zoom + panY);

    // Angle tooltip
    const tip = document.createElement('div');
    tip.className = 'rotation-tip';
    tip.style.cssText = `position:fixed;background:rgba(0,0,0,.75);color:#fff;font-size:11px;
      padding:3px 8px;border-radius:4px;pointer-events:none;z-index:500;font-family:monospace`;
    document.body.appendChild(tip);

    let interactionStarted = false;
    const onMove = (me: PointerEvent) => {
      if (!interactionStarted) {
        interactionStarted = true;
        this.state.beginInteraction();
      }
      const dx = me.clientX - cx;
      const dy = me.clientY - cy;
      let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
      if (me.shiftKey) angle = Math.round(angle / 15) * 15;
      const normalized = Math.round(((angle % 360) + 360) % 360);
      this.state.updateLayer(layerId, { rotation: normalized }, false);
      tip.textContent = `${normalized}°`;
      tip.style.left = `${me.clientX + 14}px`;
      tip.style.top  = `${me.clientY - 8}px`;
    };

    const onUp = () => {
      tip.remove();
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  private startMarquee(e: PointerEvent): void {
    if (!e.shiftKey) this.state.set('selectedLayerIds', []);

    const vpRect = this.viewport.getBoundingClientRect();
    const startX = e.clientX - vpRect.left;
    const startY = e.clientY - vpRect.top;

    // Create visual marquee rect
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;border:1.5px dashed #5b9cf6;background:rgba(91,156,246,0.08);
      pointer-events:none;z-index:100;box-sizing:border-box;`;
    el.style.left = `${startX}px`; el.style.top = `${startY}px`;
    el.style.width = '0'; el.style.height = '0';
    this.viewport.appendChild(el);
    this.marqueeEl = el;

    const onMove = (ev: PointerEvent) => {
      const cx = ev.clientX - vpRect.left;
      const cy = ev.clientY - vpRect.top;
      const x = Math.min(startX, cx), y = Math.min(startY, cy);
      const w = Math.abs(cx - startX),  h = Math.abs(cy - startY);
      el.style.left = `${x}px`; el.style.top  = `${y}px`;
      el.style.width = `${w}px`; el.style.height = `${h}px`;
    };

    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      el.remove(); this.marqueeEl = null;

      const cx = ev.clientX - vpRect.left;
      const cy = ev.clientY - vpRect.top;
      if (Math.abs(cx - startX) < 4 && Math.abs(cy - startY) < 4) return; // tiny drag = click

      const { zoom = 1, panX = 0, panY = 0 } = this.state.get();
      // Convert marquee corners to design coords
      const rx1 = (Math.min(startX, cx) - panX) / zoom;
      const ry1 = (Math.min(startY, cy) - panY) / zoom;
      const rx2 = (Math.max(startX, cx) - panX) / zoom;
      const ry2 = (Math.max(startY, cy) - panY) / zoom;

      const hit = this.state.getCurrentLayers().filter(l => {
        const lx = l.x ?? 0;  const ly = l.y ?? 0;
        const lw = typeof l.width  === 'number' ? l.width  : 0;
        const lh = typeof l.height === 'number' ? l.height : 0;
        return lx < rx2 && lx + lw > rx1 && ly < ry2 && ly + lh > ry1;
      }).map(l => l.id);

      if (e.shiftKey) {
        const prev = this.state.get().selectedLayerIds;
        this.state.set('selectedLayerIds', [...new Set([...prev, ...hit])]);
      } else {
        this.state.set('selectedLayerIds', hit);
      }
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
      // Begin rubber-band / marquee selection
      this.startMarquee(e);
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
        case 'frame': return {
          ...base, type: 'auto_layout', x: canvasX - 100, y: canvasY - 80, width: 200, height: 160,
          direction: 'row', gap: 12, padding: 16,
          align_items: 'center', justify_content: 'start',
          fill: { type: 'solid', color: '#1e1e2e' },
          layers: [],
        } as unknown as Layer;
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
    let moved = false;

    const onMove = (me: PointerEvent) => {
      const dx = (me.clientX - startX) / zoom;
      const dy = (me.clientY - startY) / zoom;
      // 3px threshold avoids accidental drags on a click
      if (!moved && Math.abs(dx) < 3 / zoom && Math.abs(dy) < 3 / zoom) return;
      if (!moved) {
        moved = true;
        this.state.beginInteraction();
      }
      let newX = Math.round(origX + dx);
      let newY = Math.round(origY + dy);

      // Snap to ruler guides
      if (this.state.get().snapEnabled) {
        const { guides } = this.state.get();
        const SNAP = 6;
        for (const g of guides) {
          if (g.axis === 'v') {
            if (Math.abs(newX - g.position) < SNAP) newX = g.position;
          } else {
            if (Math.abs(newY - g.position) < SNAP) newY = g.position;
          }
        }
      }

      this.state.updateLayer(layerId, { x: newX, y: newY }, false);
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

  private startResize(
    e: PointerEvent,
    layerId: string,
    handle: string,
    origX: number, origY: number, origW: number, origH: number,
  ): void {
    const layer = this.state.getCurrentLayers().find(l => l.id === layerId);
    if (!layer || layer.locked) return;
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const zoom = this.state.get().zoom;
    const aspectRatio = origW / (origH || 1);
    const isGroup = layer.type === 'group';
    // Snapshot group children positions for proportional scaling
    type GroupLayer = Layer & { layers?: Layer[] };
    const groupChildren: Layer[] = isGroup
      ? [...((layer as GroupLayer).layers ?? [])]
      : [];
    const childSnapshots = groupChildren.map(c => ({
      id: c.id,
      x: c.x ?? 0,
      y: c.y ?? 0,
      w: typeof c.width  === 'number' ? c.width  : 0,
      h: typeof c.height === 'number' ? c.height : 0,
    }));
    let interactionStarted = false;

    const onMove = (me: PointerEvent) => {
      if (!interactionStarted) {
        interactionStarted = true;
        this.state.beginInteraction();
      }
      let dx = (me.clientX - startX) / zoom;
      let dy = (me.clientY - startY) / zoom;

      let nx = origX, ny = origY, nw = origW, nh = origH;

      // West edge: move x, shrink width
      if (handle.includes('w')) { nx = origX + dx; nw = origW - dx; }
      // East edge: grow width
      if (handle.includes('e')) { nw = origW + dx; }
      // North edge: move y, shrink height
      if (handle.includes('n')) { ny = origY + dy; nh = origH - dy; }
      // South edge: grow height
      if (handle.includes('s')) { nh = origH + dy; }

      // Shift = lock aspect ratio
      if (me.shiftKey) {
        const dominant = Math.abs(dx) > Math.abs(dy) ? 'w' : 'h';
        if (dominant === 'w') {
          nh = nw / aspectRatio;
          if (handle.includes('n')) ny = origY + origH - nh;
        } else {
          nw = nh * aspectRatio;
          if (handle.includes('w')) nx = origX + origW - nw;
        }
      }

      // Minimum 4px
      if (nw < 4) { if (handle.includes('w')) nx = origX + origW - 4; nw = 4; }
      if (nh < 4) { if (handle.includes('n')) ny = origY + origH - 4; nh = 4; }

      const rnx = Math.round(nx), rny = Math.round(ny);
      const rnw = Math.round(nw), rnh = Math.round(nh);

      this.state.updateLayer(layerId, {
        x: rnx, y: rny, width: rnw, height: rnh,
      } as Parameters<typeof this.state.updateLayer>[1], false);

      // Scale group children proportionally
      if (isGroup && origW > 0 && origH > 0) {
        const sx = rnw / origW;
        const sy = rnh / origH;
        for (const snap of childSnapshots) {
          this.state.updateLayer(snap.id, {
            x: Math.round(rnx + (snap.x - origX) * sx),
            y: Math.round(rny + (snap.y - origY) * sy),
            width: Math.max(4, Math.round(snap.w * sx)),
            height: Math.max(4, Math.round(snap.h * sy)),
          } as Parameters<typeof this.state.updateLayer>[1], false);
        }
      }
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
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

  // ── Inline text editor ───────────────────────────────────────

  private onDblClick(e: MouseEvent): void {
    const target = e.target as SVGElement;
    const layerEl = target.closest<SVGElement>('[data-layer-id]');
    if (!layerEl) return;
    const layerId = layerEl.getAttribute('data-layer-id');
    if (!layerId) return;
    const layer = this.state.getCurrentLayers().find(l => l.id === layerId);
    if (!layer || layer.type !== 'text') return;
    this.openInlineTextEditor(layer as TextLayer, layerEl);
  }

  private openInlineTextEditor(layer: TextLayer, svgEl: SVGElement): void {
    const existing = this.container.querySelector('.inline-text-editor');
    if (existing) (existing as HTMLElement).blur();

    const { zoom = 1, panX = 0, panY = 0 } = this.state.get();
    const bbox = (svgEl as SVGGraphicsElement).getBBox?.() ?? { x: layer.x ?? 0, y: layer.y ?? 0, width: layer.width ?? 100, height: 24 };

    const left = bbox.x * zoom + panX + RULER_SIZE;
    const top  = bbox.y * zoom + panY + RULER_SIZE;
    const w    = Math.max(bbox.width * zoom, 80);
    const h    = Math.max(bbox.height * zoom, 24);

    const rawText = layer.content.type === 'rich'
      ? layer.content.spans.map(s => s.text).join('')
      : (layer.content as { value: string }).value;

    const ta = document.createElement('textarea');
    ta.className = 'inline-text-editor';
    ta.value = rawText;
    ta.style.cssText = [
      `position:absolute`,
      `left:${left}px`, `top:${top}px`,
      `width:${w}px`, `min-height:${h}px`,
      `font-family:${layer.style?.font_family ?? 'Inter'},sans-serif`,
      `font-size:${(layer.style?.font_size ?? 24) * zoom}px`,
      `font-weight:${layer.style?.font_weight ?? 400}`,
      `color:${layer.style?.color ?? '#ffffff'}`,
      `background:rgba(0,0,0,0.6)`,
      `border:2px solid var(--color-accent,#6c5ce7)`,
      `outline:none`, `resize:none`,
      `padding:2px 4px`, `z-index:200`,
      `overflow:hidden`, `white-space:pre-wrap`,
      `border-radius:2px`,
    ].join(';');

    this.container.appendChild(ta);
    ta.focus();
    ta.select();

    const commit = () => {
      const newText = ta.value;
      ta.remove();
      if (newText !== rawText) {
        const content = layer.content.type === 'rich'
          ? { type: 'plain' as const, value: newText }
          : { ...layer.content, value: newText };
        this.state.updateLayer(layer.id, { content });
      }
    };

    ta.addEventListener('blur', commit, { once: true });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ta.removeEventListener('blur', commit);
        ta.remove();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ta.removeEventListener('blur', commit);
        commit();
      }
    });
  }

  // ── Ruler guide lines ────────────────────────────────────────

  private startGuide(e: PointerEvent, axis: 'h' | 'v'): void {
    e.preventDefault();
    const { zoom = 1, panX = 0, panY = 0 } = this.state.get();
    const vpRect = this.viewport.getBoundingClientRect();

    // Preview line element
    const preview = document.createElement('div');
    preview.className = 'guide-preview';
    preview.style.cssText = axis === 'h'
      ? `position:absolute;left:${RULER_SIZE}px;right:0;height:1px;background:#6c5ce7;pointer-events:none;z-index:150;top:${e.clientY - vpRect.top + RULER_SIZE}px`
      : `position:absolute;top:${RULER_SIZE}px;bottom:0;width:1px;background:#6c5ce7;pointer-events:none;z-index:150;left:${e.clientX - vpRect.left + RULER_SIZE}px`;
    this.container.appendChild(preview);

    const onMove = (me: PointerEvent) => {
      if (axis === 'h') {
        preview.style.top = `${me.clientY - vpRect.top + RULER_SIZE}px`;
      } else {
        preview.style.left = `${me.clientX - vpRect.left + RULER_SIZE}px`;
      }
    };

    const onUp = (me: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      preview.remove();

      // Only add if released inside canvas area
      const vp = this.viewport.getBoundingClientRect();
      if (me.clientX < vp.left || me.clientX > vp.right || me.clientY < vp.top || me.clientY > vp.bottom) return;

      const position = axis === 'h'
        ? Math.round((me.clientY - vp.top - panY) / zoom)
        : Math.round((me.clientX - vp.left - panX) / zoom);

      const guide: Guide = { id: `guide-${++guideCounter}`, axis, position };
      this.state.set('guides', [...this.state.get().guides, guide], false);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  private renderGuideLines(): void {
    this.selectionOverlay.querySelectorAll('.ruler-guide').forEach(el => el.remove());

    const { guides, zoom = 1, panX = 0, panY = 0 } = this.state.get();
    if (!guides.length) return;

    const doc = this.state.get().design?.document;
    const cw = doc?.width ?? 1080;
    const ch = doc?.height ?? 1080;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ruler-guide');
    svg.setAttribute('width', String(cw));
    svg.setAttribute('height', String(ch));
    svg.style.cssText = 'position:absolute;inset:0;pointer-events:auto;z-index:89;overflow:visible';

    for (const guide of guides) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      if (guide.axis === 'h') {
        line.setAttribute('x1', '0'); line.setAttribute('x2', String(cw));
        line.setAttribute('y1', String(guide.position)); line.setAttribute('y2', String(guide.position));
      } else {
        line.setAttribute('y1', '0'); line.setAttribute('y2', String(ch));
        line.setAttribute('x1', String(guide.position)); line.setAttribute('x2', String(guide.position));
      }
      line.setAttribute('stroke', '#6c5ce7');
      line.setAttribute('stroke-width', String(1 / zoom));
      line.setAttribute('opacity', '0.7');
      line.style.cursor = 'pointer';
      line.setAttribute('data-guide-id', guide.id);

      // Double-click to delete guide
      line.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.state.set('guides', this.state.get().guides.filter(g => g.id !== guide.id), false);
      });

      svg.appendChild(line);
    }

    this.selectionOverlay.appendChild(svg);

    // Apply the same transform as the main SVG
    svg.style.transform = `scale(${zoom}) translate(${panX / zoom}px, ${panY / zoom}px)`;
    svg.style.transformOrigin = '0 0';
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

// ── Canvas paper-color heuristic ─────────────────────────────
// Returns a CSS color from the first full-cover rect at (0,0) — used to
// keep the viewport background matching the design so render swaps don't
// flash a different color through transparent regions.
function inferCanvasPaper(
  design: { layers?: Layer[]; pages?: { layers?: Layer[] }[] } | null,
): string | null {
  if (!design) return null;
  const layers = (design.pages?.[0]?.layers ?? design.layers ?? []) as Layer[];
  for (const l of layers) {
    const fill = (l as {
      fill?: {
        type?: string;
        color?: string;
        stops?: { color?: string }[];
      };
    }).fill;
    if (l.type !== 'rect' || !fill) continue;
    if (fill.type === 'solid' && fill.color && !fill.color.startsWith('$')) {
      return fill.color;
    }
    // Gradient: use first stop as best-effort match — avoids viewport flash
    // when the SVG is swapped between renders.
    if ((fill.type === 'linear' || fill.type === 'radial') && fill.stops?.length) {
      const first = fill.stops[0]?.color;
      if (first && !first.startsWith('$')) return first;
    }
  }
  return null;
}
