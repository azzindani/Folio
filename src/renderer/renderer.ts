import type { Layer, DesignSpec, ThemeSpec, ComponentSpec, ComponentLayer, ComponentListLayer } from '../schema/types';
import { resolveLayerTokens, type TokenResolutionContext } from '../engine/token-resolver';
import { resolveComponent } from '../engine/component-resolver';
import { expandPositionShorthand } from '../schema/validator';
import { resolveAllFormulas, type FormulaContext } from '../scripting/formula';
import { createSVGRoot, createSVGElement, resetDefIdCounter } from './svg-utils';
import {
  renderRect, renderCircle, renderPath, renderPolygon,
  renderLine, renderText, renderImage, renderIcon,
  renderMermaid, renderChart, renderCode, renderMath, renderGroup,
  renderQRCode, renderAutoLayout,
  renderInteractiveChart, renderInteractiveTable, renderRichText,
  renderKpiCard, renderMap, renderEmbedCode, renderPopup, renderParticle,
} from './layer-renderers';

export interface RenderOptions {
  theme?: ThemeSpec;
  themeOverrides?: Record<string, string>;
  interactive?: boolean;
  componentRegistry?: Map<string, ComponentSpec>;
  showGrid?: boolean;
  gridConfig?: { columns: number; gutter: number; margin: number; baseline: number };
  formulaContext?: FormulaContext;
}

// ── Render Cache for Dirty Tracking ─────────────────────────
const renderCache = new Map<string, { hash: string; svg: SVGElement }>();

function hashLayer(layer: Layer): string {
  return JSON.stringify(layer);
}

export function invalidateCache(layerId?: string): void {
  if (layerId) {
    renderCache.delete(layerId);
  } else {
    renderCache.clear();
  }
}

// Active options for the current render pass (set by renderDesign/renderPage)
let activeOptions: RenderOptions = {};

export function renderLayer(layer: Layer, svg: SVGSVGElement): SVGElement {
  // Conditional visibility: evaluate show_if expression
  if (layer.show_if !== undefined) {
    const visible = evalShowIf(layer.show_if, layer);
    if (!visible) {
      const ns = 'http://www.w3.org/2000/svg';
      const placeholder = document.createElementNS(ns, 'g') as SVGElement;
      placeholder.setAttribute('data-layer-id', layer.id);
      placeholder.setAttribute('data-hidden', 'show_if');
      return placeholder;
    }
  }

  // Check render cache for dirty tracking
  const layerHash = hashLayer(layer);
  const cached = renderCache.get(layer.id);
  if (cached && cached.hash === layerHash) {
    return cached.svg.cloneNode(true) as SVGElement;
  }

  const el = renderLayerUncached(layer, svg);

  // Store in cache
  renderCache.set(layer.id, { hash: layerHash, svg: el.cloneNode(true) as SVGElement });

  return el;
}

function evalShowIf(expr: string, layer: Layer): boolean {
  try {
    // Provide layer fields as local variables for the expression
    // Uses Function constructor — safe for design-time evaluation (no user input sandbox needed)
    const fn = new Function('layer', `with(layer) { return !!(${expr}); }`);
    return fn(layer) as boolean;
  } catch {
    return true; // default to visible on error
  }
}

