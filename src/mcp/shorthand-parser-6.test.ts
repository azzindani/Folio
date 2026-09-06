import { describe, it, expect } from 'vitest';
import { expandShorthandLayers, coerceShorthandLayers } from './shorthand-parser';
import { diagnoseShorthandKeys } from './shorthand-diagnose';
import type { ShorthandLayer } from './shorthand-parser';

describe('rotation — canonical + CSS-style aliases (frontier custom layouts)', () => {
  it('maps rotation and the rotate/angle aliases onto layer.rotation', () => {
    const [canon] = expandShorthandLayers([
      { id: 'a', type: 'rect', pos: [0, 0, 100, 100], fill: '#000', rotation: 12 },
    ] as unknown as ShorthandLayer[]) as Array<{ rotation?: number }>;
    expect(canon.rotation).toBe(12);

    const [byRotate] = expandShorthandLayers([
      { id: 'b', type: 'text', pos: [0, 0, 400, 200], text: 'tilt', size: 80, rotate: -8 },
    ] as unknown as ShorthandLayer[]) as Array<{ rotation?: number }>;
    expect(byRotate.rotation).toBe(-8);

    const [byAngle] = expandShorthandLayers([
      { id: 'c', type: 'rect', pos: [0, 0, 100, 100], fill: '#000', angle: 45 },
    ] as unknown as ShorthandLayer[]) as Array<{ rotation?: number }>;
    expect(byAngle.rotation).toBe(45);
  });

  it('does not flag rotate/angle as unrecognized fields', () => {
    expect(diagnoseShorthandKeys([
      { id: 'a', type: 'rect', pos: [0, 0, 100, 100], fill: '#000', rotate: 10, angle: 10 },
    ] as unknown as ShorthandLayer[])).toEqual([]);
  });
});

