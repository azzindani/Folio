import { describe, it, expect } from 'vitest';
import { expandShorthandLayers, coerceShorthandLayers } from './shorthand-parser';

describe('chart / kpi_card / component shorthand (data-viz + reuse)', () => {
  it('builds a bar-chart vega-lite spec from compact data', () => {
    const [c] = expandShorthandLayers(coerceShorthandLayers({
      ch: { type: 'chart', chart: 'bar', pos: [0, 0, 400, 300], data: [{ x: 'Q1', y: 10 }, { label: 'Q2', value: 20 }] },
    })) as Array<{ type?: string; spec?: { mark?: unknown; data?: { values?: { x: unknown; y: number }[] } } }>;
    expect(c.type).toBe('chart');
    expect(c.spec?.mark).toBe('bar');
    // label/value normalized to x/y
    expect(c.spec?.data?.values).toEqual([{ x: 'Q1', y: 10 }, { x: 'Q2', y: 20 }]);
  });

  it('builds a donut arc spec', () => {
    const [c] = expandShorthandLayers(coerceShorthandLayers({
      ch: { type: 'chart', chart: 'donut', pos: [0, 0, 300, 300], data: [{ x: 'A', y: 1 }] },
    })) as Array<{ spec?: { mark?: { type?: string; innerRadius?: number } } }>;
    expect(c.spec?.mark?.type).toBe('arc');
    expect(c.spec?.mark?.innerRadius).toBe(60);
  });

  it('maps kpi_card fields (label/value/delta/icon/fill→background)', () => {
    const [k] = expandShorthandLayers(coerceShorthandLayers({
      kpi: { type: 'kpi_card', pos: [0, 0, 300, 160], label: 'Revenue', value: '$1.2M', delta: '+12%', icon: 'dollar-sign', fill: '#16213E', radius: 12 },
    })) as Array<{ type?: string; label?: string; value?: string; delta?: string; icon?: string; background?: string; border_radius?: number }>;
    expect(k.type).toBe('kpi_card');
    expect(k.label).toBe('Revenue');
    expect(k.value).toBe('$1.2M');
    expect(k.delta).toBe('+12%');
    expect(k.icon).toBe('dollar-sign');
    expect(k.background).toBe('#16213E');
    expect(k.border_radius).toBe(12);
  });

  it('passes component ref/slots/variant through', () => {
    const [c] = expandShorthandLayers(coerceShorthandLayers({
      inst: { type: 'component', pos: [0, 0, 300, 200], ref: 'feature-card', slots: { title: 'Fast' }, variant: 'dark' },
    })) as Array<{ type?: string; ref?: string; slots?: { title?: string }; variant?: string }>;
    expect(c.type).toBe('component');
    expect(c.ref).toBe('feature-card');
    expect(c.slots?.title).toBe('Fast');
    expect(c.variant).toBe('dark');
  });
});

describe('children→layers alias + shape/corner_radius (UI-tree vocabulary)', () => {
  it('maps `children` to `layers` at every nesting level', () => {
    const [row] = expandShorthandLayers(coerceShorthandLayers({
      r: { type: 'row', pos: [0, 0, 900, 300], gap: 20, children: [
        { type: 'column', width: 280, height: 300, children: [
          { type: 'text', width: 240, height: 50, text: 'Hi', size: 28 },
        ] },
      ] },
    })) as Array<{ type?: string; layers?: Array<{ type?: string; layers?: Array<{ content?: { value?: string } }> }> }>;
    expect(row.type).toBe('auto_layout');
    expect(row.layers).toHaveLength(1);
    expect(row.layers?.[0].type).toBe('auto_layout');
    expect(row.layers?.[0].layers?.[0].content?.value).toBe('Hi');
  });

  it('maps type "shape"/"box" → rect and corner_radius → radius', () => {
    const [a, b] = expandShorthandLayers(coerceShorthandLayers({
      s: { type: 'shape', pos: [0, 0, 100, 100], fill: '#abc', corner_radius: 12 },
      x: { type: 'box', pos: [0, 0, 50, 50], fill: '#def' },
    })) as Array<{ type?: string; radius?: number }>;
    expect(a.type).toBe('rect');
    expect(a.radius).toBe(12);
    expect(b.type).toBe('rect');
  });

  it('canonical layers wins over children if both present', () => {
    const [g] = expandShorthandLayers(coerceShorthandLayers({
      grp: { type: 'group', pos: [0, 0, 100, 100], layers: [{ type: 'rect', pos: [0, 0, 10, 10] }], children: [] },
    })) as Array<{ layers?: unknown[] }>;
    expect(g.layers).toHaveLength(1);
  });
});

describe('repeat (one template × N, with optional data binding)', () => {
  it('repeats a layer N times with unique ids', () => {
    const out = expandShorthandLayers(coerceShorthandLayers({
      dot: { type: 'circle', repeat: 3, pos: [0, 0, 20, 20], fill: '#fff' },
    })) as Array<{ id?: string; type?: string }>;
    expect(out).toHaveLength(3);
    expect(out.map(l => l.id)).toEqual(['dot_1', 'dot_2', 'dot_3']);
    expect(out.every(l => l.type === 'circle')).toBe(true);
  });

  it('binds a data array, substituting {{tokens}} per row', () => {
    const out = expandShorthandLayers(coerceShorthandLayers({
      item: { type: 'text', repeat: [{ name: 'Free', price: '$0' }, { name: 'Pro', price: '$9' }],
              pos: [0, 0, 300, 60], text: '{{name}} — {{price}}', size: 30 },
    })) as Array<{ id?: string; content?: { value?: string } }>;
    expect(out).toHaveLength(2);
    expect(out[0].content?.value).toBe('Free — $0');
    expect(out[1].content?.value).toBe('Pro — $9');
  });

  it('repeats children inside a container (data-bound cards in a row)', () => {
    const [row] = expandShorthandLayers(coerceShorthandLayers({
      grid: { type: 'row', pos: [0, 0, 900, 200], gap: 20, layers: {
        card: { type: 'column', width: 280, height: 200, fill: '#222',
                repeat: [{ t: 'A' }, { t: 'B' }, { t: 'C' }],
                layers: { lbl: { type: 'text', width: 240, height: 40, text: 'Plan {{t}}', size: 28 } } },
      } },
    })) as Array<{ layers?: Array<{ id?: string; layers?: Array<{ content?: { value?: string } }> }> }>;
    const cards = row.layers ?? [];
    expect(cards).toHaveLength(3);
    expect(cards[2].id).toBe('card_3');
    expect(cards[0].layers?.[0].content?.value).toBe('Plan A');
    expect(cards[2].layers?.[0].content?.value).toBe('Plan C');
  });

  it('exposes the index as {{i}} / {{n}} for a numeric repeat', () => {
    const out = expandShorthandLayers(coerceShorthandLayers({
      step: { type: 'text', repeat: 3, pos: [0, 0, 100, 40], text: 'Step {{i}}', size: 24 },
    })) as Array<{ content?: { value?: string } }>;
    expect(out.map(l => l.content?.value)).toEqual(['Step 1', 'Step 2', 'Step 3']);
  });
});
