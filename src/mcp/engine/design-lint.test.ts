import { describe, it, expect } from 'vitest';
import { lintComposition } from './design-lint';
import type { Layer } from '../../schema/types';

const rect = (id: string, z: number, x: number, y: number, w: number, h: number, color: string): Layer =>
  ({ id, type: 'rect', z, x, y, width: w, height: h, fill: { type: 'solid', color } } as unknown as Layer);
const text = (id: string, z: number, x: number, y: number, w: number, h: number, color: string, value = 'Hello'): Layer =>
  ({ id, type: 'text', z, x, y, width: w, height: h, content: { type: 'plain', value }, style: { color, font_family: 'Inter' } } as unknown as Layer);

describe('lintComposition', () => {
  it('flags white-on-white invisible text', () => {
    const notes = lintComposition([rect('bg', 0, 0, 0, 1080, 1080, '#FFFFFF'), text('t', 10, 96, 100, 800, 60, '#FFFFFF')], 1080, 1080);
    expect(notes.some(n => /invisible|contrast/.test(n))).toBe(true);
  });

  it('flags a white label whose pink chip is too small to cover it', () => {
    const notes = lintComposition([
      rect('bg', 0, 0, 0, 1080, 1080, '#FFFFFF'),
      rect('chip', 5, 72, 394, 180, 36, '#FF2E88'),
      text('label', 10, 76, 394, 440, 36, '#FFFFFF'),
    ], 1080, 1080);
    expect(notes.some(n => n.includes('label'))).toBe(true);
  });

  it('passes a clean dark poster (white text on near-black)', () => {
    const notes = lintComposition([rect('bg', 0, 0, 0, 1080, 1350, '#0A0A0A'), text('t', 10, 96, 100, 800, 60, '#FAFAFA')], 1080, 1350);
    expect(notes).toEqual([]);
  });

  it('flags a missing full-canvas background', () => {
    const notes = lintComposition([text('t', 10, 96, 100, 800, 60, '#111111')], 1080, 1080);
    expect(notes.some(n => /background/.test(n))).toBe(true);
  });

  it('flags an off-canvas layer', () => {
    const notes = lintComposition([rect('bg', 0, 0, 0, 1080, 1080, '#0A0A0A'), rect('x', 5, 1000, 100, 400, 100, '#FF2E88')], 1080, 1080);
    expect(notes.some(n => /outside the/.test(n))).toBe(true);
  });

  it('does not flag text correctly sitting on a contrasting chip', () => {
    const notes = lintComposition([
      rect('bg', 0, 0, 0, 1080, 1080, '#0A0A0A'),
      rect('chip', 5, 80, 80, 400, 80, '#FF2E88'),
      text('label', 10, 96, 100, 360, 40, '#0A0A0A'),
    ], 1080, 1080);
    expect(notes).toEqual([]);
  });
});