function renderLayerUncached(layer: Layer, svg: SVGSVGElement): SVGElement {
  let el: SVGElement;
  switch (layer.type) {
    case 'rect':          el = renderRect(layer, svg); break;
    case 'circle':        el = renderCircle(layer, svg); break;
    case 'path':          el = renderPath(layer, svg); break;
    case 'polygon':       el = renderPolygon(layer, svg); break;
    case 'line':          el = renderLine(layer, svg); break;
    case 'text':          el = renderText(layer, svg); break;
    case 'image':         el = renderImage(layer, svg); break;
    case 'icon':          el = renderIcon(layer, svg); break;
    case 'mermaid':       el = renderMermaid(layer, svg); break;
    case 'chart':         el = renderChart(layer, svg); break;
    case 'code':          el = renderCode(layer, svg); break;
    case 'math':          el = renderMath(layer, svg); break;
    case 'group':         el = renderGroup(layer, svg, renderLayer); break;
    case 'component':     el = renderComponentLayer(layer as ComponentLayer, svg); break;
    case 'component_list':el = renderComponentListLayer(layer as ComponentListLayer, svg); break;
    case 'qrcode':              el = renderQRCode(layer, svg); break;
    case 'auto_layout':         el = renderAutoLayout(layer, svg, renderLayer); break;
    case 'interactive_chart':   el = renderInteractiveChart(layer, svg); break;
    case 'interactive_table':   el = renderInteractiveTable(layer, svg); break;
    case 'rich_text':           el = renderRichText(layer, svg); break;
    case 'kpi_card':            el = renderKpiCard(layer, svg); break;
    case 'map':                 el = renderMap(layer, svg); break;
    case 'embed_code':          el = renderEmbedCode(layer, svg); break;
    case 'popup':               el = renderPopup(layer, svg, renderLayer); break;
    case 'particle':            el = renderParticle(layer, svg); break;
    default:                    el = renderPlaceholder(layer, svg); break;
  }

  if (layer.clip_path_ref) {
    el.setAttribute('clip-path', `url(#cp-${layer.clip_path_ref})`);
  }

  // ── Motion path animation ─────────────────────────────────
  if ('motion_path' in layer && layer.motion_path !== undefined) {
    const mp = layer.motion_path;
    const animMotion = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
    animMotion.setAttribute('dur', `${((mp.duration ?? 2000) / 1000).toFixed(3)}s`);
    animMotion.setAttribute('repeatCount', mp.loop === true ? 'indefinite' : '1');
    animMotion.setAttribute('calcMode', 'spline');
    animMotion.setAttribute('keyTimes', '0;1');
    animMotion.setAttribute('keySplines', '0.42 0 0.58 1');
    animMotion.setAttribute('path', mp.path);
    if (mp.auto_rotate === true) {
      animMotion.setAttribute('rotate', 'auto');
    }
    el.appendChild(animMotion);
  }

  return el;
}

function renderComponentLayer(layer: ComponentLayer, svg: SVGSVGElement): SVGElement {
  const registry = activeOptions.componentRegistry;
  const spec = registry?.get(layer.ref);

  if (!spec) {
    return renderPlaceholder(layer, svg);
  }

  const resolvedLayers = resolveComponent(spec, layer.slots ?? {}, layer.overrides ?? {}, layer.variant);
  const g = createSVGElement('g');
  g.setAttribute('data-layer-id', layer.id);
  g.setAttribute('data-component-ref', layer.ref);

  // Offset children to layer position
  if (layer.x || layer.y) {
    g.setAttribute('transform', `translate(${layer.x ?? 0}, ${layer.y ?? 0})`);
  }

  const sorted = [...resolvedLayers].sort((a, b) => a.z - b.z);
  for (const child of sorted) {
    g.appendChild(renderLayer(child, svg));
  }
  return g;
}

function renderComponentListLayer(layer: ComponentListLayer, svg: SVGSVGElement): SVGElement {
  const registry = activeOptions.componentRegistry;
  const spec = registry?.get(layer.component_ref);

  if (!spec) {
    return renderPlaceholder(layer, svg);
  }

  const g = createSVGElement('g');
  g.setAttribute('data-layer-id', layer.id);

  const gap = layer.gap ?? 0;
  let offsetY = layer.y ?? 0;

  for (let i = 0; i < layer.items.length; i++) {
    const slots = layer.items[i];
    const resolvedLayers = resolveComponent(spec, slots);
    const itemG = createSVGElement('g');
    itemG.setAttribute('transform', `translate(${layer.x ?? 0}, ${offsetY})`);

    const sorted = [...resolvedLayers].sort((a, b) => a.z - b.z);
    for (const child of sorted) {
      itemG.appendChild(renderLayer(child, svg));
    }
    g.appendChild(itemG);

    // Estimate height from first layer or use fixed
    const firstLayer = resolvedLayers[0];
    const itemHeight = typeof firstLayer?.height === 'number' ? firstLayer.height : 64;
    offsetY += itemHeight + gap;
  }

  return g;
}

