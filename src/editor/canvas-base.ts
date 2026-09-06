// Folio editor canvas — base: state fields + setup, transform, draw & leaf utilities.
// Split out of canvas.ts to stay within the line budget; verbatim bodies.
import { StateManager, type Guide } from './state';
import { flowColumnX, type FlowGridMetrics } from '../renderer/flow-layout';
import { type FlowRect } from './flow-edit';
import type { Layer, TextLayer } from '../schema/types';
import { generateDesignAnimationCSS } from '../animation/css-generator';
import { RULER_SIZE, drawRuler } from './canvas-draw';

let guideCounter = 0;

export abstract class CanvasBase {
  protected container!: HTMLElement;
  protected state!: StateManager;
  protected viewport!: HTMLDivElement;
  protected svgContainer!: HTMLDivElement;
  protected selectionOverlay!: HTMLDivElement;
  protected currentSVG: SVGSVGElement | null = null;
  protected rulerH!: HTMLCanvasElement;
  protected rulerV!: HTMLCanvasElement;
  protected marqueeEl: HTMLDivElement | null = null;
  // Flow-report direct-manipulation state (drag-to-reorder + span/height resize).
  protected flowOverlay!: HTMLDivElement;
  /** Motion trails / onion skin, drawn in design coordinates. */
  protected motionOverlay!: HTMLDivElement;
  protected flowActive = false;
  protected flowMetrics: FlowGridMetrics | null = null;
  protected flowContentHeight = 0;
  protected hoverBox: HTMLDivElement | null = null;
  // ── Distance annotation overlay ─────────────────────────────
  protected annotationOverlay: HTMLCanvasElement | null = null;

  protected buildCanvas(): void {
    this.viewport = document.createElement('div');
    this.viewport.className = 'canvas-viewport';

    this.svgContainer = document.createElement('div');
    this.svgContainer.className = 'canvas-svg-container';
    this.svgContainer.style.position = 'relative';

    // Flow-edit aids (12-col grid, drag ghost, insertion bar). Separate from
    // selectionOverlay because updateSelectionOverlay() clears that one on every
    // render — these need to persist across the live re-renders of a resize.
    this.flowOverlay = document.createElement('div');
    this.flowOverlay.className = 'canvas-flow-overlay';
    this.flowOverlay.style.position = 'absolute';
    this.flowOverlay.style.inset = '0';
    this.flowOverlay.style.pointerEvents = 'none';
    this.flowOverlay.style.zIndex = '88';

    // Motion trails sit BELOW the selection handles and above the artwork, and
    // are never cleared by updateSelectionOverlay() — a trail that vanished on
    // every re-render would flicker through a scrub.
    this.motionOverlay = document.createElement('div');
    this.motionOverlay.className = 'canvas-motion-overlay';
    this.motionOverlay.style.position = 'absolute';
    this.motionOverlay.style.inset = '0';
    this.motionOverlay.style.pointerEvents = 'none';
    this.motionOverlay.style.zIndex = '89';

    this.selectionOverlay = document.createElement('div');
    this.selectionOverlay.className = 'canvas-selection-overlay';
    this.selectionOverlay.style.position = 'absolute';
    this.selectionOverlay.style.inset = '0';
    this.selectionOverlay.style.pointerEvents = 'none';
    this.selectionOverlay.style.zIndex = '90';

    this.viewport.appendChild(this.svgContainer);
    this.viewport.appendChild(this.flowOverlay);
    this.viewport.appendChild(this.motionOverlay);
    this.viewport.appendChild(this.selectionOverlay);
    this.container.appendChild(this.viewport);
    this.buildRulers();
  }

