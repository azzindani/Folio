import { describe, it, expect } from 'vitest';
import { checkCanvasScale, MAX_CANVAS_DIM } from './canvas-limit';

describe('checkCanvasScale', () => {
  it('accepts a small document at any sensible scale', () => {
    const r = checkCanvasScale(1080, 1080, 4);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('');
    expect(r.width).toBe(4320);
    expect(r.height).toBe(4320);
  });

  it('rejects when width exceeds the canvas limit', () => {
    // 4000 × 5 = 20000 > 16384
    const r = checkCanvasScale(4000, 1000, 5);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exceeds browser canvas limit/);
  });

  it('rejects when height exceeds the canvas limit', () => {
    // 1000 × 20 = 20000 > 16384
    const r = checkCanvasScale(500, 1000, 20);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/height/);
  });

  it('accepts exactly at the canvas limit', () => {
    const r = checkCanvasScale(MAX_CANVAS_DIM, MAX_CANVAS_DIM, 1);
    expect(r.ok).toBe(true);
  });

  it('rejects one pixel over the canvas limit', () => {
    const r = checkCanvasScale(MAX_CANVAS_DIM + 1, 100, 1);
    expect(r.ok).toBe(false);
  });

  it('reports the largest safe scale for the document', () => {
    // 2000-wide doc → max scale = floor(16384/2000 * 100)/100 = 8.19
    const r = checkCanvasScale(2000, 1000, 100);
    expect(r.maxScale).toBeCloseTo(8.19, 2);
    expect(r.maxScale * 2000).toBeLessThanOrEqual(MAX_CANVAS_DIM);
  });

  it('error message includes the suggested max scale', () => {
    const r = checkCanvasScale(2000, 1000, 100);
    expect(r.reason).toContain('×8.19');
  });

  it('error message suggests SVG as an alternative', () => {
    const r = checkCanvasScale(5000, 5000, 10);
    expect(r.reason).toContain('SVG');
  });

  it('ceils fractional dimensions to whole pixels', () => {
    const r = checkCanvasScale(100, 100, 1.5);
    expect(r.width).toBe(150);
    expect(r.height).toBe(150);
  });
});
