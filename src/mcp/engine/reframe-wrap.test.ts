// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { Layer } from '../../schema/types';
import { planWithRewrap } from './reframe-wrap';
import { planReframe, boxOf } from './reframe-layout';
import { mapSubtree } from './reframe-map';
import { plainTextLayout } from '../../renderer/layer-renderers-shared';

const words = (id: string, x: number, y: number, width: number, value: string, size: number, extra: object = {}): Layer =>
  ({ id, type: 'text', z: 3, x, y, width, height: Math.round(size * 1.3), content: { type: 'plain', value }, style: { font_family: 'Archivo', font_size: size, font_weight: 700 }, ...extra }) as unknown as Layer;
const rect = (id: string, x: number, y: number, width: number, height: number): Layer => ({ id, type: 'rect', z: 2, x, y, width, height, fill: '#222' }) as unknown as Layer;
const lines = (l: Layer): number => { const t = l as unknown as { content: { value: string }; style: object }; return plainTextLayout(t.content.value, t.style as never, l as never).lines.length; };
const meet = (a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean =>
  Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);

describe('planWithRewrap', () => {
  it('re-wraps a quote too wide for a story, larger than scaling it down, and moves what stood under it (b24)', () => {
    const make = (): Layer[] => [words('quote', 300, 330, 1320, 'The best way to predict the future is to invent it.', 96), rect('rule', 300, 600, 90, 4), words('by', 300, 630, 600, 'Alan Kay', 32)];
    const plain = planReframe(make(), 1920, 1080, 1080, 1920);
    const ls = make();
    const { plan, rewrapped } = planWithRewrap(ls, 1920, 1080, 1080, 1920);
    expect(rewrapped).toEqual(['quote']);
    expect(plan.k).toBeGreaterThan(plain.k * 1.05);
    const [quote, rule, by] = ls;
    expect(lines(quote as Layer)).toBeGreaterThan(2);
    for (const [l, m] of plan.maps) mapSubtree(l, m);
    const q = boxOf(quote as Layer), r = boxOf(rule as Layer), b = boxOf(by as Layer);
    expect(q && r && b && !meet(q, r) && !meet(q, b) && r.y > q.y + q.height).toBe(true);
  });

  it('leaves a title set on a card as it is — re-wrapping it would break the card', () => {
    const ls = [rect('card', 100, 300, 1500, 300), words('title', 160, 380, 1400, 'A long title set on its own card', 96)];
    expect(planWithRewrap(ls, 1920, 1080, 1080, 1920).rewrapped).toEqual([]);
  });

  it('lets a slide with its page number in the far corner stack and grow (b13, box for box)', () => {
    // A column's rows keep their side, not their px offset: the page number 1539 px in held the slide 1640 wide.
    const ls = [rect('kick', 140, 156, 205, 23), rect('head', 140, 213, 1053, 64), rect('build', 140, 514, 699, 180), rect('build_l', 148, 726, 162, 30),
      rect('cost', 1000, 514, 562, 242), rect('num', 1679, 985, 101, 24)];
    const plan = planReframe(ls, 1920, 1080, 1080, 1920);
    expect(plan.stacked).toBe(1);
    expect(plan.k).toBeGreaterThan(0.75);
  });
});