  protected buildRulers(): void {
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

  protected updateRulers(): void {
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

  protected clearHoverBox(): void {
    if (this.hoverBox) {
      this.hoverBox.remove();
      this.hoverBox = null;
    }
  }

  protected getOrCreateAnnotationOverlay(): HTMLCanvasElement {
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

  protected clearAnnotations(): void {
    if (!this.annotationOverlay) return;
    const ctx = this.annotationOverlay.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, this.annotationOverlay.width, this.annotationOverlay.height);
  }

  getCanvasExportNode(): HTMLElement | null {
    return this.currentSVG ? this.svgContainer : null;
  }

  protected injectAnimationCSS(svg: SVGSVGElement): void {
    const { animations } = this.state.get();
    const entries = Object.entries(animations);
    if (entries.length === 0) return;
    // Build a Map so the generator's signature matches; keep insertion
    // order so stagger sequences fire in the order the YAML declared.
    const map = new Map<string, import('../animation/types').AnimationSpec>(entries);
    const css = generateDesignAnimationCSS(map);
    if (!css) return;
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.setAttribute('data-folio-animations', '');
    style.textContent = css;
    svg.insertBefore(style, svg.firstChild);
  }

  protected updateTransform(): void {
    const { zoom, panX, panY } = this.state.get();
    this.viewport.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    this.viewport.style.transformOrigin = 'center center';
  }

  protected findLayerDeep(id: string): Layer | undefined {
    const walk = (layers: Layer[]): Layer | undefined => {
      for (const l of layers) {
        if (l.id === id) return l;
        const kids = (l as Layer & { layers?: Layer[] }).layers;
        if (Array.isArray(kids)) { const hit = walk(kids); if (hit) return hit; }
      }
      return undefined;
    };
    return walk(this.state.getCurrentLayers());
  }

  // Collect selected layers by id from anywhere in the tree (group-aware
  // multi-select drag/resize). Returns them in tree order.
  protected collectLayersDeep(ids: string[]): Layer[] {
    const want = new Set(ids);
    const out: Layer[] = [];
    const walk = (layers: Layer[]): void => {
      for (const l of layers) {
        if (want.has(l.id)) out.push(l);
        const kids = (l as Layer & { layers?: Layer[] }).layers;
        if (Array.isArray(kids)) walk(kids);
      }
    };
    walk(this.state.getCurrentLayers());
    return out;
  }

  protected flowAccent(): string {
    const a = this.state.get().design?.report?.accent;
    return typeof a === 'string' && a.trim() && !a.startsWith('$') ? a : '#6c5ce7';
  }

  protected clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.viewport.getBoundingClientRect();
    const zoom = this.state.get().zoom || 1;
    return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
  }

  // Computed geometry of each top-level layer, in document (reading) order.
  protected flowTopLevelRects(excludeId?: string): FlowRect[] {
    const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
    const out: FlowRect[] = [];
    for (const l of this.state.getCurrentLayers()) {
      if (l.id === excludeId) continue;
      const r = l as unknown as Record<string, unknown>;
      out.push({ id: l.id, x: num(r['x']), y: num(r['y']), width: num(r['width']), height: num(r['height']) });
    }
    return out;
  }

  protected clearFlowOverlay(): void { this.flowOverlay.innerHTML = ''; }

  // Drag a flow component to reorder it (ghost follows cursor, insertion bar
  // marks the drop slot, commit on release).
  protected showFlowGrid(): void {
    if (!this.flowMetrics) return;
    this.clearFlowOverlay();
    const m = this.flowMetrics;
    const h = this.flowContentHeight || 1000;
    const accent = this.flowAccent();
    for (let i = 0; i < 12; i++) {
      const col = document.createElement('div');
      col.style.cssText = `position:absolute;left:${flowColumnX(i, m)}px;top:0;width:${m.colW}px;height:${h}px;background:${accent}14;border-left:1px solid ${accent}3a;border-right:1px solid ${accent}3a;pointer-events:none;`;
      this.flowOverlay.appendChild(col);
    }
  }

  protected hideFlowGrid(): void { this.clearFlowOverlay(); }

  protected drawSmartGuides(
    draggedId: string,
    x: number,
    y: number,
    layer: Layer,
  ): void {
    this.clearSmartGuides();
    const w = typeof layer.width === 'number' ? layer.width : 0;
    const h = typeof layer.height === 'number' ? layer.height : 0;
    const others = this.guideTargets(draggedId);
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

  /** Every layer that can serve as an alignment target for `draggedId`: the
   *  whole page tree flattened, MINUS the dragged layer and its own descendants.
   *  Presets ship a poster as ONE group, so the dragged layer's siblings/cousins
   *  live nested inside it — a top-level `getCurrentLayers()` scan misses them and
   *  no guides ever appear. Ancestor groups stay in (snap to a container/canvas
   *  edge is useful), only the dragged subtree is excluded. */
  protected guideTargets(draggedId: string): Layer[] {
    const out: Layer[] = [];
    const walk = (layers: Layer[], inDragged: boolean): void => {
      for (const l of layers) {
        const isDragged = l.id === draggedId;
        if (!isDragged && !inDragged) out.push(l);
        const kids = (l as Layer & { layers?: Layer[] }).layers;
        if (Array.isArray(kids)) walk(kids, inDragged || isDragged);
      }
    };
    walk(this.state.getCurrentLayers(), false);
    return out;
  }

  /** Anchoring: snap the dragged layer's box to a nearby target layer's edge or
   *  centre (left/centre/right · top/middle/bottom) within SNAP px, so components
   *  line up to EACH OTHER, not just to ruler guides. Returns adjusted {x,y}. */
  protected snapToLayers(draggedId: string, x: number, y: number, layer: Layer): { x: number; y: number } {
    const w = typeof layer.width === 'number' ? layer.width : 0;
    const h = typeof layer.height === 'number' ? layer.height : 0;
    const SNAP = 6;
    let outX = x, outY = y, bestDx = SNAP, bestDy = SNAP;
    for (const o of this.guideTargets(draggedId)) {
      const ox = o.x ?? 0;
      const oy = o.y ?? 0;
      const ow = typeof o.width === 'number' ? o.width : 0;
      const oh = typeof o.height === 'number' ? o.height : 0;
      // X: our {left, centre, right} → their {left, centre, right}
      for (const [a, b] of [[x, ox], [x + w / 2, ox + ow / 2], [x + w, ox + ow]] as const) {
        const d = Math.abs(a - b);
        if (d < bestDx) { bestDx = d; outX = Math.round(x + (b - a)); }
      }
      // Y: our {top, middle, bottom} → their {top, middle, bottom}
      for (const [a, b] of [[y, oy], [y + h / 2, oy + oh / 2], [y + h, oy + oh]] as const) {
        const d = Math.abs(a - b);
        if (d < bestDy) { bestDy = d; outY = Math.round(y + (b - a)); }
      }
    }
    return { x: outX, y: outY };
  }

  protected clearSmartGuides(): void {
    const el = this.selectionOverlay.querySelector('.smart-guides');
    if (el) el.remove();
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

  protected openInlineTextEditor(layer: TextLayer, svgEl: SVGElement): void {
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

  protected startGuide(e: PointerEvent, axis: 'h' | 'v'): void {
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

  protected renderGuideLines(): void {
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