describe('connector shorthand — bespoke diagrams (join two anchors)', () => {
  it('expands from/to + arrow/curve/stroke and derives a real bbox', () => {
    const [c] = expandShorthandLayers(coerceShorthandLayers({
      cAB: { type: 'connector', from: [640, 238], to: [640, 400], arrow: 'end', curve: 'straight', stroke: '#5B677A' },
    })) as Array<{ type?: string; from?: [number, number]; to?: [number, number]; arrow?: string; curve?: string; stroke?: { color?: string; width?: number }; x?: number; y?: number; width?: number; height?: number }>;
    expect(c.type).toBe('connector');
    expect(c.from).toEqual([640, 238]);
    expect(c.to).toEqual([640, 400]);
    expect(c.arrow).toBe('end');
    expect(c.curve).toBe('straight');
    expect(c.stroke).toEqual({ color: '#5B677A', width: 2 });
    // bbox from the endpoints (so the editor can select + geometry sees its extent)
    expect(c.x).toBe(640);
    expect(c.y).toBe(238);
    expect(c.width).toBe(1);          // vertical line → min width 1
    expect(c.height).toBe(162);
  });

  it('accepts the x1,y1→x2,y2 endpoint form + bend/dashed/arrow_size', () => {
    const [c] = expandShorthandLayers(coerceShorthandLayers({
      c: { type: 'connector', x1: 100, y1: 100, x2: 300, y2: 200, curve: 'arc', bend: 0.3, dashed: true, arrow_size: 16, color: '#888' },
    })) as Array<{ x1?: number; y2?: number; bend?: number; dashed?: boolean; arrow_size?: number; stroke?: { color?: string }; x?: number; width?: number }>;
    expect(c.x1).toBe(100);
    expect(c.y2).toBe(200);
    expect(c.bend).toBe(0.3);
    expect(c.dashed).toBe(true);
    expect(c.arrow_size).toBe(16);
    expect(c.stroke).toEqual({ color: '#888', width: 2 });
    expect(c.x).toBe(100);
    expect(c.width).toBe(200);
  });

  it('does not flag connector fields as unrecognized', () => {
    expect(diagnoseShorthandKeys([
      { id: 'c', type: 'connector', from: [0, 0], to: [10, 10], curve: 'elbow', bend: 0.2, arrow: 'both', arrow_size: 12, dashed: true, stroke: '#000' },
    ] as unknown as ShorthandLayer[])).toEqual([]);
  });
});

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

  it('passes a donut slice palette + accent through (hand-placed data viz colors)', () => {
    const [d] = expandShorthandLayers(coerceShorthandLayers({
      don: { type: 'chart', chart: 'donut', pos: [0, 0, 440, 380], data: [{ label: 'A', value: 6 }, { label: 'B', value: 4 }], colors: ['#FF3D00', '#1E88E5'], accent: '#FF3D00' },
    })) as Array<{ type?: string; colors?: string[]; accent?: string }>;
    expect(d.type).toBe('chart');
    expect(d.colors).toEqual(['#FF3D00', '#1E88E5']);
    expect(d.accent).toBe('#FF3D00');
  });

  it('does not flag donut colors / line_color as unrecognized', () => {
    expect(diagnoseShorthandKeys([
      { id: 'd', type: 'chart', chart: 'donut', pos: [0, 0, 440, 380], data: [{ label: 'A', value: 1 }], colors: ['#FF3D00'], line_color: '#FF3D00' },
    ] as unknown as ShorthandLayer[])).toEqual([]);
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

describe('stroke_width — the CSS spelling, folded into the schema Stroke', () => {
  // Found on a live call: a path authored with stroke:"#FF3D00" + stroke_width:14
  // rendered as a hairline. The schema stores a Stroke as {color, width}, the
  // expander read only `stroke`, and the width silently became the 2px default.
  const one = (sh: Record<string, unknown>): Record<string, unknown> =>
    (expandShorthandLayers([sh] as unknown as ShorthandLayer[])[0]) as unknown as Record<string, unknown>;

  it('folds stroke_width into a string stroke', () => {
    const l = one({ id: 'p', type: 'path', d: 'M 0 0 L 10 10', stroke: '#f00', stroke_width: 14 });
    expect(l['stroke']).toEqual({ color: '#f00', width: 14 });
  });

  it('accepts the camelCase spelling too', () => {
    const l = one({ id: 'p', type: 'path', d: 'M 0 0 L 10 10', stroke: '#f00', strokeWidth: 9 });
    expect(l['stroke']).toEqual({ color: '#f00', width: 9 });
  });

  it('an explicit stroke.width still wins', () => {
    const l = one({ id: 'p', type: 'path', d: 'M 0 0 L 10 10', stroke: { color: '#f00', width: 3 }, stroke_width: 14 });
    expect(l['stroke']).toEqual({ color: '#f00', width: 3 });
  });

  it('a width with no colour invents no stroke', () => {
    const l = one({ id: 'p', type: 'path', d: 'M 0 0 L 10 10', stroke_width: 14 });
    expect(l['stroke']).toBeUndefined();
  });

  it('stops flagging fields it actually reads', () => {
    // A note saying "your field was ignored" about a field that WAS honoured
    // pushes the model to rewrite working input — the columns preset's own keys
    // were being reported that way while the preset laid out correctly.
    const notes = diagnoseShorthandKeys([
      { id: 'p', type: 'path', d: 'M 0 0 L 1 1', stroke: '#f00', stroke_width: 14 },
      { id: 'c', type: 'columns', pos: [0, 0, 1920, 1080], gap: 72, pad: 24, weights: [5, 7], cols: [] },
    ] as unknown as ShorthandLayer[]);
    expect(notes).toEqual([]);
  });
});

describe('a line drawn where the tools say it is', () => {
  // The line case read raw sh.x/sh.width, which `pos:[x,y,w,h]` never sets — so
  // a line authored the documented way rendered at the ORIGIN, 100px long,
  // while `base` still carried the right box. inspect/diagnose/heal/align all
  // read that box, so nothing could see the disagreement. Found by diffing an
  // exported SVG against what inspect reported.
  const one = (sh: Record<string, unknown>): Record<string, unknown> =>
    (expandShorthandLayers([sh] as unknown as ShorthandLayer[])[0]) as unknown as Record<string, unknown>;

  it('takes its endpoints from pos', () => {
    const l = one({ id: 'ln', type: 'line', pos: [100, 800, 750, 0], stroke: '#111' });
    expect([l['x1'], l['y1'], l['x2'], l['y2']]).toEqual([100, 800, 850, 800]);
  });

  it('agrees with the box it reports', () => {
    const l = one({ id: 'ln', type: 'line', pos: [100, 800, 750, 0], stroke: '#111' });
    expect(l['x1']).toBe(l['x']);
    expect(l['y1']).toBe(l['y']);
    expect((l['x2'] as number) - (l['x1'] as number)).toBe(l['width']);
  });

  it('still honours explicit endpoints, including a diagonal', () => {
    const l = one({ id: 'ln', type: 'line', pos: [0, 0, 10, 10], x1: 5, y1: 6, x2: 70, y2: 80 });
    expect([l['x1'], l['y1'], l['x2'], l['y2']]).toEqual([5, 6, 70, 80]);
  });

  it('does not tilt a rule authored as a thin box', () => {
    // pos height is thickness, not slope — sloping it would tilt every existing
    // rule written as pos:[x, y, w, 2].
    const l = one({ id: 'rule', type: 'line', pos: [40, 300, 600, 2], stroke: '#111' });
    expect(l['y1']).toBe(300);
    expect(l['y2']).toBe(300);
  });

  it('still works from x/y/width when pos is absent', () => {
    const l = one({ id: 'ln', type: 'line', x: 20, y: 30, width: 200, stroke: '#111' });
    expect([l['x1'], l['y1'], l['x2'], l['y2']]).toEqual([20, 30, 220, 30]);
  });
});
