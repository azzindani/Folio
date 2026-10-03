import { describe, it, expect } from 'vitest';
import type { Layer } from '../schema/types';
import { colorOf, colorMatrix, contrastLine, colorFilter, colorSvgFilter, readColor } from './clip-color';

const clip = (color: unknown): Layer => ({ id: 'c', type: 'video', video: { color } }) as unknown as Layer;

describe('a clip grade', () => {
  it('reads only what changes, clamped to its range', () => {
    expect(colorOf(clip({ exposure: 0, contrast: 0 }))).toBeNull();
    expect(colorOf(clip({ exposure: 9, tint: -0.5, lut: ' assets/docs/a.cube ' }))).toEqual({ exposure: 3, tint: -0.5, lut: 'assets/docs/a.cube' });
  });
  it('no grade is the identity; saturation -1 is grey; exposure +1 doubles; contrast pivots on mid grey', () => {
    expect(colorMatrix({})).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const grey = colorMatrix({ saturation: -1 });
    expect(grey[0]?.map(v => +v.toFixed(4))).toEqual([0.2126, 0.7152, 0.0722]);
    expect(colorMatrix({ exposure: 1 })[1]?.[1]).toBe(2);
    expect(contrastLine({ contrast: 0.5 })).toEqual({ slope: 1.5, intercept: -0.25 });
  });
  it('warm pushes red up and blue down; tint + takes green out (magenta)', () => {
    const warm = colorMatrix({ temperature: 1 });
    expect([warm[0]?.[0], warm[2]?.[2]]).toEqual([1.25, 0.75]);
    expect(colorMatrix({ tint: 1 })[1]?.[1]).toBeCloseTo(0.8, 6);
  });
  it('as ffmpeg filters and as an SVG filter — the same numbers', () => {
    const f = colorFilter({ contrast: 0.2, temperature: 0.4 }, '/x/look.cube');
    expect(f).toContain('colorchannelmixer=rr=1.1:');
    expect(f).toContain("lutrgb=r='val*1.2-25.5'");
    expect(f).toContain("lut3d=file='/x/look.cube'");
    const svg = colorSvgFilter('g', { contrast: 0.2, temperature: 0.4 });
    expect(svg).toContain('color-interpolation-filters="sRGB"');
    expect(svg).toContain('values="1.1 0 0 0 0');
    expect(svg).toContain('slope="1.2" intercept="-0.1"');
  });
  it('op:video checks ranges, names and the LUT kind; null clears', () => {
    expect(readColor(null)).toBeNull();
    expect(readColor({ exposure: 4 })).toContain('-3–3');
    expect(readColor({ glow: 1 })).toContain('no glow');
    expect(readColor({ lut: 'assets/images/a.png' })).toContain('.cube');
    expect(readColor({ saturation: -0.3 })).toEqual({ saturation: -0.3 });
  });
});
