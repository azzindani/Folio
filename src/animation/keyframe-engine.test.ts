import { describe, it, expect, vi } from 'vitest';
import { interpolateKeyframes, PlaybackController } from './keyframe-engine';
import type { Keyframe, KeyframeAnimation } from './types';

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

  it('ease easing produces correct output', () => {
    const keyframes: Keyframe[] = [{ t: 0, x: 0 }, { t: 1000, x: 100 }];
    const r = interpolateKeyframes(keyframes, 500, 'ease');
    expect(r.x as number).toBeGreaterThanOrEqual(0);
    expect(r.x as number).toBeLessThanOrEqual(100);
  });

  it('ease-out easing produces correct output', () => {
    const keyframes: Keyframe[] = [{ t: 0, x: 0 }, { t: 1000, x: 100 }];
    const r = interpolateKeyframes(keyframes, 500, 'ease-out');
    // ease-out at 50% should be > 50 (faster at start)
    expect(r.x as number).toBeGreaterThan(50);
  });

  it('ease-in-out easing is symmetric', () => {
    const keyframes: Keyframe[] = [{ t: 0, x: 0 }, { t: 1000, x: 100 }];
    const r = interpolateKeyframes(keyframes, 500, 'ease-in-out');
    // At midpoint ease-in-out ≈ 50
    expect(Math.abs((r.x as number) - 50)).toBeLessThan(5);
  });

  it('uses next-only value when prev key is absent', () => {
    const keyframes: Keyframe[] = [
      { t: 0, x: 0 },
      { t: 1000, x: 100, label: 'end' },
    ];
    const r = interpolateKeyframes(keyframes, 500, 'linear');
    expect(r.label).toBe('end');
  });

  it('falls back to snap (t<0.5 → prev, t≥0.5 → next) for non-numeric non-color', () => {
    const keyframes: Keyframe[] = [
      { t: 0, mode: 'a' },
      { t: 1000, mode: 'b' },
    ];
    const atStart = interpolateKeyframes(keyframes, 400, 'linear');
    const atEnd = interpolateKeyframes(keyframes, 600, 'linear');
    expect(atStart.mode).toBe('a');
    expect(atEnd.mode).toBe('b');
  });
});

describe('PlaybackController', () => {
  function makeAnimation(duration = 1000, loop = false): KeyframeAnimation {
    return {
      keyframes: [{ t: 0, x: 0 }, { t: duration, x: 100 }],
      playback: { duration, loop, direction: 'normal', easing: 'linear' },
    };
  }

  it('isRunning() returns false initially', () => {
    const ctrl = new PlaybackController(makeAnimation(), vi.fn());
    expect(ctrl.isRunning()).toBe(false);
  });

  it('play() starts playback — isRunning() returns true', () => {
    const ctrl = new PlaybackController(makeAnimation(), vi.fn());
    ctrl.play();
    expect(ctrl.isRunning()).toBe(true);
    ctrl.pause(); // cleanup
  });

  it('pause() stops playback', () => {
    const ctrl = new PlaybackController(makeAnimation(), vi.fn());
    ctrl.play();
    ctrl.pause();
    expect(ctrl.isRunning()).toBe(false);
  });

  it('stop() stops playback and calls onFrame with t=0 values', () => {
    const onFrame = vi.fn();
    const ctrl = new PlaybackController(makeAnimation(), onFrame);
    ctrl.play();
    ctrl.stop();
    expect(ctrl.isRunning()).toBe(false);
    expect(onFrame).toHaveBeenCalled();
    const lastCall = onFrame.mock.calls[onFrame.mock.calls.length - 1][0];
    expect(lastCall.x).toBe(0);
  });

  it('seek() calls onFrame with interpolated values', () => {
    const onFrame = vi.fn();
    const ctrl = new PlaybackController(makeAnimation(1000), onFrame);
    ctrl.seek(500); // midpoint
    expect(onFrame).toHaveBeenCalledOnce();
    const vals = onFrame.mock.calls[0][0];
    expect(vals.x).toBeCloseTo(50, 0);
  });

  it('pause() is safe to call when not running', () => {
    const ctrl = new PlaybackController(makeAnimation(), vi.fn());
    expect(() => ctrl.pause()).not.toThrow();
  });

  it('loop=true direction=alternate reverses on odd cycle (lines 174-177)', () => {
    const onFrame = vi.fn();
    const animation: KeyframeAnimation = {
      keyframes: [{ t: 0, x: 0 }, { t: 1000, x: 100 }],
      playback: { duration: 1000, loop: true, direction: 'alternate', easing: 'linear' },
    };
    const ctrl = new PlaybackController(animation, onFrame);

    // Spy on performance.now to control elapsed time
    const nowSpy = vi.spyOn(performance, 'now');

    // First play sets startTime
    nowSpy.mockReturnValueOnce(0); // play() → startTime = 0
    nowSpy.mockReturnValueOnce(1500); // first tick: elapsed = 1500 → cycle=1 (odd) → reverse
    ctrl.play(); // calls tick() once synchronously

    // At 1500ms: cycle=1 (odd), t=500ms → currentTime = 1000-500 = 500 → x=50
    const vals = onFrame.mock.calls[onFrame.mock.calls.length - 1][0];
    expect(vals.x).toBeCloseTo(50, 0);

    ctrl.pause();
    nowSpy.mockRestore();
  });

  it('loop=false, elapsed >= duration stops controller (lines 192-194)', () => {
    const onFrame = vi.fn();
    const ctrl = new PlaybackController(makeAnimation(1000, false), onFrame);

    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(0); // play() → startTime = 0
    nowSpy.mockReturnValueOnce(2000); // first tick: elapsed = 2000 >= 1000
    ctrl.play();

    expect(ctrl.isRunning()).toBe(false);
    nowSpy.mockRestore();
  });
});
