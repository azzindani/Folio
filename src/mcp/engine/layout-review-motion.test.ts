import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../../schema/types';
import { cameraZoom, timeNotes, reviewMotionPage, withMotion, type ShotLayout } from './layout-review-motion';
import { shotRests } from './motion-lint';
import { reviewLayout } from './layout-review';

const move = (delay: number, dur: number, from: Record<string, number>, to: Record<string, number>): object =>
  ({ keyframes: [{ t: 0, ...from }, { t: dur, ...to }], playback: { duration: dur, delay, origin: 'offset', easing: 'linear' } });
const box = (id: string, x: number, y: number, w: number, h: number, extra: object = {}): Layer =>
  ({ id, type: 'rect', x, y, width: w, height: h, z: 2, fill: { type: 'solid', color: '#1f2937' }, ...extra }) as unknown as Layer;
const bg = { id: 'bg', type: 'rect', x: 0, y: 0, width: 1920, height: 1080, z: 0, fill: { type: 'solid', color: '#ffffff' } } as unknown as Layer;
const shot = (s: Partial<ShotLayout>): ShotLayout =>
  ({ shot: 's', at: 0, t: 0, rest_ms: 2000, still_ms: 2000, ink: 0, occupied: 0, empty: [], balance: null, notes: [], ...s });

describe('shotRests', () => {
  it('finds each shot\'s quiet stretch and its truly still time', () => {
    // A card slides 0–1000 ms, then rests; shot b starts at 3000 with nothing moving.
    const layers = [box('card', 0, 0, 200, 200, { animation: move(0, 1000, { x: 500 }, { x: 0 }) })];
    const r = shotRests(layers, [{ id: 'a', at: 0 }, { id: 'b', at: 3000 }], 5000);
    expect(r.map(s => s.shot)).toEqual(['a', 'b']);
    expect(r[0]?.rest_ms).toBe(2000);
    expect(r[0]?.t).toBe(2999);
    expect(r[1]?.still_ms).toBe(2000);
  });
});

describe('cameraZoom + timeNotes', () => {
  it('reads the posed camera zoom, and null without a camera', () => {
    const cam = { id: '__camera', type: 'group', layers: [], _frame_pose: { scale_x: 0.5 } } as unknown as Layer;
    expect(cameraZoom([{ id: 'w', type: 'group', layers: [cam] } as unknown as Layer])).toBe(0.5);
    expect(cameraZoom([bg])).toBeNull();
  });

  it('names shots that never hold still, and framings that repeat', () => {
    const shots = [
      shot({ shot: 'a', still_ms: 300, framing_px: 2000 }), shot({ shot: 'b', framing_px: 2010 }),
      shot({ shot: 'c', framing_px: 1990 }), shot({ shot: 'd', framing_px: 900 }),
    ];
    const n = timeNotes(shots, 1920);
    expect(n[0]).toContain('"a" 300 ms');
    expect(n[1]).toMatch(/^3 of 4 shots are framed at the same size/);
  });

  it('varied framings are not flagged', () => {
    const shots = [900, 1500, 2600, 3400].map((f, i) => shot({ shot: `s${i}`, framing_px: f }));
    expect(timeNotes(shots, 1920)).toEqual([]);
  });
});

describe('reviewMotionPage (rendered)', () => {
  const spec = (layers: Layer[], markers?: Record<string, number>): DesignSpec =>
    ({ meta: { name: 't', version: '1' }, document: { width: 1920, height: 1080, unit: 'px' }, layers, ...(markers ? { markers } : {}) }) as unknown as DesignSpec;

  it('measures each shot where it rests, not as authored', () => {
    // As authored the card is on the left; by shot "right" it has moved to the right.
    const card = box('card', 100, 300, 600, 480, { animation: move(2000, 800, { x: 0 }, { x: 1100 }) });
    const s = spec([bg, card], { left: 0, right: 2000 });
    const m = reviewMotionPage(s, undefined, s.layers ?? [], '/tmp');
    expect(m?.shots.map(x => x.shot)).toEqual(['left', 'right']);
    expect(m?.shots[0]?.balance?.x ?? 0).toBeLessThan(-0.1);
    expect(m?.shots[1]?.balance?.x ?? 0).toBeGreaterThan(0.1);
  }, 30_000);

  it('a still page gets no motion block', () => {
    const s = spec([bg, box('card', 100, 100, 400, 400)]);
    expect(reviewMotionPage(s, undefined, s.layers ?? [], '/tmp')).toBeNull();
    expect(withMotion(reviewLayout(s, '/tmp'), s, '/tmp')[0]).not.toHaveProperty('motion');
  }, 30_000);
});
