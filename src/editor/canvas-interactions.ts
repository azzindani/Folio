// Folio editor canvas — interactions: pointer drag/resize/rotate/marquee/flow drag-loops.
// Split out of canvas.ts to stay within the line budget; verbatim bodies.
import { type ToolId } from './state';
import { widthToSpan, computeInsertIndex, insertIndicatorRect } from './flow-edit';
import type { Layer } from '../schema/types';
import { RULER_SIZE } from './canvas-draw';
import { CanvasBase } from './canvas-base';

let layerCounter = 0;

export abstract class CanvasInteractions extends CanvasBase {
  protected startGroupDrag(e: PointerEvent, ids: string[]): void {
    const startX = e.clientX, startY = e.clientY;
    const zoom = this.state.get().zoom;
    const layers = this.collectLayersDeep(ids);
    const origs = new Map(layers.map(l => [l.id, { x: l.x ?? 0, y: l.y ?? 0 }]));
    let started = false;
    const onMove = (me: PointerEvent) => {
      const dx = (me.clientX - startX) / zoom;
      const dy = (me.clientY - startY) / zoom;
      if (!started && Math.abs(dx) < 3 / zoom && Math.abs(dy) < 3 / zoom) return;
      if (!started) { started = true; this.state.beginInteraction(); }
      for (const [id, o] of origs) {
        this.state.updateLayer(id, { x: Math.round(o.x + dx), y: Math.round(o.y + dy) }, false);
      }
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  protected startGroupResize(
    e: PointerEvent,
    ids: string[],
    handle: string,
    bx: number, by: number, bw: number, bh: number,
  ): void {
    const startX = e.clientX, startY = e.clientY;
    const zoom = this.state.get().zoom;
    const layers = this.collectLayersDeep(ids);
    // Snapshot each layer's bounds relative to the union bbox
    const origs = layers.map(l => ({
      id: l.id,
      rx: ((l.x ?? 0) - bx) / bw,            // relative x in [0..1]
      ry: ((l.y ?? 0) - by) / bh,
      rw: (typeof l.width  === 'number' ? l.width  : 0) / bw,
      rh: (typeof l.height === 'number' ? l.height : 0) / bh,
    }));
    let started = false;
    const onMove = (me: PointerEvent) => {
      const dx = (me.clientX - startX) / zoom;
      const dy = (me.clientY - startY) / zoom;
      let nx = bx, ny = by, nw = bw, nh = bh;
      if (handle.includes('w')) { nx = bx + dx; nw = bw - dx; }
      if (handle.includes('e')) { nw = bw + dx; }
      if (handle.includes('n')) { ny = by + dy; nh = bh - dy; }
      if (handle.includes('s')) { nh = bh + dy; }
      // Shift = aspect lock; Alt = from center
      if (me.altKey) {
        if (handle.includes('e')) { nx = bx - dx; nw = bw + 2 * dx; }
        if (handle.includes('w')) { nx = bx + dx; nw = bw - 2 * dx; }
        if (handle.includes('s')) { ny = by - dy; nh = bh + 2 * dy; }
        if (handle.includes('n')) { ny = by + dy; nh = bh - 2 * dy; }
      }
      if (me.shiftKey) {
        const ar = bw / (bh || 1);
        const dom = Math.abs(dx) > Math.abs(dy) ? 'w' : 'h';
        if (dom === 'w') nh = nw / ar; else nw = nh * ar;
      }
      nw = Math.max(4, nw); nh = Math.max(4, nh);
      if (!started) { started = true; this.state.beginInteraction(); }
      // Apply scaling to every layer relative to its position in the union
      for (const o of origs) {
        this.state.updateLayer(o.id, {
          x: Math.round(nx + o.rx * nw),
          y: Math.round(ny + o.ry * nh),
          width:  Math.max(4, Math.round(o.rw * nw)),
          height: Math.max(4, Math.round(o.rh * nh)),
        } as Parameters<typeof this.state.updateLayer>[1], false);
      }
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  protected startRotate(
    e: PointerEvent,
    layerId: string,
    bbox: DOMRect | SVGRect,
  ): void {
    const layer = this.findLayerDeep(layerId);
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

  protected startMarquee(e: PointerEvent): void {
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

  protected createLayerAt(e: PointerEvent, tool: Exclude<ToolId, 'select'>): void {
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

  // Resolve a layer by id ANYWHERE in the tree (group / auto_layout children),
  // not just the top level. A flat lookup left every nested preset child
  // un-draggable: the drag/resize/rotate handlers resolved `undefined` and
  // silently bailed, so clicking a card/title inside a feature_grid/event group
  // selected it but it would not move — the "can't move components" report.
  protected startDrag(e: PointerEvent, layerId: string): void {
    const layer = this.findLayerDeep(layerId);
    if (!layer || layer.locked) return;

    // Flow reports position by document order + span, not x/y — translating a
    // layer just snaps back on the next layout. Drag means "reorder" instead.
    if (this.flowActive && this.flowMetrics) {
      this.startFlowReorder(e, layerId);
      return;
    }

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

      // Snap to ruler guides, then anchor to other layers' edges/centres.
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
        const anchored = this.snapToLayers(layerId, newX, newY, layer);
        newX = anchored.x;
        newY = anchored.y;
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

  protected startResize(
    e: PointerEvent,
    layerId: string,
    handle: string,
    origX: number, origY: number, origW: number, origH: number,
  ): void {
    const layer = this.findLayerDeep(layerId);
    if (!layer || layer.locked) return;
    e.stopPropagation();

    // Flow reports: resize maps to grid span (E/W) + explicit row height (N/S),
    // not free width/height which the layout would overwrite.
    if (this.flowActive && this.flowMetrics) {
      this.startFlowResize(e, layerId, handle, origW, origH);
      return;
    }

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

      // Alt = resize from center: every edge change mirrored on the opposite side
      if (me.altKey) {
        if (handle.includes('e')) { nx = origX - dx; nw = origW + 2 * dx; }
        if (handle.includes('w')) { nx = origX + dx; nw = origW - 2 * dx; }
        if (handle.includes('s')) { ny = origY - dy; nh = origH + 2 * dy; }
        if (handle.includes('n')) { ny = origY + dy; nh = origH - 2 * dy; }
      }

      // Shift = lock aspect ratio
      if (me.shiftKey) {
        const dominant = Math.abs(dx) > Math.abs(dy) ? 'w' : 'h';
        if (dominant === 'w') {
          nh = nw / aspectRatio;
          if (handle.includes('n')) ny = origY + origH - nh;
          if (me.altKey) ny = origY + origH / 2 - nh / 2;
        } else {
          nw = nh * aspectRatio;
          if (handle.includes('w')) nx = origX + origW - nw;
          if (me.altKey) nx = origX + origW / 2 - nw / 2;
        }
      }

      // Minimum 4px
      if (nw < 4) { if (handle.includes('w')) nx = origX + origW - 4; nw = 4; }
      if (nh < 4) { if (handle.includes('n')) ny = origY + origH - 4; nh = 4; }

      const rnx = Math.round(nx), rny = Math.round(ny);
      const rnw = Math.round(nw), rnh = Math.round(nh);

      const updates: Record<string, unknown> = {
        x: rnx, y: rny, width: rnw, height: rnh,
      };

      // Text layers: scale font_size with the bounding box. Geometric mean
      // of x/y scale factors keeps non-uniform drags feeling natural — a
      // pure-width drag barely touches the font, a pure-height drag scales
      // it directly. Original (not previous-frame) dimensions are the basis
      // so a continuous drag yields a stable absolute scale.
      if (layer.type === 'text' && origW > 0 && origH > 0) {
        const sx = rnw / origW;
        const sy = rnh / origH;
        const scale = Math.sqrt(sx * sy);
        const style = (layer as { style?: { font_size?: number } }).style;
        const baseFs = style?.font_size ?? 16;
        const nextFs = Math.max(6, Math.round(baseFs * scale * 100) / 100);
        if (nextFs !== baseFs) {
          updates['style'] = { ...style, font_size: nextFs };
        }
      }

      this.state.updateLayer(layerId, updates as Parameters<typeof this.state.updateLayer>[1], false);

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

  // ── Flow-report direct manipulation ─────────────────────────
  protected startFlowReorder(e: PointerEvent, layerId: string): void {
    const layer = this.findLayerDeep(layerId);
    const r = layer as unknown as Record<string, unknown> | undefined;
    const lw = typeof r?.['width'] === 'number' ? (r['width'] as number) : 200;
    const lh = typeof r?.['height'] === 'number' ? (r['height'] as number) : 80;
    const draggedEl = this.svgContainer.querySelector<HTMLElement & SVGElement>(`[data-layer-id="${layerId}"]`);
    const accent = this.flowAccent();
    const startX = e.clientX, startY = e.clientY;
    let moved = false, targetIndex = -1;
    let ghost: HTMLDivElement | null = null, indicator: HTMLDivElement | null = null;

    const onMove = (me: PointerEvent): void => {
      const dx = me.clientX - startX, dy = me.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) {
        moved = true;
        if (draggedEl) draggedEl.style.opacity = '0.35';
        ghost = document.createElement('div');
        ghost.style.cssText = `position:absolute;width:${lw}px;height:${Math.min(lh, 160)}px;border:2px dashed ${accent};background:${accent}1f;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#e8e8f4;font:600 12px Inter,sans-serif;text-transform:uppercase;letter-spacing:.06em;pointer-events:none;`;
        ghost.textContent = String(layer?.type ?? 'layer').replace(/_/g, ' ');
        indicator = document.createElement('div');
        indicator.style.cssText = `position:absolute;width:4px;border-radius:2px;background:${accent};box-shadow:0 0 10px ${accent};pointer-events:none;display:none;`;
        this.flowOverlay.appendChild(ghost);
        this.flowOverlay.appendChild(indicator);
      }
      const c = this.clientToCanvas(me.clientX, me.clientY);
      if (ghost) { ghost.style.left = `${c.x - lw / 2}px`; ghost.style.top = `${c.y - Math.min(lh, 160) / 2}px`; }
      const rects = this.flowTopLevelRects(layerId);
      targetIndex = computeInsertIndex(rects, c);
      const ind = insertIndicatorRect(rects, targetIndex);
      if (indicator && ind) {
        indicator.style.display = 'block';
        indicator.style.left = `${ind.x - 2}px`;
        indicator.style.top = `${ind.y}px`;
        indicator.style.height = `${ind.height}px`;
      } else if (indicator) {
        indicator.style.display = 'none';
      }
    };
    const onUp = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (draggedEl) draggedEl.style.opacity = '';
      this.clearFlowOverlay();
      if (moved && targetIndex >= 0) this.state.reorderLayer(layerId, targetIndex);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // Resize a flow component: E/W handles snap width to grid span (1–12),
  // N/S handles set an explicit row height (flow_h). Corners do both.
  protected startFlowResize(e: PointerEvent, layerId: string, handle: string, origW: number, origH: number): void {
    const m = this.flowMetrics;
    if (!m) return;
    const startX = e.clientX, startY = e.clientY;
    const zoom = this.state.get().zoom || 1;
    const horiz = handle.includes('e') || handle.includes('w');
    const vert = handle.includes('n') || handle.includes('s');
    let started = false;

    const onMove = (me: PointerEvent): void => {
      const dx = (me.clientX - startX) / zoom;
      const dy = (me.clientY - startY) / zoom;
      if (!started) {
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        started = true;
        this.state.beginInteraction();
        this.showFlowGrid();
      }
      const updates: Record<string, unknown> = {};
      if (horiz) {
        const newW = handle.includes('w') ? origW - dx : origW + dx;
        updates['span'] = widthToSpan(newW, m);
      }
      if (vert) {
        const newH = handle.includes('n') ? origH - dy : origH + dy;
        updates['flow_h'] = Math.max(40, Math.round(newH));
      }
      if (Object.keys(updates).length > 0) {
        this.state.updateLayer(layerId, updates as Parameters<typeof this.state.updateLayer>[1], false);
      }
    };
    const onUp = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      this.hideFlowGrid();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  protected onWheel(e: WheelEvent): void {
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

}
