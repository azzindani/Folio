import { describe, it, expect } from 'vitest';
import { interpolateKeyframes } from './keyframe-engine';
import type { Keyframe } from './types';

describe('interpolateKeyframes', () => {
  it('returns empty for empty keyframes', () => {
    const result = interpolateKeyframes([], 500);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('returns single keyframe values at any time', () => {
    const keyframes: Keyframe[] = [{ t: 0, x: 100, y: 200, opacity: 0.5 }];
    const result = interpolateKeyframes(keyframes, 500);
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
    expect(result.opacity).toBe(0.5);
  });

  it('interpolates between two keyframes at midpoint', () => {
    const keyframes: Keyframe[] = [
      { t: 0, x: 0, y: 0 },
      { t: 1000, x: 100, y: 200 },
    ];
    const result = interpolateKeyframes(keyframes, 500, 'linear');
    expect(result.x).toBeCloseTo(50, 0);
    expect(result.y).toBeCloseTo(100, 0);
  });

  it('returns start values at t=0', () => {
    const keyframes: Keyframe[] = [
      { t: 0, x: 0, opacity: 0 },
      { t: 1000, x: 100, opacity: 1 },
    ];
    const result = interpolateKeyframes(keyframes, 0, 'linear');
    expect(result.x).toBeCloseTo(0, 0);
    expect(result.opacity).toBeCloseTo(0, 0);
  });

  it('returns end values at duration', () => {
    const keyframes: Keyframe[] = [
      { t: 0, x: 0, opacity: 0 },
      { t: 1000, x: 100, opacity: 1 },
    ];
    const result = interpolateKeyframes(keyframes, 1000, 'linear');
    expect(result.x).toBeCloseTo(100, 0);
    expect(result.opacity).toBeCloseTo(1, 0);
  });

  it('clamps before first keyframe', () => {
    const keyframes: Keyframe[] = [
      { t: 500, x: 50 },
      { t: 1000, x: 100 },
    ];
    const result = interpolateKeyframes(keyframes, 0, 'linear');
    expect(result.x).toBe(50);
  });

  it('clamps after last keyframe', () => {
    const keyframes: Keyframe[] = [
      { t: 0, x: 0 },
      { t: 1000, x: 100 },
    ];
    const result = interpolateKeyframes(keyframes, 2000, 'linear');
    expect(result.x).toBe(100);
  });

  it('interpolates through 3 keyframes', () => {
    const keyframes: Keyframe[] = [
      { t: 0, x: 0 },
      { t: 1000, x: 100 },
      { t: 2000, x: 0 },
    ];

    const at500 = interpolateKeyframes(keyframes, 500, 'linear');
    expect(at500.x).toBeCloseTo(50, 0);

    const at1500 = interpolateKeyframes(keyframes, 1500, 'linear');
    expect(at1500.x).toBeCloseTo(50, 0);
  });

  it('interpolates colors', () => {
    const keyframes: Keyframe[] = [
      { t: 0, 'fill.color': '#000000' },
      { t: 1000, 'fill.color': '#FFFFFF' },
    ];
    const result = interpolateKeyframes(keyframes, 500, 'linear');
    // Midpoint between black and white should be ~gray
    const val = result['fill.color'] as string;
    expect(val).toMatch(/^#[0-9a-f]{6}$/i);
    // Each channel should be ~128
    const r = parseInt(val.slice(1, 3), 16);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(156);
  });

  it('handles properties present in only one keyframe', () => {
    const keyframes: Keyframe[] = [
      { t: 0, x: 0, opacity: 1 },
      { t: 1000, x: 100 }, // opacity not present
    ];
    const result = interpolateKeyframes(keyframes, 500, 'linear');
    expect(result.x).toBeCloseTo(50, 0);
    expect(result.opacity).toBe(1); // from prev keyframe
  });

  it('uses easing function', () => {
    const keyframes: Keyframe[] = [
      { t: 0, x: 0 },
      { t: 1000, x: 100 },
    ];
    // ease-in should be slower at start
    const linear = interpolateKeyframes(keyframes, 500, 'linear');
    const easeIn = interpolateKeyframes(keyframes, 500, 'ease-in');
    // ease-in at 50% should be < 50 (slower at start)
    expect(easeIn.x as number).toBeLessThan(linear.x as number);
  });
});
