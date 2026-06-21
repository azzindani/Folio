import { describe, it, expect } from 'vitest';
import { rasterizeBarChartLayer } from './engine-finalize-geom';
import type { Layer } from '../schema/types';

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
