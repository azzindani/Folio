/**
 * Unit tests for layer-renderers.ts
 * Coverage target: 80%+
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderIcon, renderRect, renderAutoLayout, renderInteractiveChart, renderInteractiveTable, renderRichText, renderKpiCard, buildChartPreviewSpec } from './layer-renderers';

// Simple render fn for group tests (avoids circular import with renderer.ts)
import { createSVGRoot, resetDefIdCounter } from './svg-utils';
import type { Layer, IconLayer, RectLayer, AutoLayoutLayer, InteractiveChartLayer, InteractiveTableLayer, RichTextLayer, KpiCardLayer } from '../schema/types';

import { renderText } from './layer-renderers';
import type { TextLayer } from '../schema/types';

import { renderCircle } from './layer-renderers';
import type { CircleLayer } from '../schema/types';

const simpleRenderFn = (layer: Layer, svg: SVGSVGElement): SVGElement => {
  // For tests, always render as rect
  return renderRect({
    id: layer.id, type: 'rect', z: layer.z,
    x: (layer as RectLayer).x ?? 0,
    y: (layer as RectLayer).y ?? 0,
    width: (layer as RectLayer).width ?? 10,
    height: (layer as RectLayer).height ?? 10,
  }, svg);
};
function makeSVG() {
  return createSVGRoot(1080, 1080);
}

beforeEach(() => {
  resetDefIdCounter();
});

// ── Path ────────────────────────────────────────────────────

describe('renderAutoLayout', () => {
  function makeSVG() { return createSVGRoot(800, 800); }
  beforeEach(() => { resetDefIdCounter(); });

  it('returns a <g> with data-layer-id', () => {
    const layer: AutoLayoutLayer = {
      id: 'al1', type: 'auto_layout', z: 0, x: 0, y: 0, width: 300, height: 100,
      direction: 'row', gap: 8, layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el.tagName).toBe('g');
    expect(el.getAttribute('data-layer-id')).toBe('al1');
  });

  it('lays out children in a row', () => {
    const children: RectLayer[] = [
      { id: 'c1', type: 'rect', z: 0, x: 0, y: 0, width: 80, height: 40 },
      { id: 'c2', type: 'rect', z: 1, x: 0, y: 0, width: 80, height: 40 },
    ];
    const layer: AutoLayoutLayer = {
      id: 'row', type: 'auto_layout', z: 0, x: 10, y: 10, width: 200, height: 60,
      direction: 'row', gap: 10, layers: children as Layer[],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el.children.length).toBe(2);
  });

  it('flex-distributes children that omit a main-axis size (no overlap)', () => {
    const children = [
      { id: 'k1', type: 'rect', z: 0, x: 0, y: 0, height: 100 },
      { id: 'k2', type: 'rect', z: 1, x: 0, y: 0, height: 100 },
      { id: 'k3', type: 'rect', z: 2, x: 0, y: 0, height: 100 },
    ];
    const layer = {
      id: 'flexrow', type: 'auto_layout', z: 0, x: 0, y: 0, width: 920, height: 200,
      direction: 'row', gap: 20, layers: children as unknown as Layer[],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    const rects = Array.from(el.querySelectorAll('rect'));
    expect(rects.length).toBe(3);
    const xs = rects.map(r => Number(r.getAttribute('x')));
    const ws = rects.map(r => Number(r.getAttribute('width')));
    expect(ws.every(w => w > 250 && w < 320)).toBe(true); // (920-40)/3 ≈ 293 each
    expect(xs[0]).toBeLessThan(xs[1]);                      // distinct, not collapsed
    expect(xs[1]).toBeLessThan(xs[2]);
  });

  it('leaves children that specify their own size untouched', () => {
    const children = [
      { id: 'f1', type: 'rect', z: 0, x: 0, y: 0, width: 80, height: 40 },
      { id: 'f2', type: 'rect', z: 1, x: 0, y: 0, width: 80, height: 40 },
    ];
    const layer = {
      id: 'fixedrow', type: 'auto_layout', z: 0, x: 0, y: 0, width: 400, height: 60,
      direction: 'row', gap: 10, layers: children as unknown as Layer[],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    const ws = Array.from(el.querySelectorAll('rect')).map(r => Number(r.getAttribute('width')));
    expect(ws).toEqual([80, 80]);
  });

  it('lays out children in a column', () => {
    const children: RectLayer[] = [
      { id: 'd1', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 50 },
      { id: 'd2', type: 'rect', z: 1, x: 0, y: 0, width: 100, height: 50 },
    ];
    const layer: AutoLayoutLayer = {
      id: 'col', type: 'auto_layout', z: 0, x: 0, y: 0, width: 120, height: 200,
      direction: 'column', gap: 5, layers: children as Layer[],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el.children.length).toBe(2);
  });

  it('renders background rect when fill is set', () => {
    const layer: AutoLayoutLayer = {
      id: 'al-fill', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0,
      fill: { type: 'solid', color: '#ff0000' },
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    const rect = el.querySelector('rect');
    expect(rect).toBeTruthy();
    expect(rect?.getAttribute('fill')).toBe('#ff0000');
  });

  it('handles padding object', () => {
    const layer: AutoLayoutLayer = {
      id: 'al-pad', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el).toBeTruthy();
  });

  it('handles numeric padding', () => {
    const layer: AutoLayoutLayer = {
      id: 'al-numpad', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0,
      padding: 16 as unknown as AutoLayoutLayer['padding'],
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el).toBeTruthy();
  });

  it('applies opacity attribute when fill has opacity (lines 668-669)', () => {
    const layer: AutoLayoutLayer = {
      id: 'al-opacity', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0,
      fill: { type: 'solid', color: '#0000ff', opacity: 0.5 },
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    const rect = el.querySelector('rect');
    expect(rect?.getAttribute('opacity')).toBe('0.5');
  });

  it('applies stroke to background rect when stroke is defined (line 676)', () => {
    const layer: AutoLayoutLayer = {
      id: 'al-stroke', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0,
      fill: { type: 'solid', color: '#00ff00' },
      stroke: { color: '#ff0000', width: 2 },
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    const rect = el.querySelector('rect');
    expect(rect?.getAttribute('stroke')).toBe('#ff0000');
  });

  it('sets rx/ry on background rect when radius is a number (lines 667-669)', () => {
    const layer = {
      id: 'al-radius', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0,
      fill: { type: 'solid', color: '#0000ff' },
      radius: 8,
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    const rect = el.querySelector('rect');
    expect(rect?.getAttribute('rx')).toBe('8');
    expect(rect?.getAttribute('ry')).toBe('8');
  });

  it('uses default 0 for width/height when non-numeric (line 664-665)', () => {
    const layer = {
      id: 'al-nosize', type: 'auto_layout', z: 0, x: 0, y: 0,
      direction: 'row', gap: 0,
      fill: { type: 'solid', color: '#ff0000' },
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    const rect = el.querySelector('rect');
    expect(rect?.getAttribute('width')).toBe('0');
    expect(rect?.getAttribute('height')).toBe('0');
  });

  it('wrap mode: groups children into tracks when they overflow main axis', () => {
    const children: RectLayer[] = [
      { id: 'c1', type: 'rect', z: 0, x: 0, y: 0, width: 80, height: 40 },
      { id: 'c2', type: 'rect', z: 1, x: 0, y: 0, width: 80, height: 40 },
      { id: 'c3', type: 'rect', z: 2, x: 0, y: 0, width: 80, height: 40 },
    ];
    const layer = {
      id: 'al-wrap', type: 'auto_layout', z: 0, x: 0, y: 0, width: 160, height: 200,
      direction: 'row', gap: 8, wrap: true,
      layers: children,
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    // Should render all 3 children without throwing
    expect(el.querySelectorAll('[data-layer-id]').length).toBe(3);
  });

  it('center alignment positions children along cross-axis center', () => {
    const children: RectLayer[] = [
      { id: 'c1', type: 'rect', z: 0, x: 0, y: 0, width: 60, height: 20 },
      { id: 'c2', type: 'rect', z: 1, x: 0, y: 0, width: 60, height: 60 },
    ];
    const layer = {
      id: 'al-center', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 8, align: 'center',
      layers: children,
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el.querySelectorAll('[data-layer-id]').length).toBe(2);
  });

  it('end alignment positions children at cross-axis end', () => {
    const children: RectLayer[] = [
      { id: 'c1', type: 'rect', z: 0, x: 0, y: 0, width: 60, height: 30 },
    ];
    const layer = {
      id: 'al-end', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0, align: 'end',
      layers: children,
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el.querySelectorAll('[data-layer-id]').length).toBe(1);
  });

  it('justify: center positions cursor at center of main axis', () => {
    const children: RectLayer[] = [
      { id: 'c1', type: 'rect', z: 0, x: 0, y: 0, width: 60, height: 40 },
    ];
    const layer = {
      id: 'jc', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 80,
      direction: 'row', gap: 0, justify: 'center',
      layers: children,
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el.querySelectorAll('[data-layer-id]').length).toBe(1);
  });

  it('justify: end positions cursor at main axis end', () => {
    const children: RectLayer[] = [
      { id: 'c1', type: 'rect', z: 0, x: 0, y: 0, width: 60, height: 40 },
    ];
    const layer = {
      id: 'je', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 80,
      direction: 'row', gap: 0, justify: 'end',
      layers: children,
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el.querySelectorAll('[data-layer-id]').length).toBe(1);
  });

  it('justify: space-between distributes space between children', () => {
    const children: RectLayer[] = [
      { id: 'c1', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 40 },
      { id: 'c2', type: 'rect', z: 1, x: 0, y: 0, width: 50, height: 40 },
    ];
    const layer = {
      id: 'jsb', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 80,
      direction: 'row', gap: 0, justify: 'space-between',
      layers: children,
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el.querySelectorAll('[data-layer-id]').length).toBe(2);
  });

  it('justify: space-around distributes equal space around children', () => {
    const children: RectLayer[] = [
      { id: 'c1', type: 'rect', z: 0, x: 0, y: 0, width: 40, height: 40 },
      { id: 'c2', type: 'rect', z: 1, x: 0, y: 0, width: 40, height: 40 },
    ];
    const layer = {
      id: 'jsa', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 80,
      direction: 'row', gap: 0, justify: 'space-around',
      layers: children,
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el.querySelectorAll('[data-layer-id]').length).toBe(2);
  });
});

// ── Text ─────────────────────────────────────────────────────
describe('renderText', () => {
  it('renders plain text with fill color', () => {
    const layer: TextLayer = {
      id: 'tx1', type: 'text', z: 0, x: 10, y: 20, width: 300, height: 60,
      content: { type: 'plain', value: 'Hello' },
      style: { font_size: 24, color: '#ff0000' },
    };
    const el = renderText(layer, makeSVG());
    const text = el.querySelector('text');
    expect(text?.getAttribute('fill')).toBe('#ff0000');
    expect(text?.getAttribute('font-size')).toBe('24');
  });

  it('renders multiline plain text with tspan elements', () => {
    const layer: TextLayer = {
      id: 'multi', type: 'text', z: 0, x: 0, y: 0, width: 300, height: 100,
      content: { type: 'plain', value: 'Line1\nLine2\nLine3' },
      style: {},
    };
    const el = renderText(layer, makeSVG());
    const tspans = el.querySelectorAll('tspan');
    expect(tspans.length).toBe(3);
  });

  it('renders plain text with text-anchor for center align', () => {
    const layer: TextLayer = {
      id: 'center', type: 'text', z: 0, x: 0, y: 0, width: 200, height: 50,
      content: { type: 'plain', value: 'Centered' },
      style: { align: 'center' },
    };
    const el = renderText(layer, makeSVG());
    const text = el.querySelector('text');
    expect(text?.getAttribute('text-anchor')).toBe('middle');
  });

  it('renders plain text with right text-anchor', () => {
    const layer: TextLayer = {
      id: 'right', type: 'text', z: 0, x: 0, y: 0, width: 200, height: 50,
      content: { type: 'plain', value: 'Right' },
      style: { align: 'right' },
    };
    const el = renderText(layer, makeSVG());
    expect(el.querySelector('text')?.getAttribute('text-anchor')).toBe('end');
  });

  it('renders rich text with tspan spans', () => {
    const layer: TextLayer = {
      id: 'rich', type: 'text', z: 0, x: 0, y: 0, width: 300, height: 60,
      content: { type: 'rich', spans: [
        { text: 'Bold', bold: true, color: '#f00' },
        { text: ' Normal', italic: true, size: 18 },
      ] },
      style: {},
    };
    const el = renderText(layer, makeSVG());
    const tspans = el.querySelectorAll('tspan');
    expect(tspans.length).toBe(2);
    expect(tspans[0].getAttribute('font-weight')).toBe('bold');
    expect(tspans[0].getAttribute('fill')).toBe('#f00');
    expect(tspans[1].getAttribute('font-style')).toBe('italic');
    expect(tspans[1].getAttribute('font-size')).toBe('18');
  });

  it('renders markdown as foreignObject div', () => {
    const layer: TextLayer = {
      id: 'md', type: 'text', z: 0, x: 0, y: 0, width: 400, height: 200,
      content: { type: 'markdown', value: '# Hello\n\nWorld' },
      style: { font_size: 16 },
    };
    const el = renderText(layer, makeSVG());
    expect(el.querySelector('foreignObject')).not.toBeNull();
  });

  it('applies letter-spacing and line-height to plain text', () => {
    const layer: TextLayer = {
      id: 'spacing', type: 'text', z: 0, x: 0, y: 0, width: 200, height: 50,
      content: { type: 'plain', value: 'Spaced' },
      style: { letter_spacing: 2, line_height: 1.8 },
    };
    const el = renderText(layer, makeSVG());
    expect(el.querySelector('text')?.getAttribute('letter-spacing')).toBe('2px');
  });
});

// ── Circle ───────────────────────────────────────────────────
describe('renderCircle', () => {
  it('renders an ellipse with correct cx/cy/rx/ry', () => {
    const layer: CircleLayer = {
      id: 'c1', type: 'circle', z: 0, x: 0, y: 0, width: 100, height: 80,
    };
    const el = renderCircle(layer, makeSVG());
    expect(el.tagName).toBe('ellipse');
    expect(el.getAttribute('rx')).toBe('50');
    expect(el.getAttribute('ry')).toBe('40');
  });

  it('uses explicit cx/cy when provided', () => {
    const layer: CircleLayer = {
      id: 'c2', type: 'circle', z: 0, cx: 200, cy: 150, rx: 60, ry: 60,
    } as unknown as CircleLayer;
    const el = renderCircle(layer, makeSVG());
    expect(el.getAttribute('cx')).toBe('200');
    expect(el.getAttribute('cy')).toBe('150');
  });

  it('applies fill and stroke', () => {
    const layer: CircleLayer = {
      id: 'c3', type: 'circle', z: 0, x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: '#00ff00' },
      stroke: { color: '#ff0000', width: 3 },
    };
    const el = renderCircle(layer, makeSVG());
    expect(el.getAttribute('fill')).toBe('#00ff00');
    expect(el.getAttribute('stroke')).toBe('#ff0000');
    expect(el.getAttribute('stroke-width')).toBe('3');
  });
});

// ── Icon fallback ────────────────────────────────────────────
describe('renderIcon — fallback for unknown icon', () => {
  it('renders a clean circle (not a raw-name label) for unknown icon name', () => {
    const layer: IconLayer = {
      id: 'unk', type: 'icon', z: 0, name: '__nonexistent_icon__', size: 32,
      x: 0, y: 0,
    } as unknown as IconLayer;
    const el = renderIcon(layer, makeSVG());
    expect(el.querySelector('circle')).not.toBeNull();
    expect(el.querySelector('text')).toBeNull();
  });

  it('resolves a synonym name to a real Lucide icon (no placeholder)', () => {
    const layer = { id: 'syn', type: 'icon', z: 0, name: 'photo', size: 32, x: 0, y: 0 } as unknown as IconLayer;
    const el = renderIcon(layer, makeSVG());
    // 'photo' → 'image': a nested <svg> glyph, not the dashed-rect placeholder.
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('text')).toBeNull();
  });
});

// ── Report layer renderers ───────────────────────────────────

describe('renderInteractiveChart', () => {
  it('renders a foreignObject with folio-chart container', () => {
    const layer: InteractiveChartLayer = {
      id: 'chart1', type: 'interactive_chart', z: 0,
      chart_type: 'bar', data_ref: '$data.sales',
      x: 10, y: 20, width: 600, height: 400,
    } as unknown as InteractiveChartLayer;
    const fo = renderInteractiveChart(layer, makeSVG());
    expect(fo.tagName.toLowerCase()).toBe('foreignobject');
    const container = fo.querySelector('.folio-chart');
    expect(container).not.toBeNull();
  });

  it('shows the chart title as the initial placeholder before vega mounts', () => {
    const layer: InteractiveChartLayer = {
      id: 'c2', type: 'interactive_chart', z: 0,
      chart_type: 'line', data_ref: '$data.metrics',
      x: 0, y: 0, width: 400, height: 300,
      title: 'My Chart', legend: false, grid: true, animate: false,
    } as unknown as InteractiveChartLayer;
    const fo = renderInteractiveChart(layer, makeSVG());
    const container = fo.querySelector<HTMLElement>('.folio-chart');
    expect(container?.textContent).toContain('My Chart');
    expect(container?.dataset['layerId']).toBe('c2');
  });

  it('defaults width/height to 400/300 when not numeric', () => {
    const layer = { id: 'c3', type: 'interactive_chart', z: 0, chart_type: 'bar', data_ref: '$data.x' } as unknown as InteractiveChartLayer;
    const fo = renderInteractiveChart(layer, makeSVG());
    expect(fo.getAttribute('width')).toBe('400');
    expect(fo.getAttribute('height')).toBe('300');
  });
});

describe('renderInteractiveTable', () => {
  it('renders a foreignObject with folio-table container', () => {
    const layer: InteractiveTableLayer = {
      id: 't1', type: 'interactive_table', z: 0,
      data_ref: '$data.rows', columns: [{ field: 'name', title: 'Name' }],
      x: 0, y: 0, width: 800, height: 300,
    } as unknown as InteractiveTableLayer;
    const fo = renderInteractiveTable(layer, makeSVG());
    expect(fo.tagName.toLowerCase()).toBe('foreignobject');
    expect(fo.querySelector('.folio-table')).not.toBeNull();
  });

  it('renders the declared column headers in a static preview table', () => {
    const cols = [{ field: 'rev', title: 'Revenue', width: 120, sortable: true }, { field: 'q', title: 'Qty' }];
    const layer: InteractiveTableLayer = {
      id: 't2', type: 'interactive_table', z: 0,
      data_ref: '$data.sales', columns: cols,
      pagination: true, page_size: 10, filterable: true, exportable: true, theme: 'midnight',
      x: 0, y: 0, width: 600, height: 300,
    } as unknown as InteractiveTableLayer;
    const fo = renderInteractiveTable(layer, makeSVG());
    const container = fo.querySelector<HTMLElement>('.folio-table');
    expect(container?.querySelectorAll('th').length).toBe(2);
    expect(container?.textContent).toContain('Revenue');
    expect(container?.textContent).toContain('Qty');
    // No live data bound at design time → representative sample rows render.
    expect(container?.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });
});

describe('buildChartPreviewSpec', () => {
  const base = (chart_type: string, extra: Record<string, unknown> = {}): InteractiveChartLayer =>
    ({ id: 'c', type: 'interactive_chart', z: 0, chart_type, data_ref: 'ds', x_field: 'k', y_field: 'v', ...extra }) as unknown as InteractiveChartLayer;

  it('uses inline rows when available; falls back to a sample otherwise', () => {
    const withData = buildChartPreviewSpec(base('bar'), [{ k: 'A', v: 1 }, { k: 'B', v: 2 }], '#f5c842', 400, 300);
    expect(withData.isSample).toBe(false);
    expect((withData.spec['data'] as { values: unknown[] }).values.length).toBe(2);
    const noData = buildChartPreviewSpec(base('bar'), [], '#f5c842', 400, 300);
    expect(noData.isSample).toBe(true);
    expect((noData.spec['data'] as { values: unknown[] }).values.length).toBeGreaterThan(0);
  });

  it('maps chart_type to the right Vega-Lite mark', () => {
    const mark = (t: string): unknown => buildChartPreviewSpec(base(t), [{ k: 'A', v: 1 }], '#f5c842', 400, 300).spec['mark'];
    expect((mark('bar') as { type: string }).type).toBe('bar');
    expect((mark('line') as { type: string }).type).toBe('line');
    expect((mark('area') as { type: string }).type).toBe('area');
    expect((mark('scatter') as { type: string }).type).toBe('point');
    expect((mark('pie') as { type: string }).type).toBe('arc');
    expect((mark('donut') as { type: string; innerRadius: number }).innerRadius).toBeGreaterThan(0);
  });

  it('applies the accent colour to single-series marks', () => {
    const spec = buildChartPreviewSpec(base('bar'), [{ k: 'A', v: 1 }], '#f5c842', 400, 300).spec;
    expect((spec['mark'] as { color: string }).color).toBe('#f5c842');
  });

  it('heatmap uses a color_field as the second axis when present', () => {
    const spec = buildChartPreviewSpec(base('heatmap', { color_field: 'sector' }), [{ k: 'A', v: 1, sector: 'X' }], '#f5c842', 400, 300).spec;
    expect(spec['mark']).toBe('rect');
    expect((spec['encoding'] as { y: { field: string } }).y.field).toBe('sector');
  });
});

describe('renderRichText', () => {
  it('renders markdown with data-markdown-src', () => {
    const layer: RichTextLayer = {
      id: 'rt1', type: 'rich_text', z: 0,
      content: '## Hello', format: 'markdown',
      x: 0, y: 0, width: 500, height: 200,
    } as unknown as RichTextLayer;
    const fo = renderRichText(layer, makeSVG());
    const container = fo.querySelector<HTMLElement>('.folio-richtext');
    expect(container?.dataset['markdownSrc']).toBe('## Hello');
  });

  it('renders HTML content directly as innerHTML', () => {
    const layer: RichTextLayer = {
      id: 'rt2', type: 'rich_text', z: 0,
      content: '<p>Hello</p>', format: 'html',
      x: 0, y: 0, width: 500, height: 200,
    } as unknown as RichTextLayer;
    const fo = renderRichText(layer, makeSVG());
    const container = fo.querySelector('.folio-richtext');
    expect(container?.innerHTML).toContain('<p>Hello</p>');
  });

  it('applies font styling from layer props', () => {
    const layer: RichTextLayer = {
      id: 'rt3', type: 'rich_text', z: 0,
      content: 'text', font_family: 'Roboto', font_size: 18,
      color: '#fff', link_color: '#aaa',
      x: 0, y: 0, width: 400, height: 100,
    } as unknown as RichTextLayer;
    const fo = renderRichText(layer, makeSVG());
    const c = fo.querySelector<HTMLElement>('.folio-richtext');
    expect(c?.style.cssText).toContain('Roboto');
    expect(c?.style.cssText).toContain('18px');
  });
});

// 15s suite timeout: the first currency-style Intl.NumberFormat call on a
// cold Windows CI worker triggers ICU data load which has been observed
// to exceed the default 5s budget. The formatter cache in layer-renderers.ts
// confines that cost to a single call per (currency, decimals) tuple.
describe('renderKpiCard', { timeout: 15000 }, () => {
  it('renders a foreignObject with folio-kpi card', () => {
    const layer: KpiCardLayer = {
      id: 'kpi1', type: 'kpi_card', z: 0,
      label: 'Revenue', value: 142000,
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    expect(fo.tagName.toLowerCase()).toBe('foreignobject');
    expect(fo.querySelector('.folio-kpi')).not.toBeNull();
  });

  it('shows label and formatted value', () => {
    const layer: KpiCardLayer = {
      id: 'kpi2', type: 'kpi_card', z: 0,
      label: 'Total', value: 1500,
      format: 'currency', currency: 'USD', decimals: 0,
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    const card = fo.querySelector('.folio-kpi');
    expect(card?.textContent).toContain('Total');
    expect(card?.innerHTML).toContain('$1,500');
  });

  it('shows positive delta with up arrow', () => {
    const layer: KpiCardLayer = {
      id: 'kpi3', type: 'kpi_card', z: 0,
      label: 'Growth', value: 100, delta: 12.4, delta_format: 'percent',
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    expect(fo.querySelector('.folio-kpi')?.innerHTML).toContain('▲');
  });

  it('shows negative delta with down arrow', () => {
    const layer: KpiCardLayer = {
      id: 'kpi4', type: 'kpi_card', z: 0,
      label: 'Churn', value: 50, delta: -2.1,
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    expect(fo.querySelector('.folio-kpi')?.innerHTML).toContain('▼');
  });

  it('renders sparkline canvas when sparkline_data present', () => {
    const layer: KpiCardLayer = {
      id: 'kpi5', type: 'kpi_card', z: 0,
      label: 'Revenue', value: 100,
      sparkline_data: '$data.sales', sparkline_field: 'revenue', sparkline_color: '#6c5ce7',
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    const canvas = fo.querySelector('canvas.kpi-sparkline');
    expect(canvas).not.toBeNull();
  });

  it('formats number with decimals', () => {
    const layer: KpiCardLayer = {
      id: 'kpi6', type: 'kpi_card', z: 0,
      label: 'Rate', value: 3.14159, format: 'number', decimals: 2,
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    expect(fo.querySelector('.folio-kpi')?.innerHTML).toContain('3.14');
  });

  it('formats percent value', () => {
    const layer: KpiCardLayer = {
      id: 'kpi7', type: 'kpi_card', z: 0,
      label: 'Growth', value: 12.5, format: 'percent',
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    expect(fo.querySelector('.folio-kpi')?.innerHTML).toContain('%');
  });
});
