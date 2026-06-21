import { describe, it, expect } from 'vitest';
import { rasterizeBarChartLayer, rasterizeChartsDeep } from './engine-finalize-geom';
import { rasterizeNonBarChartLayer } from './engine-finalize-charts';
import type { Layer } from '../schema/types';

type Kid = Record<string, unknown>;
const kidsOf = (g: Layer): Kid[] => (g as unknown as { layers: Kid[] }).layers;
const withId = (g: Layer, sub: string, type?: string): Kid[] =>
  kidsOf(g).filter(l => String(l['id']).includes(sub) && (!type || l['type'] === type));

// A hand-placed bar chart (frontier dashboards) must rasterize to rect bars AND
// honor model-supplied colors so it matches a custom canvas — and the data value
// must be legible by default (not $muted, which vanishes on a hand-set background).

const barOf = (g: Layer) => (g as unknown as { layers: Array<Record<string, unknown>> }).layers
  .filter(l => l['type'] === 'rect' && String(l['id']).includes('_b'));
const valOf = (g: Layer) => (g as unknown as { layers: Array<Record<string, unknown>> }).layers
  .filter(l => l['type'] === 'text' && String(l['id']).includes('_v'));
const fillColor = (l: Record<string, unknown>) => (l['fill'] as Record<string, unknown>)['color'];
const textColor = (l: Record<string, unknown>) => (l['style'] as Record<string, unknown>)['color'];

describe('rasterizeBarChartLayer — colors for hand-placed frontier dashboards', () => {
  const data = [{ label: 'Rust', value: 83 }, { label: 'Go', value: 68 }];

  it('defaults: bars use $accent and the VALUE is legible $text (not $muted)', () => {
    const g = rasterizeBarChartLayer({
      id: 'c', type: 'chart', x: 0, y: 0, width: 800, height: 300,
      chart_type: 'bar', data,
    } as unknown as Layer);
    expect(g).not.toBeNull();
    expect(barOf(g as Layer).every(b => fillColor(b) === '$accent')).toBe(true);
    expect(valOf(g as Layer).every(v => textColor(v) === '$text')).toBe(true);
  });

  it('honors model-supplied bar_color / value_color / label_color', () => {
    const g = rasterizeBarChartLayer({
      id: 'c', type: 'chart', x: 0, y: 0, width: 800, height: 300,
      chart_type: 'bar', data,
      bar_color: '#FF3D00', value_color: '#FAFAFA', label_color: '#C9C6BF',
    } as unknown as Layer);
    expect(g).not.toBeNull();
    expect(barOf(g as Layer).every(b => fillColor(b) === '#FF3D00')).toBe(true);
    expect(valOf(g as Layer).every(v => textColor(v) === '#FAFAFA')).toBe(true);
  });
});

describe('rasterizeChartsDeep — reaches charts nested in a (locked) group', () => {
  const data = [{ label: 'Rust', value: 83 }, { label: 'Go', value: 68 }];

  it('rasterizes a chart inside a group so a grouped/locked dashboard is not blank', () => {
    const layers = [
      { id: 'dash', type: 'group', locked: true, x: 0, y: 0, width: 1080, height: 1000, layers: [
        { id: 'bg', type: 'rect', x: 0, y: 0, width: 1080, height: 1000, fill: { type: 'solid', color: '#0E0F13' } },
        { id: 'c', type: 'chart', x: 60, y: 200, width: 800, height: 400, chart_type: 'bar', data },
      ] },
    ] as unknown as Layer[];
    const n = rasterizeChartsDeep(layers);
    expect(n).toBe(1);
    // the chart child is now a group of rect bars (no chart layer left in the tree)
    const dashKids = (layers[0] as unknown as { layers: Array<Record<string, unknown>> }).layers;
    const chartChild = dashKids.find(l => l['id'] === 'c') as Record<string, unknown>;
    expect(chartChild['type']).toBe('group');
    expect(dashKids.some(l => l['type'] === 'chart')).toBe(false);
  });

  it('rasterizes a top-level chart too (parity with the old flat pass)', () => {
    const layers = [
      { id: 'c', type: 'chart', x: 0, y: 0, width: 800, height: 300, chart_type: 'bar', data },
    ] as unknown as Layer[];
    expect(rasterizeChartsDeep(layers)).toBe(1);
    expect((layers[0] as unknown as Record<string, unknown>)['type']).toBe('group');
  });
});

describe('rasterizeNonBarChartLayer — donut + line show in PNG (hand-placed dashboards)', () => {
  // shorthand chart:"donut" expands to spec.mark={type:'arc',innerRadius:60}
  const donutLayer = {
    id: 'd', type: 'chart', x: 0, y: 0, width: 440, height: 380,
    spec: { mark: { type: 'arc', innerRadius: 60 }, data: { values: [{ x: 'PNG', y: 58 }, { x: 'PDF', y: 27 }, { x: 'SVG', y: 15 }] } },
  } as unknown as Layer;
  const lineLayer = {
    id: 'ln', type: 'chart', x: 0, y: 0, width: 460, height: 360,
    spec: { mark: 'line', data: { values: [{ x: 'W1', y: 30 }, { x: 'W2', y: 42 }, { x: 'W3', y: 55 }, { x: 'W4', y: 78 }] } },
  } as unknown as Layer;

  it('draws a donut as arc paths + a swatch/label/percent legend', () => {
    const g = rasterizeNonBarChartLayer(donutLayer);
    expect(g).not.toBeNull();
    expect(withId(g as Layer, '_arc', 'path')).toHaveLength(3);     // one wedge per slice
    expect(withId(g as Layer, '_sw', 'rect')).toHaveLength(3);      // legend swatches
    const pcts = withId(g as Layer, '_lp', 'text').map(l => (l['content'] as Record<string, unknown>)['value']);
    expect(pcts).toEqual(['58%', '27%', '15%']);                    // share math
  });

  it('honors a model-supplied slice palette', () => {
    const g = rasterizeNonBarChartLayer({ ...donutLayer, colors: ['#FF3D00', '#1E88E5', '#43A047'] } as unknown as Layer);
    const arc0 = withId(g as Layer, '_arc', 'path')[0];
    expect((arc0['fill'] as Record<string, unknown>)['color']).toBe('#FF3D00');
  });

  it('draws a line as a polyline path + a dot per point + x labels', () => {
    const g = rasterizeNonBarChartLayer(lineLayer);
    expect(g).not.toBeNull();
    expect(withId(g as Layer, '_line', 'path')).toHaveLength(1);
    expect(withId(g as Layer, '_dot', 'ellipse')).toHaveLength(4);
    expect(withId(g as Layer, '_lx', 'text')).toHaveLength(4);
  });

  it('returns null for a bar chart (that path belongs to rasterizeBarChartLayer)', () => {
    const bar = { id: 'b', type: 'chart', x: 0, y: 0, width: 800, height: 300, chart_type: 'bar',
      data: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] } as unknown as Layer;
    expect(rasterizeNonBarChartLayer(bar)).toBeNull();
  });

  it('rasterizeChartsDeep now reaches a donut nested in a group', () => {
    const layers = [
      { id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 500, layers: [donutLayer] },
    ] as unknown as Layer[];
    expect(rasterizeChartsDeep(layers)).toBe(1);
    const inner = (layers[0] as unknown as { layers: Kid[] }).layers[0];
    expect(inner['type']).toBe('group');
  });
});
