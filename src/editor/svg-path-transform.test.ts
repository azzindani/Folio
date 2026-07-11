import { describe, it, expect } from 'vitest';
import { transformPathD, type Matrix } from './svg-path-transform';

describe('transformPathD', () => {
  it('translates absolute M/L', () => {
    const t: Matrix = [1, 0, 0, 1, 10, 20];
    expect(transformPathD('M0 0L5 5Z', t)).toBe('M10 20L15 25Z');
  });
  it('scales cubic control points', () => {
    const s: Matrix = [2, 0, 0, 2, 0, 0];
    expect(transformPathD('M1 1C2 2 3 3 4 4', s)).toBe('M2 2C4 4 6 6 8 8');
  });
  it('converts H/V to line commands (correct under rotation)', () => {
    const t: Matrix = [1, 0, 0, 1, 5, 5];
    expect(transformPathD('M0 0H10', t)).toBe('M5 5L15 5');
    expect(transformPathD('M0 0V10', t)).toBe('M5 5L5 15');
  });
  it('scales arc radii and offsets the x-axis rotation', () => {
    const s: Matrix = [2, 0, 0, 3, 0, 0];
    const out = transformPathD('M0 0A5 5 0 0 1 10 10', s);
    expect(out).toContain('A10 15 0 0 1');
    expect(out).toContain('20 30');
  });
  it('keeps relative commands relative (delta-transformed)', () => {
    const t: Matrix = [1, 0, 0, 1, 100, 100];   // translation must NOT affect deltas
    expect(transformPathD('M0 0l5 5', t)).toBe('M100 100l5 5');
  });
});