// ── Clip Path / Boolean Mask support ─────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function shapeToClipElement(layer: Layer): SVGElement | null {
  const l = layer as Layer & { x?: number; y?: number; width?: number; height?: number; radius?: unknown; sides?: number };
  const x = l.x ?? 0;
  const y = l.y ?? 0;
  const w = typeof l.width === 'number' ? l.width : 100;
  const h = typeof l.height === 'number' ? l.height : 100;

  if (layer.type === 'rect') {
    const rx = typeof l.radius === 'number' ? l.radius : 0;
    const el = document.createElementNS(SVG_NS, 'rect');
    el.setAttribute('x', String(x)); el.setAttribute('y', String(y));
    el.setAttribute('width', String(w)); el.setAttribute('height', String(h));
    if (rx) el.setAttribute('rx', String(rx));
    return el;
  }

  if (layer.type === 'circle') {
    const el = document.createElementNS(SVG_NS, 'ellipse');
    el.setAttribute('cx', String(x + w / 2)); el.setAttribute('cy', String(y + h / 2));
    el.setAttribute('rx', String(w / 2)); el.setAttribute('ry', String(h / 2));
    return el;
  }

  if (layer.type === 'polygon') {
    const sides = typeof l.sides === 'number' ? l.sides : 6;
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
    const pts = Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
      return `${cx + rx * Math.cos(a)},${cy + ry * Math.sin(a)}`;
    }).join(' ');
    const el = document.createElementNS(SVG_NS, 'polygon');
    el.setAttribute('points', pts);
    return el;
  }

  // Fallback: bounding box rect
  const el = document.createElementNS(SVG_NS, 'rect');
  el.setAttribute('x', String(x)); el.setAttribute('y', String(y));
  el.setAttribute('width', String(w)); el.setAttribute('height', String(h));
  return el;
}

function buildClipDefs(layers: Layer[], svg: SVGSVGElement): void {
  const refsNeeded = new Set<string>();
  const collectRefs = (ls: Layer[]): void => {
    for (const l of ls) {
      if (l.clip_path_ref) refsNeeded.add(l.clip_path_ref);
      if (l.type === 'group' && 'layers' in l) collectRefs((l as { layers: Layer[] }).layers);
      if (l.type === 'auto_layout' && 'layers' in l) collectRefs((l as { layers: Layer[] }).layers);
    }
  };
  collectRefs(layers);
  if (!refsNeeded.size) return;

  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs') as SVGDefsElement;
    svg.insertBefore(defs, svg.firstChild);
  }

  const findLayer = (id: string, ls: Layer[]): Layer | null => {
    for (const l of ls) {
      if (l.id === id) return l;
      if (l.type === 'group' && 'layers' in l) {
        const found = findLayer(id, (l as { layers: Layer[] }).layers);
        if (found) return found;
      }
    }
    return null;
  };

  for (const refId of refsNeeded) {
    if (defs.querySelector(`#cp-${refId}`)) continue; // already built
    const refLayer = findLayer(refId, layers);
    if (!refLayer) continue;

    const clipPath = document.createElementNS(SVG_NS, 'clipPath');
    clipPath.setAttribute('id', `cp-${refId}`);
    const shape = shapeToClipElement(refLayer);
    if (shape) {
      const rot = refLayer.rotation;
      if (rot) {
        const x = (refLayer.x ?? 0) + (typeof refLayer.width === 'number' ? refLayer.width : 0) / 2;
        const y = (refLayer.y ?? 0) + (typeof refLayer.height === 'number' ? refLayer.height : 0) / 2;
        shape.setAttribute('transform', `rotate(${rot},${x},${y})`);
      }
      clipPath.appendChild(shape);
    }
    defs.appendChild(clipPath);
  }
}

function renderPlaceholder(layer: Layer, _svg: SVGSVGElement): SVGElement {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('data-layer-id', layer.id);
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(layer.x ?? 0));
  rect.setAttribute('y', String(layer.y ?? 0));
  rect.setAttribute('width', String(typeof layer.width === 'number' ? layer.width : 100));
  rect.setAttribute('height', String(typeof layer.height === 'number' ? layer.height : 100));
  rect.setAttribute('fill', 'none');
  rect.setAttribute('stroke', '#999');
  rect.setAttribute('stroke-dasharray', '4 4');
  g.appendChild(rect);

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', String((layer.x ?? 0) + 8));
  text.setAttribute('y', String((layer.y ?? 0) + 20));
  text.setAttribute('font-size', '12');
  text.setAttribute('fill', '#999');
  text.textContent = `[${layer.type}: ${layer.id}]`;
  g.appendChild(text);

  return g;
}

