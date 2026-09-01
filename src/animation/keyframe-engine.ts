import type { Keyframe, KeyframeAnimation, EasingFunction } from './types';
import { resolveEasing } from './easing';

/**
 * The curve for the segment leaving `from`.
 *
 * After Effects semantics: a keyframe's easing shapes the travel to the NEXT
 * keyframe, and a held keyframe does not travel at all. The timeline-wide
 * `playback.easing` is only the default for segments that say nothing.
 */
function segmentEasing(from: Keyframe, timelineDefault: EasingFunction): (t: number) => number {
  if (from.hold === true) return (t) => (t >= 1 ? 1 : 0);
  if (typeof from.easing === 'string') return resolveEasing(from.easing);
  return resolveEasing(timelineDefault);
}

/** Keys that are metadata about a keyframe, not animated values. */
const META_KEYS = new Set(['t', 'easing', 'hold']);

// ── Interpolation ───────────────────────────────────────────
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: string, b: string, t: number): string {
  // Simple hex color interpolation
  const parseHex = (hex: string) => {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  };

  try {
    const ca = parseHex(a);
    const cb = parseHex(b);
    const r = Math.round(lerp(ca.r, cb.r, t));
    const g = Math.round(lerp(ca.g, cb.g, t));
    const bl = Math.round(lerp(ca.b, cb.b, t));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
  } catch {
    return t < 0.5 ? a : b;
  }
}

function isColorProperty(key: string): boolean {
  return key.includes('color') || key === 'fill' || key === 'stroke';
}

/** The most recent value a property had at or before time `t`, if any frame set it. */
function lastValueBefore(sorted: Keyframe[], t: number, key: string): unknown {
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].t <= t && sorted[i][key] !== undefined) return sorted[i][key];
  }
  return undefined;
}

// ── Keyframe Engine ─────────────────────────────────────────
export interface InterpolatedValues {
  [key: string]: number | string;
}

export function interpolateKeyframes(
  keyframes: Keyframe[],
  currentTime: number,
  easing: EasingFunction = 'ease-in-out',
): InterpolatedValues {
  if (keyframes.length === 0) return {};
  if (keyframes.length === 1) {
    const kf = keyframes[0];
    const result: InterpolatedValues = {};
    for (const [key, value] of Object.entries(kf)) {
      if (META_KEYS.has(key)) continue;
      if (value !== undefined) result[key] = value as number | string;
    }
    return result;
  }

  // Sort by time
  const sorted = [...keyframes].sort((a, b) => a.t - b.t);

  // Find surrounding keyframes
  let prevKf = sorted[0];
  let nextKf = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length - 1; i++) {
    if (currentTime >= sorted[i].t && currentTime <= sorted[i + 1].t) {
      prevKf = sorted[i];
      nextKf = sorted[i + 1];
      break;
    }
  }

  // Clamp to edges
  if (currentTime <= sorted[0].t) {
    prevKf = nextKf = sorted[0];
  } else if (currentTime >= sorted[sorted.length - 1].t) {
    prevKf = nextKf = sorted[sorted.length - 1];
  }

  // Calculate progress
  const range = nextKf.t - prevKf.t;
  const rawT = range > 0 ? (currentTime - prevKf.t) / range : 1;
  const easingFn = segmentEasing(prevKf, easing);
  const t = easingFn(Math.max(0, Math.min(1, rawT)));

  // Interpolate all properties
  const result: InterpolatedValues = {};
  const allKeys = new Set([...Object.keys(prevKf), ...Object.keys(nextKf)]);

  for (const key of allKeys) {
    if (META_KEYS.has(key)) continue;

    const prevVal = prevKf[key];
    const nextVal = nextKf[key];

    if (prevVal === undefined && nextVal !== undefined) {
      // A property that only the LATER frame names holds the earlier frame's
      // implicit value — but the engine cannot know what that was, so it
      // searches backwards for the last frame that set it and tweens from there.
      const from = lastValueBefore(sorted, prevKf.t, key);
      if (typeof from === 'number' && typeof nextVal === 'number') result[key] = lerp(from, nextVal, t);
      else if (typeof from === 'string' && typeof nextVal === 'string' && isColorProperty(key)) result[key] = lerpColor(from, nextVal, t);
      else result[key] = nextVal as number | string;
    } else if (prevVal !== undefined && nextVal === undefined) {
      result[key] = prevVal as number | string;
    } else if (typeof prevVal === 'number' && typeof nextVal === 'number') {
      result[key] = lerp(prevVal, nextVal, t);
    } else if (typeof prevVal === 'string' && typeof nextVal === 'string' && isColorProperty(key)) {
      result[key] = lerpColor(prevVal, nextVal, t);
    } else {
      result[key] = t < 0.5 ? (prevVal as number | string) : (nextVal as number | string);
    }
  }

  return result;
}

// ── Playback Controller ─────────────────────────────────────
export class PlaybackController {
  private animation: KeyframeAnimation;
  private startTime = 0;
  private running = false;
  private onFrame: (values: InterpolatedValues) => void;
  private rafId: number | null = null;

  constructor(animation: KeyframeAnimation, onFrame: (values: InterpolatedValues) => void) {
    this.animation = animation;
    this.onFrame = onFrame;
  }

  play(): void {
    this.startTime = performance.now();
    this.running = true;
    this.tick();
  }

  pause(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  stop(): void {
    this.pause();
    this.startTime = 0;
    // Reset to first keyframe
    this.onFrame(interpolateKeyframes(this.animation.keyframes, 0));
  }

  seek(time: number): void {
    const values = interpolateKeyframes(
      this.animation.keyframes,
      time,
      this.animation.playback.easing,
    );
    this.onFrame(values);
  }

  private tick(): void {
    if (!this.running) return;

    const elapsed = performance.now() - this.startTime;
    const { duration, loop, direction } = this.animation.playback;

    let currentTime: number;
    if (loop) {
      if (direction === 'alternate') {
        const cycle = Math.floor(elapsed / duration);
        const t = (elapsed % duration);
        currentTime = cycle % 2 === 0 ? t : duration - t;
      } else {
        currentTime = elapsed % duration;
      }
    } else {
      currentTime = Math.min(elapsed, duration);
    }

    const values = interpolateKeyframes(
      this.animation.keyframes,
      currentTime,
      this.animation.playback.easing,
    );
    this.onFrame(values);

    if (!loop && elapsed >= duration) {
      this.running = false;
      return;
    }

    this.rafId = requestAnimationFrame(() => this.tick());
  }

  isRunning(): boolean {
    return this.running;
  }
}
