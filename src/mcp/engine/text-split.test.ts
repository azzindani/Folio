import { describe, it, expect } from 'vitest';
import { splitLayer } from './text-split';
import { metricsForFamily } from '../../utils/font-metrics';
import { fontsDir } from './fonts';
import type { Layer } from '../../schema/types';

const JAKARTA = metricsForFamily('Plus Jakarta Sans', [fontsDir()]);
const text = (value: string, extra: Record<string, unknown> = {}, style: Record<string, unknown> = {}): Layer =>
  ({ id: 'head', type: 'text', x: 100, y: 50, width: 600, content: { type: 'plain', value },
    style: { font_size: 40, font_family: 'Plus Jakarta Sans', ...style }, ...extra }) as unknown as Layer;

describe('splitLayer', () => {
  it('places each visible character by measured advance, from the box edge', () => {
    const { units, exact } = splitLayer(text('Hi there'), 'char', JAKARTA);
    expect(exact).toBe(true);
    expect(units.map(u => u.text).join('')).toBe('Hithere');
    expect(units[0]?.x).toBe(100);
    const xs = units.map(u => u.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(units[0]?.width).toBeGreaterThan(units[1]?.width ?? 0); // H is wider than i
  });

  it('keeps words whole, and shifts a centred run inward', () => {
    expect(splitLayer(text('Hi there'), 'word', JAKARTA).units.map(u => u.text)).toEqual(['Hi', 'there']);
    expect(splitLayer(text('Hi there', {}, { align: 'center' }), 'word', JAKARTA).units[0]?.x).toBeGreaterThan(150);
  });

  it('splits a wrapped paragraph along the lines the renderer draws, a line-height apart', () => {
    const para = text('one two three four five six seven', { width: 300 });
    const lines = splitLayer(para, 'line', JAKARTA).units;
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every(u => u.x === 100 && u.width === 300)).toBe(true);
    expect(lines[1]?.y).toBeCloseTo((lines[0]?.y ?? 0) + 40 * 1.4, 5);
    expect(lines[0]?.y).toBe(50); // no vertical_align: the first baseline is fontSize below y, as drawn
    const words = splitLayer(para, 'word', JAKARTA).units;
    expect(new Set(words.map(u => u.line)).size).toBe(lines.length);
    expect(words.filter(u => u.line === 1).every(u => u.y === lines[1]?.y)).toBe(true);
  });

  it('says it estimated when the family is not bundled', () => {
    expect(splitLayer(text('Hi', {}, { font_family: 'No Such Family' }), 'char', null).exact).toBe(false);
  });
});
