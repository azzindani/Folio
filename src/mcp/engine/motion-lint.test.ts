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
    // Siblings sliding different distances onto one margin, or fading together, are one gesture each.
    const settle = [0, 1, 2, 3, 4].map(i => text(`s${i}`, 100, 100 + i * 100, `s${i}`, { animation: move(0, 700, { x: 10 * (i + 1) }, { x: 0 }) }));
    const fades = [0, 1, 2, 3, 4].map(i => ({ id: `g${i}`, type: 'group', z: 1, layers: [text(`f${i}`, 900, 100 + i * 100, 'x', { animation: move(0, 400, { opacity: 1 }, { opacity: 0 }) })] } as unknown as Layer));
    expect(kinds(lintComposition([...settle, ...fades], canvas, [], 3000))).not.toContain('busy');
    // Five different moves at once are five things to follow.
    const moves: Array<Record<string, number>> = [{ x: 60 }, { y: 60 }, { scale: 0.5 }, { rotation: 30 }, { x: 40, y: 40 }];
    const mixed = moves.map((from, i) => text(`m${i}`, 100, 100 + i * 100, `m${i}`, { animation: move(0, 700, from, Object.fromEntries(Object.keys(from).map(k => [k, k === 'scale' ? 1 : 0]))) }));
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

  it('reads a short line in a wide box at its font size — the box is the ink, not the scale', () => {
    // 36 px on a 1080 px frame is well above a glance (27 px); drawn 150 px wide in a 1600 px box.
    const short = text('short', 100, 400, 'Read me now please', { width: 1600, style: { font_size: 36 }, animation: move(0, 400, { opacity: 0 }, { opacity: 1 }) });
    expect(kinds(lintComposition([short], canvas, [{ id: 's1', at: 0 }], 700))).toContain('reading');
  });

  // Found live: chips flew into a card declared after them; the card painted over every one.
  it('flags text a shot moves under an opaque layer, and leaves a scrim laid over a settled scene alone', () => {
    const chip = { id: 'chip', type: 'group', z: 2, x: 100, y: 100, width: 200, height: 60,
      animation: move(1000, 500, { x: 0, y: 0 }, { x: 800, y: 0 }),
      layers: [text('chip_t', 100, 100, 'order_id', { width: 200, height: 60 })] } as unknown as Layer;
    const card = { id: 'card', type: 'rect', z: 3, x: 850, y: 50, width: 400, height: 200, fill: { type: 'solid', color: '#DCE4FF' } } as unknown as Layer;
    const buried = lintComposition([chip, card], canvas, [{ id: 'a', at: 0 }, { id: 'b', at: 1000 }], 4000);
    expect(buried.filter(n => n.kind === 'buried').map(n => n.layers)).toEqual([['chip_t', 'card']]);

    const title = text('title', 100, 100, 'Settled headline');
    const scrim = { id: 'scrim', type: 'rect', z: 9, x: 0, y: 0, width: 1920, height: 1080, fill: '#141414',
      animation: move(2000, 500, { opacity: 0 }, { opacity: 1 }) } as unknown as Layer;
    const laid = lintComposition([title, scrim], canvas, [{ id: 'a', at: 0 }, { id: 'close', at: 2000 }], 5000);
    expect(laid.filter(n => n.kind === 'buried')).toEqual([]);
  });

  // Found live on a 57 s continuous piece: each rule below was noise on every shot.
  it('lets a slow camera push-in drift through a rest instead of breaking it', () => {
    const push = { id: '__camera', type: 'group', z: 1, x: 0, y: 0, width: 1920, height: 1080,
      animation: move(0, 4500, { scale: 1 }, { scale: 1.04 }),
      layers: [text('line', 100, 400, 'one two three four five six seven eight')] } as unknown as Layer;
    const notes = lintComposition([push], canvas, [{ id: 's1', at: 0 }, { id: 's2', at: 4500 }], 4500);
    expect(kinds(notes)).not.toContain('reading');
    expect(kinds(notes)).not.toContain('idle');
  });

  it('reads a gentle push as a drift at any depth — scale is a ratio, not a distance', () => {
    // A 2.5% push held over 3.3 s, deep in a zoom: absolute scale moves 0.23, the eye reads through it.
    const deep = { id: '__camera', type: 'group', z: 1, x: 0, y: 0, width: 1920, height: 1080,
      animation: move(0, 3300, { scale: 9.275 }, { scale: 9.505 }),
      layers: [text('deep', 100, 400, 'one two three four five six')] } as unknown as Layer;
    expect(kinds(lintComposition([deep], canvas, [{ id: 'd1', at: 0 }], 3300))).not.toContain('reading');
  });

  it('reads headlines, not data texture, and keeps words readable through shots that add none', () => {
    const cells = [0, 1, 2, 3, 4, 5].map(i => text(`cell${i}`, 100, 600 + i * 30, 'north 2024 12,400 units shipped by road', { style: { font_size: 14 }, height: 20 }));
    const head = text('head', 100, 100, 'one two three four five six seven eight', { animation: move(0, 300, { opacity: 0 }, { opacity: 1 }) });
    const marks = [{ id: 'say', at: 0 }, { id: 'look', at: 900 }, { id: 'next', at: 2600 }];
    const nxt = text('nxt', 100, 300, 'next', { animation: move(2600, 300, { opacity: 0 }, { opacity: 1 }) });
    expect(kinds(lintComposition([head, ...cells, nxt], canvas, marks, 5000))).not.toContain('reading');
  });

  it('times reading from when the words land, not from the last ornament to arrive', () => {
    const line = text('line', 100, 100, 'one two three four five six seven eight', { animation: move(0, 400, { opacity: 0 }, { opacity: 1 }) });
    const chips = [0, 1, 2, 3].map(i => text(`chip${i}`, 100 + i * 200, 700, 'x', { style: { font_size: 20 }, width: 150, height: 30,
      animation: move(600 + i * 400, 300, { opacity: 0 }, { opacity: 1 }) }));
    const later = text('later', 100, 400, 'next', { animation: move(2600, 300, { opacity: 0 }, { opacity: 1 }) });
    expect(kinds(lintComposition([line, ...chips, later], canvas, [{ id: 's1', at: 0 }, { id: 's2', at: 2600 }], 5000))).not.toContain('reading');
  });

  it('reads a build line by line as it lands, and blames only the line a cut takes away', () => {
    // Four 4-word lines, one a second: read as they build, never all "from the last one".
    const build = [0, 1, 2, 3].map(i => text(`b${i}`, 100, 100 + i * 120, 'one two three four', { animation: move(i * 1000, 300, { opacity: 0 }, { opacity: 1 }) }));
    const marks = [{ id: 'build', at: 0 }, { id: 'more', at: 2000 }];
    expect(kinds(lintComposition(build, canvas, marks, 5000))).not.toContain('reading');

    const long = text('long', 100, 100, Array(20).fill('word').join(' '), { animation: move(1000, 300, { opacity: 1 }, { opacity: 0 }) });
    const next = text('next', 100, 400, 'short answer', { animation: move(1300, 300, { opacity: 0 }, { opacity: 1 }) });
    const cut = lintComposition([long, next], canvas, [{ id: 'ask', at: 0 }, { id: 'answer', at: 1300 }], 5000);
    expect(cut.filter(n => n.kind === 'reading').map(n => [n.shot, n.layers])).toEqual([['ask', ['long']]]);
  });

  // Found live on a piece that dives with a tilt: axis-aligned boxes grow when the camera turns.
  it('judges overlap under a tilted camera by where things sit, not by their turned boxes', () => {
    const stack = { id: '__camera', type: 'group', z: 1, x: 0, y: 0, width: 1920, height: 1080,
      animation: move(0, 2000, { rotation: 0 }, { rotation: 3 }),
      layers: [text('l1', 100, 100, 'First line here', { width: 1400, height: 96 }), text('l2', 100, 210, 'Second line here', { width: 1400, height: 96 })] } as unknown as Layer;
    expect(kinds(lintComposition([stack], canvas, [{ id: 'a', at: 0 }], 2000))).not.toContain('overlap');
  });

  // benchmark r1: two pairs set tight on a 9:16 reel read as overlapping — the
  // big line's box reserved a descender band its caps and digits never use.
  it('does not call caps or digits set tight on the line below an overlap', () => {
    const st = (font_size: number, line_height: number, extra: object = {}): object => ({ style: { font_family: 'Archivo', font_weight: 900, font_size, line_height, ...extra } });
    const num = text('num', 70, 300, '24', { width: 620, height: 400, ...st(400, 1, { letter_spacing: -12 }) });
    const h2 = text('h2', 80, 720, 'HOURS\nICE COLD.', { width: 600, height: 210, ...st(104, 0.95) });
    const mark = text('mark', 40, 930, 'DRIFT', { width: 1000, height: 300, ...st(290, 1, { align: 'center' }) });
    const url = text('url', 40, 1250, 'drift.co', { width: 1000, height: 80, style: { font_family: 'Inter', font_weight: 700, font_size: 64, align: 'center' } });
    const reel = { width: 1080, height: 1920 };
    expect(kinds(lintComposition([num, h2], reel, [{ id: 'cold', at: 0 }], 3000))).not.toContain('overlap');
    expect(kinds(lintComposition([mark, url], reel, [{ id: 'brand', at: 0 }], 3000))).not.toContain('overlap');
    // a line that really descends into the next is still one
    const low = text('low', 80, 1000, 'gyp', { width: 600, height: 120, ...st(120, 1) });
    const under = text('under', 80, 1100, 'NEXT', { width: 600, height: 120, ...st(120, 1) });
    expect(kinds(lintComposition([low, under], reel, [{ id: 's', at: 0 }], 3000))).toContain('overlap');
  });

  it('does not see text a scrim or a clip hides, nor scenery the camera has yet to reach', () => {
    const a = text('a', 100, 100, 'under the scrim'), b = text('b', 110, 110, 'also under it');
    const scrim = { id: 'scrim', type: 'rect', z: 9, x: 0, y: 0, width: 1920, height: 1080, fill: '#141414' } as unknown as Layer;
    expect(kinds(lintComposition([a, b, scrim], canvas, [{ id: 's', at: 0 }], 3000))).not.toContain('overlap');
    const sheet = { id: 'sheet', type: 'group', z: 2, clip: true, x: 100, y: 100, width: 600, height: 100,
      layers: [text('hdr', 100, 100, 'Header'), text('row', 100, 300, 'Hidden row')] } as unknown as Layer;
    const over = text('over', 100, 290, 'Caption over the hidden row');
    expect(kinds(lintComposition([sheet, over], canvas, [{ id: 's', at: 0 }], 3000))).not.toContain('overlap');
    const later = text('later', 2400, 100, 'Zone two', { style: { font_size: 60 } });
    expect(kinds(lintComposition([later], canvas, [{ id: 'a', at: 0 }, { id: 'b', at: 1000 }], 3000))).not.toContain('off_canvas');
  });
});
