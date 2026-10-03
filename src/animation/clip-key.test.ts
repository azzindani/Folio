import { describe, it, expect } from 'vitest';
import type { Layer } from '../schema/types';
import { keyOf, keyAlphaRow, keyFilter, keySvgPrimitive, readKey, type ClipKey } from './clip-key';
import { colorSvgFilter } from './clip-color';

const clip = (key: unknown): Layer => ({ id: 'k', type: 'video', video: { key } }) as unknown as Layer;
const GREEN: ClipKey = { color: '#00ff00', similarity: 0.4, blend: 0.1 };
const alpha = (row: number[], rgb: number[]): number =>
  Math.max(0, Math.min(1, (row[0] ?? 0) * (rgb[0] ?? 0) + (row[1] ?? 0) * (rgb[1] ?? 0) + (row[2] ?? 0) * (rgb[2] ?? 0) + (row[3] ?? 0)));

/** What the ffmpeg filter computes, read back from its own numbers: 16-bit score (swscale's white), then the alpha lookup. */
function ffmpegAlpha(filter: string, rgb8: number[]): number {
  const num = (name: string): number => Number(new RegExp(`${name}=(-?[0-9.]+)`).exec(filter)?.[1]);
  const [ar, ag, ab, aa] = ['ar', 'ag', 'ab', 'aa'].map(num);
  const lut = /val\*(-?[0-9.]+)\+(-?[0-9.]+)/.exec(filter);
  const rgb16 = rgb8.map(v => v * 256 + (v === 255 ? 3 : 0));
  const t = Math.round((ar ?? 0) * (rgb16[0] ?? 0) + (ag ?? 0) * (rgb16[1] ?? 0) + (ab ?? 0) * (rgb16[2] ?? 0) + (aa ?? 0) * 65535);
  return Math.max(0, Math.min(65535, t * Number(lut?.[1]) + Number(lut?.[2]))) / 65535;
}

describe('a green screen key', () => {
  it('reads the colour, fills and clamps the rest; a grey or bad colour is no key', () => {
    expect(keyOf(clip({ color: '#00ff00' }))).toEqual(GREEN);
    expect(keyOf(clip({ color: '#0000ff', similarity: 3, blend: -1 }))).toEqual({ color: '#0000ff', similarity: 1, blend: 0 });
    expect(keyOf(clip({ color: '#808080' }))).toBeNull();
    expect(keyOf(clip({ color: 'green' }))).toBeNull();
    expect(keyOf(clip(undefined))).toBeNull();
  });

  it('the screen goes clear, skin, white and black stay, the edge falls along the line', () => {
    const row = keyAlphaRow(GREEN) ?? [];
    expect(alpha(row, [0, 1, 0])).toBe(0);
    expect(alpha(row, [0, 0.7, 0])).toBe(0);
    for (const keep of [[0.9, 0.7, 0.6], [1, 1, 1], [0, 0, 0], [1, 0, 0]]) expect(alpha(row, keep)).toBe(1);
    // Score of (0.2, 0.75, 0.2) is 0.55: halfway through the soft edge 0.5–0.6.
    expect(alpha(row, [0.2, 0.75, 0.2])).toBeCloseTo(0.5, 6);
  });

  it('a wider similarity takes out more; the key colour itself always goes', () => {
    const tight = keyAlphaRow({ color: '#3a9d4a', similarity: 0.1, blend: 0.05 }) ?? [];
    const wide = keyAlphaRow({ color: '#3a9d4a', similarity: 0.6, blend: 0.05 }) ?? [];
    const screen = [0x3a / 255, 0x9d / 255, 0x4a / 255], shadow = screen.map(v => v * 0.6);
    expect(alpha(tight, screen)).toBe(0);
    expect(alpha(wide, screen)).toBe(0);
    expect(alpha(tight, shadow)).toBeGreaterThan(alpha(wide, shadow));
  });

  it('the ffmpeg filter and the SVG primitive run the same line', () => {
    const f = keyFilter(GREEN), row = keyAlphaRow(GREEN) ?? [];
    expect(f).toMatch(/^format=rgba64le,colorchannelmixer=ar=.*:aa=0\.5,lut=a='val\*.+',format=rgba$/);
    // Every gain inside colorchannelmixer's ±2.
    for (const m of f.matchAll(/a[rgb]=(-?[0-9.]+)/g)) expect(Math.abs(Number(m[1]))).toBeLessThanOrEqual(2);
    for (const rgb of [[0, 255, 0], [51, 191, 51], [46, 184, 46], [229, 179, 153], [255, 255, 255], [56, 192, 56]]) {
      expect(Math.abs(ffmpegAlpha(f, rgb) - alpha(row, rgb.map(v => v / 255)))).toBeLessThan(1.5 / 255);
    }
    const prim = keySvgPrimitive(GREEN);
    expect(prim).toBe(`<feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 ${row.map(v => +v.toFixed(5)).join(' ')} 0"/>`);
  });

  it('in the editor the key runs before the grade, alone when there is no grade', () => {
    const prim = keySvgPrimitive(GREEN);
    expect(colorSvgFilter('f', null, prim)).toBe(`<filter id="f" color-interpolation-filters="sRGB">${prim}</filter>`);
    const both = colorSvgFilter('f', { contrast: 0.2 }, prim);
    expect(both.indexOf(prim)).toBeLessThan(both.indexOf('feComponentTransfer'));
    expect(colorSvgFilter('f', null)).toBe('');
  });

  it('op:video checks the colour and the ranges; null clears', () => {
    expect(readKey(null)).toBeNull();
    expect(readKey('green')).toContain('{color');
    expect(readKey({ color: 'lime' })).toContain('#rrggbb');
    expect(readKey({ color: '#00ff00', similarity: 2 })).toContain('similarity must be 0–1');
    expect(readKey({ color: '#777777' })).toContain('grey');
    expect(readKey({ color: '#00b140', blend: 0.2 })).toEqual({ color: '#00b140', similarity: 0.4, blend: 0.2 });
  });
});
