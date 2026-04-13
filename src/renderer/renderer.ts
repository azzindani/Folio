import type { Layer, DesignSpec, ThemeSpec, ComponentSpec, ComponentLayer, ComponentListLayer } from '../schema/types';
import { resolveLayerTokens, type TokenResolutionContext } from '../engine/token-resolver';
import { resolveComponent } from '../engine/component-resolver';
import { expandPositionShorthand } from '../schema/validator';
import { createSVGRoot, createSVGElement, resetDefIdCounter } from './svg-utils';
import {
  renderRect, renderCircle, renderPath, renderPolygon,
  renderLine, renderText, renderImage, renderIcon,
  renderMermaid, renderChart, renderCode, renderMath, renderGroup,
  renderQRCode, renderAutoLayout,
} from './layer-renderers';

export interface RenderOptions {
  theme?: ThemeSpec;
  themeOverrides?: Record<string, string>;
  interactive?: boolean;
  componentRegistry?: Map<string, ComponentSpec>;
  showGrid?: boolean;
  gridConfig?: { columns: number; gutter: number; margin: number; baseline: number };
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

function renderLayerUncached(layer: Layer, svg: SVGSVGElement): SVGElement {
  switch (layer.type) {
    case 'rect': return renderRect(layer, svg);
    case 'circle': return renderCircle(layer, svg);
    case 'path': return renderPath(layer, svg);
    case 'polygon': return renderPolygon(layer, svg);
    case 'line': return renderLine(layer, svg);
    case 'text': return renderText(layer, svg);
    case 'image': return renderImage(layer, svg);
    case 'icon': return renderIcon(layer, svg);
    case 'mermaid': return renderMermaid(layer, svg);
    case 'chart': return renderChart(layer, svg);
    case 'code': return renderCode(layer, svg);
    case 'math': return renderMath(layer, svg);
    case 'group': return renderGroup(layer, svg, renderLayer);
    case 'component': return renderComponentLayer(layer as ComponentLayer, svg);
    case 'component_list': return renderComponentListLayer(layer as ComponentListLayer, svg);
    case 'qrcode': return renderQRCode(layer, svg);
    case 'auto_layout': return renderAutoLayout(layer, svg, renderLayer);
    default: return renderPlaceholder(layer, svg);
  }
}

function renderComponentLayer(layer: ComponentLayer, svg: SVGSVGElement): SVGElement {
  const registry = activeOptions.componentRegistry;
  const spec = registry?.get(layer.ref);

  if (!spec) {
    return renderPlaceholder(layer, svg);
  }

  const resolvedLayers = resolveComponent(spec, layer.slots ?? {}, layer.overrides ?? {});
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

function prepareLayers(layers: Layer[], ctx?: TokenResolutionContext): Layer[] {
  let prepared = layers.map(l => expandPositionShorthand(l) as Layer);

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
    const layers = prepareLayers(spec.layers, ctx);
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

  const prepared = prepareLayers(layers, ctx);
  for (const layer of prepared) {
    svg.appendChild(renderLayer(layer, svg));
  }

  return svg;
}
