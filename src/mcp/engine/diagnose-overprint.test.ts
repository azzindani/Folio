// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { Layer } from '../../schema/types';
import { overprintFindings } from './diagnose-overprint';

const W = 1080, H = 1920;
// Benchmark r6, b22: a 300 px "30%" with a candle set so its flame's tip runs into the "%".
const pct = { id: 'pct', type: 'text', z: 3, x: 84, y: 700, width: 800, height: 330, content: { type: 'plain', value: '30%' },
  style: { font_family: 'Archivo', font_size: 300, font_weight: 900, color: '#C5501E', letter_spacing: -10 } };
const flameD = (dy: number): string => `M760 ${1060 + dy}C792 ${1106 + dy} 804 ${1140 + dy} 760 ${1176 + dy}C716 ${1140 + dy} 728 ${1106 + dy} 760 ${1060 + dy}Z`;
const candle = (dy: number, flame: object = {}): object => ({
  id: 'candle', type: 'group', z: 2, x: 480, y: 990 + dy, width: 540, height: 560, layers: [
    { id: 'glow', type: 'ellipse', z: 0, x: 500, y: 990 + dy, width: 520, height: 520, fill: '#F6D3A6', opacity: 0.75, effects: { blur: 24 } },
    { id: 'jar', type: 'rect', z: 1, x: 640, y: 1210 + dy, width: 240, height: 300, radius: 36, fill: '#E6D2B8' },
    { id: 'flame', type: 'path', z: 4, d: flameD(dy), fill: '#E8892B', ...flame },
  ],
});
const find = (layers: object[]): ReturnType<typeof overprintFindings> => overprintFindings(layers as Layer[], W, H);

describe('overprintFindings', () => {
  it('catches a flame whose tip runs into the "%", and moves the whole candle clear', () => {
    const [f, ...rest] = find([pct, candle(-110)]);
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ code: 'overprint', layer_id: 'pct', layers: ['pct', 'candle'] });
    expect(f?.message).toMatch(/"flame" \(part of "candle"\)/);
    const move = f?.call?.params as { op: string; layer_id: string; dx: number; dy: number };
    expect(move).toMatchObject({ op: 'move', layer_id: 'candle', dx: 0 });
    expect(move.dy).toBeGreaterThan(0);
    expect(find([pct, candle(-110 + move.dy)])).toEqual([]);
  });

  it('leaves the candle where it clears the letters', () => {
    expect(find([pct, candle(0)])).toEqual([]);
  });

  it('leaves a flame that flickers — motion is judged where its shots rest', () => {
    expect(find([pct, candle(-110, { animation: { keyframes: [{ t: 0, scale: 1 }, { t: 400, scale: 1.1 }], playback: { duration: 400, loop: true } } })])).toEqual([]);
  });

  it('leaves outlines, lines, glows and a highlight set under the words', () => {
    const word = { ...pct, id: 'word', content: { type: 'plain', value: 'PLANET' }, style: { ...pct.style, font_size: 160 } };
    const ring = { id: 'ring', type: 'ellipse', z: 4, x: 300, y: 640, width: 300, height: 180, fill: 'none', stroke: { color: '#111', width: 8 } };
    const rule = { id: 'rule', type: 'rect', z: 4, x: 60, y: 790, width: 400, height: 4, fill: '#111' };
    const mark = { id: 'mark', type: 'rect', z: 1, x: 90, y: 800, width: 300, height: 80, fill: '#F7C45A' };
    expect(find([word, ring, rule, mark])).toEqual([]);
    // The same block painted OVER the letters hides part of them.
    expect(find([word, { ...mark, z: 5 }]).map(f => f.layers)).toEqual([['word', 'mark']]);
  });

  it('leaves the empty corner a short last line leaves, and a component\'s own parts', () => {
    const head = { id: 'head', type: 'text', z: 6, x: 48, y: 104, width: 780, height: 240, content: { type: 'plain', value: 'Kids Code\nClub' },
      style: { font_family: 'Bungee', font_size: 112, line_height: 0.98 } };
    const sticker = { id: 'sticker', type: 'ellipse', z: 7, x: 640, y: 244, width: 180, height: 180, fill: '#2EC4B6' };
    expect(find([head, sticker])).toEqual([]);
    const dot = { id: 'dot', type: 'ellipse', z: 4, x: 730, y: 850, width: 80, height: 80, fill: '#111' };
    expect(find([pct, dot]).map(f => f.layers)).toEqual([['pct', 'dot']]);
    expect(find([{ id: 'badge', type: 'group', z: 3, x: 84, y: 600, width: 800, height: 600, layers: [pct, dot] }])).toEqual([]);
  });
});
