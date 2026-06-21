import { describe, it, expect } from 'vitest';
import { buildMindmap } from './shorthand-presets-map';
import type { Layer } from '../schema/types';

type L = Record<string, unknown> & { id: string; type: string; layers?: L[] };
function flat(g: Layer): L[] {
  const out: L[] = [];
  const walk = (l: L): void => { out.push(l); (l.layers ?? []).forEach(walk); };
  walk(g as unknown as L);
  return out;
}

const ITEMS = [
  { title: 'Vision', desc: 'Define what you truly want to achieve.' },
  { title: 'Goals', desc: 'Set clear and measurable targets.' },
  { title: 'Actions', desc: 'Break goals into simple steps.' },
  { title: 'Review', desc: 'Monitor progress regularly.' },
];

describe('buildMindmap', () => {
  it('chain layout: one card + connector per node, linked in sequence', () => {
    const g = buildMindmap({ type: 'mindmap', title: 'Mind Mapping', layout: 'chain',
      pos: [0, 0, 1080, 1500], items: ITEMS } as never, 'mm', 0);
    const ls = flat(g);
    expect((g as unknown as L).type).toBe('group');
    expect(ls.filter(l => /^mm_cd\d+$/.test(l.id))).toHaveLength(4);   // 4 card surfaces
    expect(ls.filter(l => l.type === 'connector')).toHaveLength(3);    // n-1 links
    expect(ls.find(l => l.id === 'mm_title')).toBeTruthy();
  });

  it('chain alternates card sides left/right', () => {
    const g = buildMindmap({ type: 'mindmap', title: 'T', layout: 'chain',
      pos: [0, 0, 1000, 1500], items: ITEMS } as never, 'mm', 0);
    const ls = flat(g);
    const c0 = ls.find(l => l.id === 'mm_cd0') as L;
    const c1 = ls.find(l => l.id === 'mm_cd1') as L;
    expect((c0.x as number)).toBeLessThan(c1.x as number); // even=left, odd=right
  });

  it('spokes layout: a hub pill + a connector per node', () => {
    const g = buildMindmap({ type: 'mindmap', title: 'Brainstorm', layout: 'spokes',
      pos: [0, 0, 1080, 1400], items: ITEMS } as never, 'mm', 0);
    const ls = flat(g);
    expect(ls.find(l => l.id === 'mm_hub')).toBeTruthy();
    expect(ls.find(l => l.id === 'mm_hubt')).toBeTruthy();
    expect(ls.filter(l => l.type === 'connector')).toHaveLength(4); // one per node
  });

  it('every card title pill paints above its surface', () => {
    const g = buildMindmap({ type: 'mindmap', title: 'T', layout: 'chain',
      pos: [0, 0, 1000, 1500], items: ITEMS } as never, 'mm', 0);
    const ls = flat(g);
    const cd0 = ls.find(l => l.id === 'mm_cd0') as L;
    const pl0 = ls.find(l => l.id === 'mm_pl0') as L;
    expect((pl0.z as number)).toBeGreaterThan(cd0.z as number);
  });
});
