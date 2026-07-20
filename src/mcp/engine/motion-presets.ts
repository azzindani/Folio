/**
 * Motion presets — named shorthands that expand to ordinary keyframes.
 *
 * These are deliberately MECHANICS, not looks. A preset says "rise while fading
 * in" or "pulse on a loop"; none of them decides layout, colour, hierarchy or
 * composition, and none stamps a skeleton onto the design. The model still
 * chooses what moves, in what order, and why.
 *
 * The hard rule is that every preset must be expressible by hand: each one
 * returns plain Keyframe objects that `animation(op:keyframe)` could have
 * written one at a time, and `animation(op:timeline)` displays them afterwards
 * exactly like hand-authored ones. Nothing here can do something the keyframe
 * API cannot — a preset that needed its own renderer would be a black box, and
 * the model could not then adjust the result.
 */

import type { Keyframe, EasingFunction } from '../../animation/types';

export interface MotionOptions {
  /** Total length of one run, ms. */
  duration?: number;
  easing?: EasingFunction;
  /** Distance for travelling presets, px. Defaults per preset. */
  distance?: number;
}

export interface MotionTimeline {
  keyframes: Keyframe[];
  loop: boolean;
  /** Presets that read better bouncing back rather than snapping to the start. */
  direction?: 'normal' | 'alternate';
  defaultDuration: number;
  defaultEasing: EasingFunction;
}

export type MotionPreset =
  | 'fade_in' | 'rise' | 'settle' | 'scale_in' | 'sweep_in'
  | 'pulse' | 'float' | 'spin' | 'drift' | 'breathe';

/** One-line explanations, surfaced in the tool result so a blind caller can choose. */
export const PRESET_NOTES: Record<MotionPreset, string> = {
  fade_in: 'opacity 0 → 1, nothing moves',
  rise: 'lifts from below while fading in — the default entrance',
  settle: 'drops from above and eases to rest',
  scale_in: 'grows slightly from 92% while fading in',
  sweep_in: 'travels in from the left while fading in',
  pulse: 'loops a gentle scale swell — draws the eye without motion sickness',
  float: 'loops a slow vertical drift — good for a hero mark',
  spin: 'loops a full rotation about the layer centre',
  drift: 'loops a slow horizontal drift',
  breathe: 'loops a soft opacity swell',
};

export const PRESET_NAMES = Object.keys(PRESET_NOTES) as MotionPreset[];

export function isMotionPreset(v: unknown): v is MotionPreset {
  return typeof v === 'string' && (PRESET_NAMES as string[]).includes(v);
}

/**
 * Build the keyframes for a preset.
 *
 * Travelling presets emit x/y as OFFSETS from the layer's authored position,
 * paired with playback.origin:'offset'. 0 means "where the layer already is",
 * so an entrance can start displaced and land exactly at rest.
 */
export function buildTimeline(preset: MotionPreset, opts: MotionOptions = {}): MotionTimeline {
  const d = opts.distance;

  switch (preset) {
    case 'fade_in':
      return {
        keyframes: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }],
        loop: false, defaultDuration: 600, defaultEasing: 'ease-out',
      };

    case 'rise':
      return {
        keyframes: [
          { t: 0, y: d ?? 24, opacity: 0 },
          { t: 1, y: 0, opacity: 1 },
        ],
        loop: false, defaultDuration: 700, defaultEasing: 'ease-out',
      };

    case 'settle':
      return {
        keyframes: [
          { t: 0, y: -(d ?? 24), opacity: 0 },
          { t: 1, y: 0, opacity: 1 },
        ],
        loop: false, defaultDuration: 700, defaultEasing: 'ease-out',
      };

    case 'scale_in':
      return {
        keyframes: [
          { t: 0, scale: 0.92, opacity: 0 },
          { t: 1, scale: 1, opacity: 1 },
        ],
        loop: false, defaultDuration: 600, defaultEasing: 'ease-out',
      };

    case 'sweep_in':
      return {
        keyframes: [
          { t: 0, x: -(d ?? 40), opacity: 0 },
          { t: 1, x: 0, opacity: 1 },
        ],
        loop: false, defaultDuration: 700, defaultEasing: 'ease-out',
      };

    case 'pulse':
      return {
        // Deliberately shallow. A big scale loop reads as a broken page rather
        // than emphasis, and it is the single most common way motion goes wrong.
        keyframes: [{ t: 0, scale: 1 }, { t: 1, scale: 1.06 }],
        loop: true, direction: 'alternate',
        defaultDuration: 1400, defaultEasing: 'ease-in-out',
      };

    case 'float':
      return {
        keyframes: [{ t: 0, y: 0 }, { t: 1, y: -(d ?? 10) }],
        loop: true, direction: 'alternate',
        defaultDuration: 3000, defaultEasing: 'ease-in-out',
      };

    case 'drift':
      return {
        keyframes: [{ t: 0, x: 0 }, { t: 1, x: d ?? 14 }],
        loop: true, direction: 'alternate',
        defaultDuration: 4000, defaultEasing: 'ease-in-out',
      };

    case 'spin':
      return {
        // Linear, and never alternating: a spin that eases or reverses reads as
        // a stutter rather than rotation.
        keyframes: [{ t: 0, rotation: 0 }, { t: 1, rotation: 360 }],
        loop: true, direction: 'normal',
        defaultDuration: 6000, defaultEasing: 'linear',
      };

    default: // breathe
      return {
        keyframes: [{ t: 0, opacity: 1 }, { t: 1, opacity: 0.65 }],
        loop: true, direction: 'alternate',
        defaultDuration: 2600, defaultEasing: 'ease-in-out',
      };
  }
}

/**
 * Expand a preset into a concrete AnimationSpec fragment for one layer.
 *
 * `t` values from buildTimeline are fractions of the run; they are scaled to
 * real milliseconds here so the stored keyframes are absolute and readable in
 * `op:timeline` — a stored fraction would be a second, hidden unit.
 */
export function expandPreset(
  preset: MotionPreset,
  opts: MotionOptions & { delay?: number } = {},
): { keyframes: Keyframe[]; playback: { duration: number; loop?: boolean; easing?: EasingFunction; direction?: 'normal' | 'alternate'; delay?: number; origin: 'offset' } } {
  const tl = buildTimeline(preset, opts);
  const duration = opts.duration && opts.duration > 0 ? opts.duration : tl.defaultDuration;
  const easing = opts.easing ?? tl.defaultEasing;

  const keyframes = tl.keyframes.map(kf => ({ ...kf, t: Math.round(kf.t * duration) }));

  return {
    keyframes,
    playback: {
      duration,
      // Preset travel is expressed as a delta from wherever the renderer put
      // the layer, so an entrance can start displaced and settle at rest.
      origin: 'offset',
      ...(tl.loop ? { loop: true } : {}),
      ...(tl.direction && tl.direction !== 'normal' ? { direction: tl.direction } : {}),
      easing,
      ...(opts.delay ? { delay: Math.round(opts.delay) } : {}),
    },
  };
}
