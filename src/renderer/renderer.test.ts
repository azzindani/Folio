import { describe, it, expect, beforeEach } from 'vitest';
import { renderDesign, renderPage, renderLayer, invalidateCache } from './renderer';
import { createSVGRoot } from './svg-utils';
import type { DesignSpec, Layer, RectLayer, CircleLayer, TextLayer, LineLayer, PathLayer, PolygonLayer, IconLayer, GroupLayer } from '../schema/types';

function makeDesign(layers: Layer[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Test', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers,
  };
}

describe('renderDesign', () => {
  it('creates an SVG root with correct dimensions', () => {
    const svg = renderDesign(makeDesign([]));
    expect(svg.tagName).toBe('svg');
    expect(svg.getAttribute('width')).toBe('1080');
    expect(svg.getAttribute('height')).toBe('1080');
    expect(svg.getAttribute('viewBox')).toBe('0 0 1080 1080');
  });

  it('renders layers sorted by z-index', () => {
    const svg = renderDesign(makeDesign([
      { id: 'high', type: 'rect', z: 20, x: 0, y: 0, width: 50, height: 50 } as RectLayer,
      { id: 'low', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50 } as RectLayer,
    ]));
    const children = Array.from(svg.children).filter(c => c.tagName !== 'defs');
    expect(children[0].getAttribute('data-layer-id')).toBe('low');
    expect(children[1].getAttribute('data-layer-id')).toBe('high');
  });

  it('renders all layers to SVG children', () => {
    const svg = renderDesign(makeDesign([
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100 } as RectLayer,
      { id: 'b', type: 'rect', z: 10, x: 0, y: 0, width: 50, height: 50 } as RectLayer,
      { id: 'c', type: 'rect', z: 20, x: 0, y: 0, width: 25, height: 25 } as RectLayer,
    ]));
    const layerEls = svg.querySelectorAll('[data-layer-id]');
    expect(layerEls.length).toBe(3);
  });

  it('resolves tokens when theme is provided', () => {
    const theme = {
      _protocol: 'theme/v1' as const,
      name: 'Test', version: '1.0.0',
      colors: { primary: '#FF0000', background: '#000' },
      typography: { scale: {}, families: { heading: 'Arial' } },
      spacing: { unit: 8, scale: [] },
      effects: {},
      radii: {},
    };
    const svg = renderDesign(
      makeDesign([{
        id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
        fill: { type: 'solid', color: '$primary' },
      } as RectLayer]),
      { theme },
    );
    const rect = svg.querySelector('rect');
    expect(rect?.getAttribute('fill')).toBe('#FF0000');
  });
});

describe('renderPage', () => {
  it('renders a set of layers into an SVG', () => {
    const layers: Layer[] = [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080 } as RectLayer,
    ];
    const svg = renderPage(layers, 1080, 1080);
    expect(svg.tagName).toBe('svg');
    expect(svg.querySelectorAll('[data-layer-id]').length).toBe(1);
  });
});

