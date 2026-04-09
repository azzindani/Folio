import type { Keyframe, KeyframeAnimation, EasingFunction } from './types';

// ── Easing Functions ────────────────────────────────────────
const EASING_MAP: Record<string, (t: number) => number> = {
  linear: (t) => t,
  ease: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  'ease-in': (t) => t * t,
  'ease-out': (t) => t * (2 - t),
  'ease-in-out': (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
};

function getEasingFn(easing: EasingFunction): (t: number) => number {
  return EASING_MAP[easing] ?? EASING_MAP['ease'];
}

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
      if (key === 't') continue;
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
  const easingFn = getEasingFn(easing);
  const t = easingFn(rawT);

  // Interpolate all properties
  const result: InterpolatedValues = {};
  const allKeys = new Set([...Object.keys(prevKf), ...Object.keys(nextKf)]);

  for (const key of allKeys) {
    if (key === 't') continue;

    const prevVal = prevKf[key];
    const nextVal = nextKf[key];

    if (prevVal === undefined && nextVal !== undefined) {
      result[key] = nextVal as number | string;
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
