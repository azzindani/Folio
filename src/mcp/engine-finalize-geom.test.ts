import { describe, it, expect } from 'vitest';
import type { Layer } from '../schema/types';
import { normalizeTextAliases, flattenRelativeGroups } from './engine-finalize-geom';

describe('flat text styling is put where the renderer reads it', () => {
  const text = (extra: Record<string, unknown>): Layer =>
    ({ id: 't', type: 'text', content: { type: 'plain', value: 'x' }, ...extra } as unknown as Layer);

  // From a real harness run: the model wrote `align` on the text layer four
  // times in one deck. diagnose warned each time about something the engine
  // could simply have moved — it already did exactly that for font/size/weight.
  it('lifts align, which used to be warned about instead of fixed', () => {
    const l = text({ align: 'center' });
    normalizeTextAliases([l]);
    const o = l as unknown as Record<string, unknown>;
    expect((o['style'] as Record<string, unknown>)['align']).toBe('center');
    expect(o['align']).toBeUndefined();
  });

  it('lifts every field the warning covers, not a subset of them', () => {
    const l = text({ text_transform: 'uppercase', vertical_align: 'middle', text_decoration: 'underline' });
    normalizeTextAliases([l]);
    const st = (l as unknown as Record<string, unknown>)['style'] as Record<string, unknown>;
    expect(st['text_transform']).toBe('uppercase');
    expect(st['vertical_align']).toBe('middle');
    expect(st['text_decoration']).toBe('underline');
  });

  it('does not clobber a value already set in style', () => {
    const l = text({ align: 'left', style: { align: 'right' } });
    normalizeTextAliases([l]);
    expect(((l as unknown as Record<string, unknown>)['style'] as Record<string, unknown>)['align']).toBe('right');
  });

  it('leaves NON-text layers alone — align means something else on auto_layout', () => {
    const g = { id: 'g', type: 'auto_layout', align: 'stretch' } as unknown as Layer;
    normalizeTextAliases([g]);
    expect((g as unknown as Record<string, unknown>)['align']).toBe('stretch');
  });
});

describe('flattenRelativeGroups — a path does not vote', () => {
  const g = (layers: unknown[]): Layer =>
    ({ id: 'sheet', type: 'group', x: 900, y: 200, width: 400, height: 300, layers } as unknown as Layer);
  const text = { id: 'rows', type: 'text', x: 920, y: 222, width: 360, height: 200, content: { type: 'plain', value: 'a' } };
  const lines = { id: 'lines', type: 'path', d: 'M900 272H1300M900 322H1300', stroke: { color: '#eee', width: 2 } };

  // Found live: a hand-built data sheet whose ruled lines were a path. The path
  // has no x/y, read as 0,0 — "before the group origin" — and the rows text was
  // shifted by the group offset, once per enclosing group.
  it('leaves absolute children alone when a sibling is a path', () => {
    const outer = { id: 'clip', type: 'group', x: 900, y: 200, width: 400, height: 300, layers: [g([lines, { ...text }])] } as unknown as Layer;
    expect(flattenRelativeGroups([outer])).toBe(0);
    const inner = (outer as unknown as { layers: Array<{ layers: Array<Record<string, unknown>> }> }).layers[0];
    expect(inner?.layers[1]).toMatchObject({ x: 920, y: 222 });
  });

  // Benchmark r5: an absolute clock in a group at (380, 320) whose time label started at x 340, left of the
  // box, was read as relative — every part moved 380/320 px and two labels left the canvas.
  it('keeps absolute children when one merely starts left of a box drawn too narrow', () => {
    const face = { id: 'face', type: 'ellipse', x: 390, y: 330, width: 300, height: 300 };
    const label = { id: 'time', type: 'text', x: 340, y: 660, width: 400, height: 60, content: { type: 'plain', value: '9:40 pm' } };
    const clock = { id: 'clock', type: 'group', x: 380, y: 320, width: 320, height: 420, layers: [face, label] } as unknown as Layer;
    expect(flattenRelativeGroups([clock])).toBe(0);
    expect((clock as unknown as { layers: Array<Record<string, unknown>> }).layers[1]).toMatchObject({ x: 340, y: 660 });
  });

  it('still bakes a genuinely relative group, and fits its box to the placed children only', () => {
    const rel = g([lines, { ...text, x: 20, y: 22 }]);
    expect(flattenRelativeGroups([rel])).toBe(1);
    const o = rel as unknown as { x: number; y: number; layers: Array<Record<string, unknown>> };
    expect(o.layers[1]).toMatchObject({ x: 920, y: 222 });
    expect({ x: o.x, y: o.y }).toEqual({ x: 920, y: 222 });
  });
});
