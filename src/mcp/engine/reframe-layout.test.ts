// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { Layer } from '../../schema/types';
import { planReframe, boxOf } from './reframe-layout';
import { mapSubtree } from './reframe-map';

const rect = (id: string, x: number, y: number, width: number, height: number, extra: object = {}): Layer =>
  ({ id, type: 'rect', z: 2, x, y, width, height, fill: '#222', ...extra }) as unknown as Layer;
const words = (id: string, x: number, y: number, width: number, value: string, size: number): Layer =>
  ({ id, type: 'text', z: 3, x, y, width, height: size * 1.3, content: { type: 'plain', value }, style: { font_family: 'Archivo', font_size: size } }) as unknown as Layer;
/** Apply a plan the way the op does, and return each layer's box after. */
const apply = (layers: Layer[], oldW: number, oldH: number, W: number, H: number): { plan: ReturnType<typeof planReframe>; box: (l: Layer) => { x: number; y: number; width: number; height: number } } => {
  const plan = planReframe(layers, oldW, oldH, W, H);
  for (const [l, m] of plan.maps) mapSubtree(l, m);
  return { plan, box: l => boxOf(l) ?? { x: 0, y: 0, width: 0, height: 0 } };
};

describe('planReframe', () => {
  it('stacks a 16:9 title-beside-picture into a 9:16 column, larger than a uniform fit, each block on the frame', () => {
    const ground = rect('ground', 0, 0, 1920, 1080, { fill: '#F3E7D6' });
    const title = words('title', 120, 360, 760, 'Reset in 3 steps', 96);
    const pic = rect('pic', 1040, 160, 760, 760);
    const { plan, box } = apply([ground, title, pic], 1920, 1080, 1080, 1920);
    expect(plan).toMatchObject({ blocks: 2, stacked: 1 });
    expect(plan.k).toBeGreaterThan(1080 / 1920);           // uniform contain would be 0.5625
    const t = box(title), p = box(pic);
    expect(t.y + t.height).toBeLessThanOrEqual(p.y);        // title above picture, in reading order
    // Inside the margins, and clear of a vertical feed's header, caption band and buttons (the gate's safe box).
    for (const b of [t, p]) {
      expect(b.x).toBeGreaterThanOrEqual(43); expect(b.x + b.width).toBeLessThanOrEqual(900.5);
      expect(b.y).toBeGreaterThanOrEqual(290); expect(b.y + b.height).toBeLessThanOrEqual(1440.5);
    }
    expect(plan.spans.get(ground)).toEqual({ w: true, h: true });
  });

  it('keeps a row whole when stacking would not make it larger, and a glow goes where its block goes', () => {
    const a = words('a', 100, 400, 500, 'Left', 80), b = words('b', 700, 400, 500, 'Right', 80);
    const glow = rect('glow', 60, 300, 300, 300, { effects: { blur: 30 } });
    const plan = planReframe([a, b, glow], 1920, 1080, 1920 * 0.8, 1080);  // wider than tall still
    expect(plan.stacked).toBe(0);
    expect(plan.maps.get(glow)).toEqual(plan.maps.get(a));
  });

  it('keeps overlapping layers together as one block: a label on its card moves with it', () => {
    const card = rect('card', 200, 300, 600, 400), label = words('label', 240, 340, 400, 'Card', 60);
    const other = rect('other', 1100, 300, 600, 400);
    const plan = planReframe([card, label, other], 1920, 1080, 1080, 1920);
    expect(plan.maps.get(label)).toEqual(plan.maps.get(card));
    expect(plan.maps.get(other)).not.toEqual(plan.maps.get(card));
  });

  it('stacks two stats as columns — each number keeps its label under it, a row\'s rhythm apart', () => {
    const n1 = words('n1', 120, 300, 400, '22 min', 120), l1 = words('l1', 120, 470, 400, 'per build', 30);
    const n2 = words('n2', 900, 300, 400, '$4.1k', 120), l2 = words('l2', 900, 470, 400, 'per month', 30);
    const { plan, box } = apply([n1, l1, n2, l2], 1920, 1080, 1080, 1920);
    expect(plan).toMatchObject({ blocks: 4, stacked: 1 });
    const [a, b, c, d] = [n1, l1, n2, l2].map(box);
    expect(a && b && c && d && a.y < b.y && b.y < c.y && c.y < d.y).toBe(true);   // 22 min, per build, $4.1k, per month
    expect((c?.y ?? 0) - ((b?.y ?? 0) + (b?.height ?? 0))).toBeLessThan(200);     // not the 380 px between the old columns
  });

  it('keeps a row of marks a row: four progress dashes do not become a column', () => {
    // b23's step 2, box for box: a numeral beside a column of words over a row of dashes and, far right, an icon disc.
    const col = [rect('num', 140, 282, 350, 459), rect('kicker', 620, 306, 202, 23), rect('title', 620, 367, 536, 84), rect('detail', 620, 488, 945, 87)];
    const dashes = [0, 1, 2, 3].map(i => rect(`d${i}`, 620 + i * 96, 900, 80, 8)), disc = rect('disc', 1420, 602, 340, 340);
    const { box } = apply([...col, ...dashes, disc], 1920, 1080, 1080, 1920);
    const ys = dashes.map(d => box(d).y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
  });

  it('opens a scene group that holds the frame, and sizes it to the new one', () => {
    const scene = { id: 'scene', type: 'group', z: 1, x: 0, y: 0, width: 1920, height: 1080, locked: true,
      layers: [rect('bg', 0, 0, 1920, 1080), words('t', 120, 400, 700, 'Hello', 90), rect('pic', 1100, 200, 700, 700)] } as unknown as Layer;
    const plan = planReframe([scene], 1920, 1080, 1080, 1920);
    expect(plan.holders).toEqual([scene]);
    expect(plan.blocks).toBe(2);
  });
});
