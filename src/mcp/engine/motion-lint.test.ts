import { describe, it, expect } from 'vitest';
import type { Layer } from '../../schema/types';
import { lintComposition } from './motion-lint';

const text = (id: string, x: number, y: number, value: string, extra: object = {}): Layer =>
  ({ id, type: 'text', z: 2, x, y, width: 600, height: 80, content: { type: 'plain', value }, style: { font_size: 60 }, ...extra } as unknown as Layer);
const move = (delay: number, dur: number, from: Record<string, number>, to: Record<string, number>): object =>
  ({ keyframes: [{ t: 0, ...from }, { t: dur, ...to }], playback: { duration: dur, delay, origin: 'offset', easing: 'linear' } });
const canvas = { width: 1920, height: 1080 };
const kinds = (notes: Array<{ kind: string }>): string[] => notes.map(n => n.kind);

describe('lintComposition', () => {
  it('reads a shot where it rests, not while the camera is already leaving for the next one', () => {
    // A camera pans away over the last 900 ms of "left"; the text rests in frame before that.
    const cam = { id: '__camera', type: 'group', z: 1, x: 0, y: 0, width: 3840, height: 1080,
      animation: { keyframes: [{ t: 0, x: 0 }, { t: 7600, x: 0 }, { t: 8500, x: -1920 }], playback: { duration: 8500, origin: 'offset', easing: 'linear' } },
      layers: [text('hello', 200, 400, 'Hello there')] } as unknown as Layer;
    const notes = lintComposition([cam], canvas, [{ id: 'left', at: 0 }, { id: 'right', at: 8500 }], 11000);
    expect(notes.filter(n => n.kind === 'off_canvas')).toEqual([]);   // left behind in "right" is where the camera left it
  });

  it('flags text cut by the frame edge, and text that appears where no one can see it', () => {
    const cut = text('cut', 1600, 100, 'Half out of frame');
    const lost = text('lost', 2400, 100, 'Never seen', { animation: move(1000, 400, { opacity: 0 }, { opacity: 1 }) });
    const notes = lintComposition([cut, lost], canvas, [{ id: 'a', at: 0 }, { id: 'b', at: 1000 }], 4000);
    expect(notes.filter(n => n.kind === 'off_canvas').map(n => n.layers?.[0])).toEqual(['cut', 'lost']);
  });

  it('counts a stagger of the same move as one gesture, and a link follower not at all', () => {
    const rise = (id: string, delay: number): Layer => text(id, 100, 100 + delay, id, { animation: move(delay, 700, { y: 40, opacity: 0 }, { y: 0, opacity: 1 }) });
    const cards = [rise('c1', 0), rise('c2', 120), rise('c3', 240), rise('c4', 360), rise('c5', 480)];
    const follower = { id: 'f_link', type: 'group', z: 1, link: { to: 'c1', lag: 90 }, layers: [text('f', 900, 900, 'x')] } as unknown as Layer;
    expect(kinds(lintComposition([...cards, follower], canvas, [], 3000))).not.toContain('busy');
    const mixed = [0, 1, 2, 3, 4].map(i => text(`m${i}`, 100, 100 + i * 100, `m${i}`, { animation: move(0, 700, { x: 10 * (i + 1) }, { x: 0 }) }));
    expect(kinds(lintComposition(mixed, canvas, [], 3000))).toContain('busy');
  });

  it('lets a shot hold still for its reading time, and flags a hold much longer than that', () => {
    const words = 'one two three four five six seven eight';   // 8 words ≈ 2000 ms at 240 wpm
    const a = text('a', 100, 100, words, { animation: move(0, 500, { opacity: 0 }, { opacity: 1 }) });
    const b = text('b', 100, 400, 'next', { animation: move(3000, 500, { opacity: 0 }, { opacity: 1 }) });
    expect(kinds(lintComposition([a, b], canvas, [{ id: 's1', at: 0 }, { id: 's2', at: 3000 }], 5000))).not.toContain('idle');
    const late = text('b', 100, 400, 'next', { animation: move(7000, 500, { opacity: 0 }, { opacity: 1 }) });
    expect(kinds(lintComposition([a, late], canvas, [{ id: 's1', at: 0 }, { id: 's2', at: 7000 }], 9000))).toContain('idle');
  });

  it('flags text resting on text and a shot too short to read', () => {
    const one = text('one', 100, 100, 'Read this whole sentence before it goes away please');
    const two = text('two', 110, 110, 'Overlap');
    const notes = lintComposition([one, two], canvas, [{ id: 's1', at: 0 }, { id: 's2', at: 800 }], 1600);
    expect(kinds(notes)).toEqual(expect.arrayContaining(['overlap', 'reading']));
  });
});
