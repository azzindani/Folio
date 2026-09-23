import { describe, it, expect } from 'vitest';
import type { Layer } from '../../schema/types';
import { lintComposition } from './motion-lint';

const canvas = { width: 1080, height: 1080 };
const rect = (id: string, x: number, y: number, w: number, h: number, extra: object = {}): Layer =>
  ({ id, type: 'rect', z: 2, x, y, width: w, height: h, fill: '#E4572E', ...extra } as unknown as Layer);
const text = (id: string, x: number, y: number, value: string, extra: object = {}): Layer =>
  ({ id, type: 'text', z: 5, x, y, width: 600, height: 80, content: { type: 'plain', value }, style: { font_size: 60, color: '#111111' }, ...extra } as unknown as Layer);
/** Slides a layer `dx` right over the first second, from where it was authored. */
const slide = (dx: number): object => ({ animation: { keyframes: [{ t: 0, x: 0 }, { t: 1000, x: dx }], playback: { duration: 1000, origin: 'offset' } } });
const ground = rect('bg', 0, 0, 1080, 1080, { z: 0, fill: '#FAF5EC' });
const lint = (layers: Layer[]): Array<{ kind: string; layers?: string[]; note: string }> =>
  lintComposition(layers, canvas, [], 1500) as Array<{ kind: string; layers?: string[]; note: string }>;
const of = (kind: string, ls: Layer[]): string[] => lint(ls).filter(n => n.kind === kind).map(n => (n.layers ?? []).join('>'));

describe('motion lint — objects the motion cuts into each other', () => {
  it('flags a prop that slides to rest half behind another it was clear of', () => {
    // ice lands on 400–500 × 100–200; the bottle, painted over it, spans 450–650.
    const notes = lint([ground, rect('ice', 100, 100, 100, 100, slide(300)), rect('bottle', 450, 50, 200, 400, { z: 5 })]);
    const hit = notes.find(n => n.kind === 'collision');
    expect(hit?.layers).toEqual(['bottle', 'ice']);
    expect(hit?.note).toContain('over 50% of "ice"');
  });

  it('leaves alone one tucked wholly inside another, and a pile-up that was already there as authored', () => {
    expect(of('collision', [ground, rect('badge', 100, 100, 60, 60, slide(400)), rect('card', 450, 50, 300, 300)])).toEqual([]);
    expect(of('collision', [ground, rect('a', 400, 100, 100, 100, slide(10)), rect('b', 450, 50, 200, 400, { z: 5 })])).toEqual([]);
  });

  it('reads a group as one object: its own parts never collide, and it is named as a whole', () => {
    const bottle = { id: 'bottle', type: 'group', z: 5, layers: [rect('body', 450, 150, 200, 300), rect('cap', 500, 50, 100, 120, { z: 3 })] } as unknown as Layer;
    expect(of('collision', [ground, rect('ice', 100, 200, 100, 100, slide(300)), bottle])).toEqual(['bottle>ice']);
    expect(of('collision', [ground, bottle])).toEqual([]);
  });

  it('flags words a shot slides partly under a shape, below what reads as buried', () => {
    expect(of('collision', [ground, text('line', 100, 500, 'Cold drip'), rect('panel', 560, 400, 400, 300, { z: 9, ...slide(-250) })])).toEqual(['panel>line']);
  });
});

describe('motion lint — text resting on text', () => {
  it('does not call an echo of the same words an overlap, but still flags two different lines on one spot', () => {
    const title = text('title', 100, 400, 'SMALL MACHINES', slide(0));
    const ghost = text('ghost', 106, 402, 'SMALL MACHINES', { z: 4 });
    expect(of('overlap', [ground, title, ghost])).toEqual([]);
    expect(of('overlap', [ground, title, text('other', 110, 400, 'BIG ENGINES', { z: 4 })])).toHaveLength(1);
    // A letter of the split title over the ghost of the whole of it is the effect; a shorter line is not.
    expect(of('overlap', [ground, text('title_c1', 100, 400, 'S', { split_of: 'title', ...slide(0) }), ghost])).toEqual([]);
    expect(of('overlap', [ground, text('short', 106, 400, 'SMALL', slide(0)), ghost])).toHaveLength(1);
  });
});
