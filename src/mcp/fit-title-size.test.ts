import { describe, it, expect } from 'vitest';
import { fitTitleSize, fontCharFactor } from './shorthand-helpers';

// suite-002 (Orbitron) + suite-011 (Audiowide): the event preset hard-picked a
// 137px title and a long all-caps word ("SOURDOUGH" / "MIDSUMMER") bled off the
// right edge because fitTitleSize used the 0.54 average char width for these
// very wide display faces. They now get heavier factors so the title shrinks.
describe('fontCharFactor — wide display faces', () => {
  it('default sans stays at 0.54', () => {
    expect(fontCharFactor('Manrope')).toBe(0.54);
    expect(fontCharFactor('Playfair Display')).toBe(0.54);
  });
  it('condensed faces stay narrow', () => {
    expect(fontCharFactor('Anton')).toBe(0.42);
  });
  it('wide geometric faces are heavier than default', () => {
    expect(fontCharFactor('Orbitron')).toBe(0.70);
  });
  it('extra-wide faces are heaviest', () => {
    expect(fontCharFactor('Audiowide')).toBe(0.82);
  });
});

describe('fitTitleSize — wide fonts shrink so the longest word fits', () => {
  const W = 1080, cW = 908, base = Math.round(W * 0.15); // 162, the event preset's base

  it('shrinks an Orbitron caps title enough that SOURDOUGH fits the 908 box', () => {
    const ts = fitTitleSize('SOLD OUT OF SOURDOUGH (AGAIN)', base, cW, 'Orbitron', true);
    expect(ts).toBeLessThan(137); // was 137 and clipped
    // longest word width at the chosen size must clear the 97% safety target
    const w = 'SOURDOUGH'.length * ts * fontCharFactor('Orbitron') * 1.32;
    expect(w).toBeLessThanOrEqual(cW * 0.97 + 1);
  });

  it('shrinks an Audiowide caps title harder (it is the widest face)', () => {
    const tsAudio = fitTitleSize("A MIDSUMMER NIGHT'S DREAM", base, cW, 'Audiowide', true);
    const tsManrope = fitTitleSize("A MIDSUMMER NIGHT'S DREAM", base, cW, 'Manrope', true);
    expect(tsAudio).toBeLessThan(tsManrope); // wider face → smaller size
    const w = 'MIDSUMMER'.length * tsAudio * fontCharFactor('Audiowide') * 1.32;
    expect(w).toBeLessThanOrEqual(cW * 0.97 + 1);
  });

  it('leaves a short title at base size', () => {
    expect(fitTitleSize('VOTE', base, cW, 'Orbitron', true)).toBe(base);
  });
});
