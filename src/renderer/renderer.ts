import type { Layer, DesignSpec, ThemeSpec } from '../schema/types';
import { resolveLayerTokens, type TokenResolutionContext } from '../engine/token-resolver';
import { expandPositionShorthand } from '../schema/validator';
import { createSVGRoot, resetDefIdCounter } from './svg-utils';
import {
  renderRect, renderCircle, renderPath, renderPolygon,
  renderLine, renderText, renderImage, renderIcon,
  renderMermaid, renderChart, renderCode, renderMath, renderGroup,
} from './layer-renderers';

export interface RenderOptions {
  theme?: ThemeSpec;
  themeOverrides?: Record<string, string>;
  interactive?: boolean;
}

export function renderLayer(layer: Layer, svg: SVGSVGElement): SVGElement {
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
    case 'component':
    case 'component_list':
      // Component rendering is handled by the component system
      // Render a placeholder
      return renderPlaceholder(layer, svg);
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

  return svg;
}

export function renderPage(
  layers: Layer[],
  width: number,
  height: number,
  options: RenderOptions = {},
): SVGSVGElement {
  resetDefIdCounter();

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