function prepareLayers(layers: Layer[], ctx?: TokenResolutionContext, formulaCtx?: FormulaContext): Layer[] {
  let prepared = layers.map(l => expandPositionShorthand(l) as Layer);

  // Resolve formula bindings before token substitution
  if (formulaCtx) {
    prepared = resolveAllFormulas(prepared as unknown as Record<string, unknown>[], formulaCtx) as unknown as Layer[];
  }

  if (ctx) {
    prepared = prepared.map(l => resolveLayerTokens(l, ctx));
  }

  // Sort by z-index
  return prepared.sort((a, b) => a.z - b.z);
}

export function renderDesign(spec: DesignSpec, options: RenderOptions = {}): SVGSVGElement {
  resetDefIdCounter();
  activeOptions = options;

  const { width, height } = spec.document;
  const svg = createSVGRoot(width, height);

  let ctx: TokenResolutionContext | undefined;
  if (options.theme) {
    ctx = {
      theme: options.theme,
      overrides: spec.theme?.overrides ?? options.themeOverrides,
    };
  }

  // Render top-level layers (poster mode)
  if (spec.layers) {
    const layers = prepareLayers(spec.layers, ctx, options.formulaContext);
    buildClipDefs(layers, svg);
    for (const layer of layers) {
      svg.appendChild(renderLayer(layer, svg));
    }
  }

  // Render grid overlay if enabled
  if (options.showGrid) {
    svg.appendChild(renderGridOverlay(width, height, options.gridConfig));
  }

  return svg;
}

function renderGridOverlay(
  width: number,
  height: number,
  config?: { columns: number; gutter: number; margin: number; baseline: number },
): SVGElement {
  const g = createSVGElement('g');
  g.setAttribute('data-role', 'grid-overlay');
  g.setAttribute('pointer-events', 'none');
  g.setAttribute('opacity', '0.15');

  const columns = config?.columns ?? 12;
  const gutter = config?.gutter ?? 24;
  const margin = config?.margin ?? 80;
  const baseline = config?.baseline ?? 8;

  const totalGutters = (columns - 1) * gutter;
  const availWidth = width - 2 * margin;
  const colWidth = (availWidth - totalGutters) / columns;

  // Column guides
  for (let i = 0; i < columns; i++) {
    const x = margin + i * (colWidth + gutter);
    const rect = createSVGElement('rect', {
      x, y: 0, width: colWidth, height,
      fill: '#6c5ce7',
      opacity: '0.08',
    });
    g.appendChild(rect);
  }

  // Baseline grid
  for (let y = 0; y < height; y += baseline) {
    const line = createSVGElement('line', {
      x1: 0, y1: y, x2: width, y2: y,
      stroke: '#6c5ce7',
      'stroke-width': '0.5',
      opacity: '0.1',
    });
    g.appendChild(line);
  }

  // Center crosshair
  const cx = width / 2;
  const cy = height / 2;
  g.appendChild(createSVGElement('line', { x1: cx, y1: 0, x2: cx, y2: height, stroke: '#e94560', 'stroke-width': '0.5', 'stroke-dasharray': '4 4' }));
  g.appendChild(createSVGElement('line', { x1: 0, y1: cy, x2: width, y2: cy, stroke: '#e94560', 'stroke-width': '0.5', 'stroke-dasharray': '4 4' }));

  return g;
}

export function renderPage(
  layers: Layer[],
  width: number,
  height: number,
  options: RenderOptions = {},
): SVGSVGElement {
  resetDefIdCounter();
  activeOptions = options;

  const svg = createSVGRoot(width, height);

  let ctx: TokenResolutionContext | undefined;
  if (options.theme) {
    ctx = {
      theme: options.theme,
      overrides: options.themeOverrides,
    };
  }

  const prepared = prepareLayers(layers, ctx, options.formulaContext);
  buildClipDefs(prepared, svg);
  for (const layer of prepared) {
    svg.appendChild(renderLayer(layer, svg));
  }

  return svg;
}
