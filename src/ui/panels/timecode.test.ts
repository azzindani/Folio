import { describe, it, expect } from 'vitest';
import { fmtMs } from './timeline-panel';

/**
 * The timecode readout, driven by requestAnimationFrame.
 *
 * It was only ever fed whole milliseconds from the scrub slider. The moment
 * the player drove it, rAF handed over fractional times and the readout
 * printed "0.163.799999976s" — two decimal points and thirteen digits, wide
 * enough to push the rest of the timeline toolbar out of the panel. Caught in
 * a screenshot of the deployed editor, not by a test.
 */

describe('fmtMs', () => {
  it('rounds the fractional times playback actually produces', () => {
    expect(fmtMs(163.799999976)).toBe('0.164s');
    expect(fmtMs(1000.4)).toBe('1.000s');
    expect(fmtMs(999.6)).toBe('1.000s');
  });

  it('is always s.mmm — one point, three digits', () => {
    for (const ms of [0, 7, 83.33333, 250, 999, 1000, 1500.5, 61999.9]) {
      expect(fmtMs(ms), String(ms)).toMatch(/^\d+\.\d{3}s$/);
    }
  });

  it('still formats the whole milliseconds it always did', () => {
    expect(fmtMs(0)).toBe('0.000s');
    expect(fmtMs(1)).toBe('0.001s');
    expect(fmtMs(2500)).toBe('2.500s');
    expect(fmtMs(60000)).toBe('60.000s');
  });

  it('does not print junk for junk', () => {
    expect(fmtMs(NaN)).toBe('0.000s');
    expect(fmtMs(-5)).toBe('0.000s');
    expect(fmtMs(Infinity)).toBe('0.000s');
  });
});