describe('renderLayer — rect', () => {
  let svg: SVGSVGElement;
  beforeEach(() => { svg = createSVGRoot(1080, 1080); });

  it('renders rect with position and dimensions', () => {
    const el = renderLayer({ id: 'r', type: 'rect', z: 0, x: 10, y: 20, width: 200, height: 150 } as RectLayer, svg);
    expect(el.tagName).toBe('rect');
    expect(el.getAttribute('x')).toBe('10');
    expect(el.getAttribute('y')).toBe('20');
    expect(el.getAttribute('width')).toBe('200');
    expect(el.getAttribute('height')).toBe('150');
    expect(el.getAttribute('data-layer-id')).toBe('r');
  });

  it('renders rect with solid fill', () => {
    const el = renderLayer({
      id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: '#FF0000' },
    } as RectLayer, svg);
    expect(el.getAttribute('fill')).toBe('#FF0000');
  });

  it('renders rect with solid fill opacity', () => {
    const el = renderLayer({
      id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: '#FF0000', opacity: 0.5 },
    } as RectLayer, svg);
    expect(el.getAttribute('fill-opacity')).toBe('0.5');
  });

  it('renders rect with linear gradient fill', () => {
    const el = renderLayer({
      id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
      fill: {
        type: 'linear', angle: 90,
        stops: [{ color: '#000', position: 0 }, { color: '#FFF', position: 100 }],
      },
    } as RectLayer, svg);
    expect(el.getAttribute('fill')).toMatch(/^url\(#lg-\d+\)$/);
    const defs = svg.querySelector('defs');
    expect(defs?.querySelector('linearGradient')).toBeTruthy();
    expect(defs?.querySelectorAll('stop').length).toBe(2);
  });

  it('renders rect with radial gradient fill', () => {
    const el = renderLayer({
      id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
      fill: {
        type: 'radial', cx: 50, cy: 50, radius: 70,
        stops: [{ color: '#000', position: 0 }, { color: '#FFF', position: 100 }],
      },
    } as RectLayer, svg);
    expect(el.getAttribute('fill')).toMatch(/^url\(#rg-\d+\)$/);
    expect(svg.querySelector('radialGradient')).toBeTruthy();
  });

  it('renders rect with border radius', () => {
    const el = renderLayer({
      id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
      radius: 16,
    } as RectLayer, svg);
    expect(el.getAttribute('rx')).toBe('16');
  });

  it('renders rect with stroke', () => {
    const el = renderLayer({
      id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
      stroke: { color: '#FF0000', width: 2, dash: [4, 4] },
    } as RectLayer, svg);
    expect(el.getAttribute('stroke')).toBe('#FF0000');
    expect(el.getAttribute('stroke-width')).toBe('2');
    expect(el.getAttribute('stroke-dasharray')).toBe('4 4');
  });

  it('renders rect with effects (shadow)', () => {
    const el = renderLayer({
      id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
      effects: { shadows: [{ x: 0, y: 4, blur: 24, color: 'rgba(0,0,0,0.4)' }] },
    } as RectLayer, svg);
    expect(el.getAttribute('filter')).toMatch(/^url\(#fx-\d+\)$/);
    expect(svg.querySelector('feDropShadow')).toBeTruthy();
  });

  it('hides rect when visible=false', () => {
    const el = renderLayer({
      id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
      visible: false,
    } as RectLayer, svg);
    expect(el.getAttribute('display')).toBe('none');
  });

  it('applies rotation transform', () => {
    const el = renderLayer({
      id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
      rotation: 45,
    } as RectLayer, svg);
    expect(el.getAttribute('transform')).toContain('rotate(45');
  });
});

describe('renderLayer — circle', () => {
  let svg: SVGSVGElement;
  beforeEach(() => { svg = createSVGRoot(1080, 1080); });

  it('renders ellipse with correct cx/cy/rx/ry', () => {
    const el = renderLayer({
      id: 'c', type: 'circle', z: 0, x: 100, y: 100, width: 200, height: 200,
    } as CircleLayer, svg);
    expect(el.tagName).toBe('ellipse');
    expect(el.getAttribute('cx')).toBe('200'); // x + w/2
    expect(el.getAttribute('cy')).toBe('200');
    expect(el.getAttribute('rx')).toBe('100');
    expect(el.getAttribute('ry')).toBe('100');
  });

  it('renders circle with fill', () => {
    const el = renderLayer({
      id: 'c', type: 'circle', z: 0, x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: '#00FF00' },
    } as CircleLayer, svg);
    expect(el.getAttribute('fill')).toBe('#00FF00');
  });
});

describe('renderLayer — text', () => {
  let svg: SVGSVGElement;
  beforeEach(() => { svg = createSVGRoot(1080, 1080); });

  it('renders plain text with style attributes', () => {
    const el = renderLayer({
      id: 't', type: 'text', z: 20, x: 80, y: 200, width: 920,
      content: { type: 'plain', value: 'Hello World' },
      style: { font_family: 'Inter', font_size: 72, font_weight: 800, color: '#FFF' },
    } as TextLayer, svg);
    const textEl = el.querySelector('text');
    expect(textEl).toBeTruthy();
    expect(textEl?.textContent).toBe('Hello World');
    expect(textEl?.getAttribute('font-family')).toBe('Inter');
    expect(textEl?.getAttribute('font-size')).toBe('72');
    expect(textEl?.getAttribute('fill')).toBe('#FFF');
  });

  it('renders multiline text with tspan elements', () => {
    const el = renderLayer({
      id: 't', type: 'text', z: 20, x: 0, y: 0, width: 400,
      content: { type: 'plain', value: 'Line 1\nLine 2\nLine 3' },
      style: { font_size: 16 },
    } as TextLayer, svg);
    const tspans = el.querySelectorAll('tspan');
    expect(tspans.length).toBe(3);
  });

  it('renders text with center alignment', () => {
    const el = renderLayer({
      id: 't', type: 'text', z: 20, x: 0, y: 0, width: 400,
      content: { type: 'plain', value: 'Centered' },
      style: { align: 'center', font_size: 16 },
    } as TextLayer, svg);
    const textEl = el.querySelector('text');
    expect(textEl?.getAttribute('text-anchor')).toBe('middle');
  });

  it('renders rich text with styled spans', () => {
    const el = renderLayer({
      id: 't', type: 'text', z: 20, x: 0, y: 0, width: 400,
      content: {
        type: 'rich',
        spans: [
          { text: 'Bold', bold: true },
          { text: ' Normal' },
          { text: ' Red', color: '#F00' },
        ],
      },
    } as TextLayer, svg);
    const tspans = el.querySelectorAll('tspan');
    expect(tspans.length).toBe(3);
    expect(tspans[0].getAttribute('font-weight')).toBe('bold');
    expect(tspans[2].getAttribute('fill')).toBe('#F00');
  });
});

describe('renderLayer — line', () => {
  let svg: SVGSVGElement;
  beforeEach(() => { svg = createSVGRoot(1080, 1080); });

  it('renders line with coordinates', () => {
    const el = renderLayer({
      id: 'l', type: 'line', z: 15, x1: 0, y1: 0, x2: 100, y2: 100,
      stroke: { color: '#F00', width: 2 },
    } as LineLayer, svg);
    expect(el.tagName).toBe('line');
    expect(el.getAttribute('x1')).toBe('0');
    expect(el.getAttribute('y1')).toBe('0');
    expect(el.getAttribute('x2')).toBe('100');
    expect(el.getAttribute('y2')).toBe('100');
    expect(el.getAttribute('stroke')).toBe('#F00');
  });
});

describe('renderLayer — path', () => {
  let svg: SVGSVGElement;
  beforeEach(() => { svg = createSVGRoot(1080, 1080); });

  it('renders path with d attribute', () => {
    const el = renderLayer({
      id: 'p', type: 'path', z: 10, d: 'M 0 0 L 100 100',
      stroke: { color: '#000', width: 1 },
    } as PathLayer, svg);
    expect(el.tagName).toBe('path');
    expect(el.getAttribute('d')).toBe('M 0 0 L 100 100');
  });
});

describe('renderLayer — polygon', () => {
  let svg: SVGSVGElement;
  beforeEach(() => { svg = createSVGRoot(1080, 1080); });

  it('generates polygon points from sides count', () => {
    const el = renderLayer({
      id: 'hex', type: 'polygon', z: 10, x: 0, y: 0, width: 100, height: 100,
      sides: 6,
    } as PolygonLayer, svg);
    expect(el.tagName).toBe('polygon');
    const points = el.getAttribute('points') ?? '';
    // 6-sided polygon should have 6 points
    expect(points.split(' ').length).toBe(6);
  });
});

describe('renderLayer — icon', () => {
  let svg: SVGSVGElement;
  beforeEach(() => { svg = createSVGRoot(1080, 1080); });

  it('renders icon with real Lucide SVG for known icon', () => {
    const el = renderLayer({
      id: 'ico', type: 'icon', z: 25, x: 50, y: 50, name: 'download', size: 24, color: '#F00',
    } as IconLayer, svg);
    expect(el.getAttribute('data-layer-id')).toBe('ico');
    // Known icon → nested <svg> element with correct stroke
    const innerSvg = el.querySelector('svg');
    expect(innerSvg).toBeTruthy();
    expect(innerSvg!.getAttribute('stroke')).toBe('#F00');
  });
});

describe('renderLayer — group', () => {
  let svg: SVGSVGElement;
  beforeEach(() => { svg = createSVGRoot(1080, 1080); });

  it('renders group with children sorted by z', () => {
    const el = renderLayer({
      id: 'grp', type: 'group', z: 10,
      layers: [
        { id: 'child-high', type: 'rect', z: 5, x: 0, y: 0, width: 50, height: 50 } as RectLayer,
        { id: 'child-low', type: 'rect', z: 1, x: 0, y: 0, width: 25, height: 25 } as RectLayer,
      ],
    } as GroupLayer, svg);
    expect(el.tagName).toBe('g');
    const children = Array.from(el.children);
    expect(children[0].getAttribute('data-layer-id')).toBe('child-low');
    expect(children[1].getAttribute('data-layer-id')).toBe('child-high');
  });
});

describe('deterministic rendering', () => {
  it('same input produces identical SVG output', () => {
    const spec = makeDesign([
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#000' } } as RectLayer,
      { id: 'txt', type: 'text', z: 20, x: 80, y: 200, width: 920, content: { type: 'plain', value: 'Test' }, style: { font_size: 72, color: '#FFF' } } as TextLayer,
    ]);

    // Clear cache to ensure both renders start fresh
    invalidateCache();
    const svg1 = new XMLSerializer().serializeToString(renderDesign(spec));
    invalidateCache();
    const svg2 = new XMLSerializer().serializeToString(renderDesign(spec));
    expect(svg1).toBe(svg2);
  });
});
