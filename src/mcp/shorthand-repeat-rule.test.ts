// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { Layer, GallerySpec } from '../schema/types';
import { expandShorthandLayers, type ShorthandLayer } from './shorthand-parser';
import { diagnoseShorthandKeys } from './shorthand-diagnose';
import { resolveLayers } from '../renderer/resolve-source';

type Node = Layer & { layers?: Layer[]; gallery?: GallerySpec; content?: { value?: string } };
const find = (ls: Layer[], id: string): Node | undefined => {
  for (const l of ls as Node[]) {
    if (l.id === id) return l;
    const hit = find(l.layers ?? [], id);
    if (hit) return hit;
  }
  return undefined;
};

const PLAN: ShorthandLayer = {
  id: 'plan', type: 'column', repeat: [{ name: 'Free' }, { name: 'Pro' }, { name: 'Team' }], keep: 'rule',
  repeat_columns: 2, repeat_gap: 24, x: 80, y: 80, width: 280, height: 200, gap: 12,
  layers: [{ type: 'text', width: 240, height: 50, text: '{{name}} · {{n}}', size: 30 }],
};

describe('repeat keep:"rule" — one gallery instead of N copies', () => {
  it('writes one group whose gallery stores the layer once and the rows it repeats over', () => {
    const [g, ...more] = expandShorthandLayers([PLAN]) as Node[];
    expect(more).toEqual([]);
    expect(g?.type).toBe('group');
    expect(g).toMatchObject({ id: 'plan', x: 80, y: 80, width: 584, height: 424 });
    expect(g?.gallery).toMatchObject({ items: [{ name: 'Free' }, { name: 'Pro' }, { name: 'Team' }], columns: 2, gap: 24, cell: { width: 280, height: 200 } });
    const tpl = g?.gallery?.template[0] as Node | undefined;
    // The layer itself is the template: its own gap stays its own, the grid's gap is repeat_gap.
    expect(tpl).toMatchObject({ id: 'item', type: 'auto_layout', x: 0, y: 0, width: 280, height: 200, gap: 12 });
  });

  it('lays the cells out and fills each row, {{n}} counting like {{i}}', () => {
    const resolved = resolveLayers(expandShorthandLayers([PLAN]));
    expect(find(resolved, 'plan_2')).toMatchObject({ x: 384, y: 80 });
    expect(find(resolved, 'plan_3')).toMatchObject({ x: 80, y: 304 });
    const texts = ['plan_1', 'plan_2', 'plan_3'].map(c => ((find(resolved, c)?.layers?.[0] as Node | undefined)?.layers?.[0] as Node | undefined)?.content?.value);
    expect(texts).toEqual(['Free · 1', 'Pro · 2', 'Team · 3']);
  });

  it('a count repeats the template that many times, one row by default', () => {
    const [g] = expandShorthandLayers([{ id: 'dot', type: 'circle', repeat: 5, keep: 'rule', x: 0, y: 500, width: 40, height: 40, repeat_gap: 10, color: '#E4572E' }]) as Node[];
    expect(g).toMatchObject({ type: 'group', width: 240, height: 40, gallery: { items: 5, columns: 5 } });
    expect(resolveLayers([g as Layer]).flatMap(l => (l as Node).layers ?? []).length).toBe(5);
  });

  it('keeps a gallery written in shorthand, its template expanded', () => {
    const [g] = expandShorthandLayers([{ id: 'grid', type: 'group', x: 0, y: 0, width: 600, height: 100,
      gallery: { items: 3, template: [{ type: 'rect', width: 180, height: 100, color: '#2B3A4A' }] } }]) as Node[];
    expect(g?.gallery?.items).toBe(3);
    expect(g?.gallery?.template[0]).toMatchObject({ type: 'rect', fill: { type: 'solid', color: '#2B3A4A' } });
  });

  it('is not flagged as an unknown key, and plain repeat still writes copies', () => {
    expect(diagnoseShorthandKeys([PLAN]).filter(d => /keep|repeat_/.test(JSON.stringify(d)))).toEqual([]);
    expect(expandShorthandLayers([{ ...PLAN, keep: undefined }]).map(l => l.id)).toEqual(['plan_1', 'plan_2', 'plan_3']);
  });
});
