import { describe, it, expect } from 'vitest';
import { buildTimeline, readSeqItems } from './shorthand-presets-seq';
import type { Layer } from '../schema/types';

type L = Record<string, unknown> & { id: string; type: string; layers?: L[] };

function flat(g: Layer): L[] {
  const out: L[] = [];
  const walk = (l: L): void => { out.push(l); (l.layers ?? []).forEach(walk); };
  walk(g as unknown as L);
  return out;
}

const SH = {
  type: 'timeline', title: 'Project Timeline', layout: 'zigzag',
  pos: [0, 0, 1080, 1527],
  items: [
    { title: 'Kick-off', desc: 'Align on goals and scope.' },
    { title: 'Research', desc: 'Interview users, study the market.' },
    { title: 'Concept', desc: 'Pick the strongest direction.' },
    { title: 'Build', desc: 'Ship the screens.' },
  ],
};

describe('buildTimeline — example-level sequence', () => {
  const g = buildTimeline(SH as never, 'tl', 0);
  const ls = flat(g);

  it('returns one group sized to the requested canvas', () => {
    expect((g as unknown as L).type).toBe('group');
    expect((g as unknown as L).height).toBe(1527); // honored the tall canvas, not shrunk to content
  });

  it('renders a header BAND with the title reversed on it', () => {
    expect(ls.find(l => l.id === 'tl_band' && l.type === 'rect')).toBeTruthy();
    expect(ls.find(l => l.id === 'tl_title' && l.type === 'text')).toBeTruthy();
  });

  it('NUMBERS each node (1..N) ABOVE its circle', () => {
    const nums = ls.filter(l => /^tl_nn\d+$/.test(l.id));
    expect(nums).toHaveLength(4);
    const values = nums.map(n => String((n.content as { value?: unknown })?.value ?? '')).sort();
    expect(values).toEqual(['1', '2', '3', '4']);
    const nodeZ = (ls.find(l => l.id === 'tl_node0') as L).z as number;
    const numZ = (nums[0]).z as number;
    expect(numZ).toBeGreaterThan(nodeZ); // number paints on top of the node fill
  });

  it('alternates content sides (zigzag): even items right-aligned-left, odd right', () => {
    const t0 = ls.find(l => l.id === 'tl_tt0') as L;   // item 0 → right side → left-aligned
    const t1 = ls.find(l => l.id === 'tl_tt1') as L;   // item 1 → left side → right-aligned
    expect((t0.style as { align?: string }).align).toBe('left');
    expect((t1.style as { align?: string }).align).toBe('right');
  });

  it('readSeqItems tolerates string items and field aliases', () => {
    const items = readSeqItems([{ heading: 'A', body: 'b' }, 'C', { name: 'D', year: '2024' }]);
    expect(items).toHaveLength(3);
    expect(items[1].title).toBe('C');
    expect(items[2].date).toBe('2024');
  });
});
