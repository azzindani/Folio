// Folio editor canvas — controller: constructor, render, state sync, selection overlay, event entry.
// Split out of canvas.ts to stay within the line budget; verbatim bodies.
import { StateManager, type EditorState } from './state';
import { renderDesign, renderPage } from '../renderer/renderer';
import { computeFlowLayout, flowGridMetrics } from '../renderer/flow-layout';
import { setPreviewContext } from '../renderer/render-context';
import type { TextLayer } from '../schema/types';
import { composeTheme } from '../styles/compose';
import { RULER_SIZE, measureGaps, drawArrowLine, drawLabel } from './canvas-draw';
import { CanvasInteractions } from './canvas-interactions';

export class CanvasManager extends CanvasInteractions {
  constructor(container: HTMLElement, state: StateManager) {
    super();
    this.container = container;
    this.state = state;
    this.buildCanvas();
    this.bindEvents();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  protected bindEvents(): void {
    this.svgContainer.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.svgContainer.addEventListener('dblclick', this.onDblClick.bind(this));
    this.svgContainer.addEventListener('pointermove', this.onCanvasHover.bind(this));
    this.svgContainer.addEventListener('pointerleave', () => this.clearHoverBox());
    this.container.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    this.container.addEventListener('mousemove', this.onMouseMoveForAnnotations.bind(this));
    this.container.addEventListener('mouseleave', () => this.clearAnnotations());
    this.rulerH.addEventListener('pointerdown', (e) => this.startGuide(e, 'h'));
    this.rulerV.addEventListener('pointerdown', (e) => this.startGuide(e, 'v'));
  }

  protected onCanvasHover(e: PointerEvent): void {
    // Suppress while a drag is in progress
    if (e.buttons !== 0) return this.clearHoverBox();
    const target = e.target as SVGElement | null;
    if (!target?.closest) return;
    const layerEl = target.closest('[data-layer-id]') as SVGGraphicsElement | null;
    if (!layerEl) return this.clearHoverBox();
    const layerId = layerEl.getAttribute('data-layer-id');
    // Don't outline the already-selected layer (selection box already shown)
    if (layerId && this.state.get().selectedLayerIds.includes(layerId)) {
      return this.clearHoverBox();
    }
    const bbox = layerEl.getBBox?.();
    if (!bbox) return this.clearHoverBox();
    if (!this.hoverBox) {
      this.hoverBox = document.createElement('div');
      this.hoverBox.className = 'canvas-hover-box';
      this.selectionOverlay.appendChild(this.hoverBox);
    }
    this.hoverBox.style.left = `${bbox.x}px`;
    this.hoverBox.style.top = `${bbox.y}px`;
    this.hoverBox.style.width = `${bbox.width}px`;
    this.hoverBox.style.height = `${bbox.height}px`;
    this.hoverBox.style.opacity = '1';
  }

  protected onMouseMoveForAnnotations(e: MouseEvent): void {
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

  protected onStateChange(state: EditorState, changedKeys: (keyof EditorState)[]): void {
    const needsRender = changedKeys.some(k =>
      ['design', 'theme', 'palette', 'typePack', 'effectsPack', 'currentPageIndex', 'gridVisible', 'animations'].includes(k),
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
    const { design, theme, palette, typePack, effectsPack } = this.state.get();
    if (!design) return;

    const { width, height } = design.document;

    // Compose the active theme with any picked overlay primitives. When
    // nothing is picked, composeTheme returns the base theme by reference
    // — no allocation, no behavior change.
    const composed = theme
      ? composeTheme(theme, {
          palette: palette ?? undefined,
          typePack: typePack ?? undefined,
          effectsPack: effectsPack ?? undefined,
        })
      : undefined;

    const pages = design.pages;
    const currentPageIndex = this.state.get().currentPageIndex;
    const report = design.report;
    const isFlow = !!report && (report.layout === 'flow' || report.flow === true);

    // Expose the report's inline datasets + accent so interactive_chart /
    // interactive_table layers can draw a real data preview on the canvas
    // (the Chart.js/Tabulator runtime only exists in exported HTML).
    setPreviewContext({ sources: report?.data?.sources, accent: report?.accent });

    // Reset flow-edit geometry; the isFlow branch below re-enables it.
    this.flowActive = false;
    this.flowMetrics = null;

    let svg: SVGSVGElement;
    let renderW = width;
    let renderH = height;

    if (pages && pages.length > 0) {
      const pageIdx = Math.min(currentPageIndex, pages.length - 1);
      const page = pages[pageIdx];
      const layers = page?.layers ?? [];
      if (isFlow) {
        // Lay span-positioned layers out in the responsive grid so the canvas
        // matches the exported flow report (and selection handles line up).
        const cw = (typeof report?.max_width === 'number' ? report.max_width : 0) || width || 1200;
        const fl = computeFlowLayout(layers, { containerWidth: cw });
        renderW = fl.width;
        renderH = fl.height;
        // Cache geometry so drag-to-reorder + span/height resize map cursor
        // deltas to the same grid the layout used.
        this.flowActive = true;
        this.flowMetrics = flowGridMetrics({ containerWidth: cw });
        this.flowContentHeight = renderH;
        svg = renderPage(layers, renderW, renderH, { theme: composed, showGrid: false });
      } else {
        svg = renderPage(layers, width, height, { theme: composed, showGrid: this.state.get().gridVisible });
      }
    } else {
      svg = renderDesign(design, { theme: composed, showGrid: this.state.get().gridVisible });
    }

    // Inject animation CSS into the SVG so YAML-declared enter/loop/exit
    // animations actually play. Empty animations map = no-op (no style
    // node added). Re-runs on every render so live animation panel edits
    // also take effect.
    this.injectAnimationCSS(svg);

    // Atomic swap — no blank white frame between renders
    if (this.currentSVG && this.currentSVG.parentElement === this.svgContainer) {
      this.currentSVG.replaceWith(svg);
    } else {
      this.svgContainer.innerHTML = '';
      this.svgContainer.appendChild(svg);
    }
    this.currentSVG = svg;

    // Size viewport (flow reports grow the artboard to the computed grid height)
    this.viewport.style.width = `${renderW}px`;
    this.viewport.style.height = `${renderH}px`;
    this.updateTransform();
    this.updateRulers();
  }

  /**
   * The live canvas container DIV — wraps the rendered `<svg>` including the
   * charts/tables/KPIs that Chart.js/vega drew into their foreignObjects.
   * Export captures THIS node via dom-to-image (an HTML node, which it
   * rasterizes reliably — unlike a bare `<svg>`, which fails to load as an
   * `<img>` and taints the canvas). Re-rendering the spec statically would lose
   * all the JS-drawn content. The viewport zoom lives on an ancestor, so the
   * clone renders at design size.
   */
  protected updateSelectionOverlay(): void {
    this.selectionOverlay.innerHTML = '';
    const { selectedLayerIds, design } = this.state.get();
    if (!design || selectedLayerIds.length === 0) return;

    // Multi-select: single union bbox + group handles, plus thin per-layer
    // outline so the user still sees which layers are selected.
    if (selectedLayerIds.length > 1) {
      this.drawMultiSelectOverlay(selectedLayerIds);
      return;
    }

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

      const layerData = this.findLayerDeep(id) as unknown as Record<string, unknown> | undefined;
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
          const layer = this.findLayerDeep(id);
          if (layer?.type === 'text') {
            const svgEl = this.svgContainer.querySelector<SVGElement>(`[data-layer-id="${id}"]`);
            if (svgEl) this.openInlineTextEditor(layer as TextLayer, svgEl);
          }
        });
        frag.appendChild(handle);
      }

      // Selection box absorbs clicks for dblclick (text editing) — wire
      // pointerdown so it ALSO initiates drag on the layer underneath.
      // Without this, clicking on a selected layer's bbox does nothing
      // because the box covers the SVG and the SVG's pointerdown never fires.
      box.style.pointerEvents = 'auto';
      box.style.cursor = 'move';
      box.style.touchAction = 'none';
      box.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        this.startDrag(ev, id);
      });
      box.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        const layer = this.findLayerDeep(id);
        if (layer?.type === 'text') {
          const svgEl = this.svgContainer.querySelector<SVGElement>(`[data-layer-id="${id}"]`);
          if (svgEl) this.openInlineTextEditor(layer as TextLayer, svgEl);
        }
      });

      // Flow components reflow by span + order — rotation is meaningless, so
      // omit the rotate handle there.
      if (!this.flowActive) {
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
    }

    this.selectionOverlay.appendChild(frag);
  }

  protected drawMultiSelectOverlay(selectedIds: string[]): void {
    const frag = document.createDocumentFragment();
    const bboxes: { id: string; bb: DOMRect | SVGRect }[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const id of selectedIds) {
      const el = this.svgContainer.querySelector(`[data-layer-id="${id}"]`);
      if (!el) continue;
      const bb = (el as SVGGraphicsElement).getBBox?.();
      if (!bb) continue;
      bboxes.push({ id, bb });
      if (bb.x < minX) minX = bb.x;
      if (bb.y < minY) minY = bb.y;
      if (bb.x + bb.width  > maxX) maxX = bb.x + bb.width;
      if (bb.y + bb.height > maxY) maxY = bb.y + bb.height;
    }
    if (bboxes.length === 0 || !isFinite(minX)) return;

    // Per-layer thin outlines so user knows which layers are in the group
    for (const { bb } of bboxes) {
      const o = document.createElement('div');
      o.className = 'selection-box';
      o.style.cssText =
        `left:${bb.x}px;top:${bb.y}px;width:${bb.width}px;height:${bb.height}px;` +
        `outline:1px dashed color-mix(in srgb, var(--color-primary) 60%, transparent);` +
        `outline-offset:0px;background:transparent;border:none;pointer-events:none;`;
      frag.appendChild(o);
    }

    // Union bbox box
    const W = maxX - minX, H = maxY - minY;
    const unionBox = document.createElement('div');
    unionBox.className = 'selection-box selection-box--multi';
    unionBox.style.cssText = `left:${minX}px;top:${minY}px;width:${W}px;height:${H}px;cursor:move;pointer-events:auto;`;
    unionBox.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      this.startGroupDrag(ev, selectedIds);
    });
    frag.appendChild(unionBox);

    // 8 handles around union bbox — scale all selected proportionally
    const cx = minX + W / 2;
    const cy = minY + H / 2;
    const handles: { cls: string; x: number; y: number; cur: string }[] = [
      { cls: 'nw', x: minX,         y: minY,         cur: 'nw-resize' },
      { cls: 'n',  x: cx,           y: minY,         cur: 'n-resize'  },
      { cls: 'ne', x: minX + W,     y: minY,         cur: 'ne-resize' },
      { cls: 'e',  x: minX + W,     y: cy,           cur: 'e-resize'  },
      { cls: 'se', x: minX + W,     y: minY + H,     cur: 'se-resize' },
      { cls: 's',  x: cx,           y: minY + H,     cur: 's-resize'  },
      { cls: 'sw', x: minX,         y: minY + H,     cur: 'sw-resize' },
      { cls: 'w',  x: minX,         y: cy,           cur: 'w-resize'  },
    ];
    for (const pos of handles) {
      const h = document.createElement('div');
      h.className = `selection-handle handle-${pos.cls}`;
      h.style.left = `${pos.x - 5}px`;
      h.style.top  = `${pos.y - 5}px`;
      h.style.cursor = pos.cur;
      h.style.pointerEvents = 'auto';
      h.dataset.handle = pos.cls;
      h.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        this.startGroupResize(ev, selectedIds, pos.cls, minX, minY, W, H);
      });
      frag.appendChild(h);
    }
    this.selectionOverlay.appendChild(frag);
  }

  protected onPointerDown(e: PointerEvent): void {
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

    let layerId = layerEl.getAttribute('data-layer-id')!;

    // Alt-click: cycle through stacked layers underneath the cursor.
    // Use elementsFromPoint to enumerate layers behind the topmost; pick
    // the next one after the currently-selected so repeated alt-clicks
    // walk the z-stack downward.
    if (e.altKey && !e.shiftKey) {
      const stack = (document.elementsFromPoint?.(e.clientX, e.clientY) ?? [])
        .map(el => (el as SVGElement | HTMLElement).closest?.('[data-layer-id]'))
        .filter((el): el is SVGElement => !!el && this.svgContainer.contains(el))
        .map(el => el.getAttribute('data-layer-id')!)
        .filter((v, i, a) => v && a.indexOf(v) === i);
      if (stack.length > 1) {
        const cur = this.state.get().selectedLayerIds[0];
        const idx = stack.indexOf(cur ?? '');
        layerId = stack[(idx + 1) % stack.length];
      }
    }

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

  protected onDblClick(e: MouseEvent): void {
    const target = e.target as SVGElement;
    const layerEl = target.closest<SVGElement>('[data-layer-id]');
    if (!layerEl) return;
    const layerId = layerEl.getAttribute('data-layer-id');
    if (!layerId) return;
    const layer = this.findLayerDeep(layerId);
    if (!layer || layer.type !== 'text') return;
    this.openInlineTextEditor(layer as TextLayer, layerEl);
  }

}
