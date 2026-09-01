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

import type { Keyframe, EasingFunction, AnchorPoint } from '../../animation/types';

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
  /** Pivot for rotate/scale/skew, when not the centre. */
  anchor?: AnchorPoint;
}

export type MotionPreset =
  // entrances
  | 'fade_in' | 'rise' | 'settle' | 'scale_in' | 'sweep_in'
  | 'pop' | 'drop' | 'blur_in' | 'draw_on' | 'spin_in' | 'flip_in' | 'grow_up' | 'whip'
  // exits
  | 'fade_out' | 'sink' | 'shrink_out' | 'blur_out' | 'sweep_out' | 'pop_out'
  // loops
  | 'pulse' | 'float' | 'spin' | 'drift' | 'breathe'
  | 'wobble' | 'sway' | 'heartbeat' | 'flicker';

export type PresetKind = 'entrance' | 'exit' | 'loop';

/** One-line explanations, surfaced in the tool result so a blind caller can choose. */
export const PRESET_NOTES: Record<MotionPreset, string> = {
  fade_in: 'opacity 0 → 1, nothing moves',
  rise: 'lifts from below while fading in — the default entrance',
  settle: 'drops from above and eases to rest',
  scale_in: 'grows slightly from 92% while fading in',
  sweep_in: 'travels in from the left while fading in',
  pop: 'springs up from 60% and overshoots — playful emphasis (ease-out-back)',
  drop: 'falls from above and bounces on landing (ease-out-bounce)',
  blur_in: 'sharpens from a 16px blur while fading in — cinematic',
  draw_on: 'a stroke draws itself along its outline, 0 → 100% — lines, connectors, hand-drawn marks',
  spin_in: 'rotates in from -180° while growing and fading in',
  flip_in: 'flips open horizontally from a zero-width edge (scale_x 0 → 1)',
  grow_up: 'grows upward from its base like a bar chart column (scale_y, anchored bottom)',
  whip: 'whips in from the left with a lean that straightens (skew + travel, ease-out-expo)',
  fade_out: 'opacity 1 → 0 — plain exit',
  sink: 'drops below while fading out',
  shrink_out: 'shrinks to 80% while fading out',
  blur_out: 'blurs to 16px while fading out',
  sweep_out: 'travels off to the right while fading out',
  pop_out: 'pulls back then vanishes (ease-in-back)',
  pulse: 'loops a gentle scale swell — draws the eye without motion sickness',
  float: 'loops a slow vertical drift — good for a hero mark',
  spin: 'loops a full rotation about the layer centre',
  drift: 'loops a slow horizontal drift',
  breathe: 'loops a soft opacity swell',
  wobble: 'loops a ±3° rock about the centre — a sticker, a badge',
  sway: 'loops a ±4° lean pivoting on the bottom edge — a plant, a flag, a sign',
  heartbeat: 'loops a double-thump scale beat (1 → 1.08 → 1 → 1.12 → 1)',
  flicker: 'loops a stepped opacity flicker — neon, a cursor, a warning light',
};

export const PRESET_KIND: Record<MotionPreset, PresetKind> = {
  fade_in: 'entrance', rise: 'entrance', settle: 'entrance', scale_in: 'entrance', sweep_in: 'entrance',
  pop: 'entrance', drop: 'entrance', blur_in: 'entrance', draw_on: 'entrance', spin_in: 'entrance',
  flip_in: 'entrance', grow_up: 'entrance', whip: 'entrance',
  fade_out: 'exit', sink: 'exit', shrink_out: 'exit', blur_out: 'exit', sweep_out: 'exit', pop_out: 'exit',
  pulse: 'loop', float: 'loop', spin: 'loop', drift: 'loop', breathe: 'loop',
  wobble: 'loop', sway: 'loop', heartbeat: 'loop', flicker: 'loop',
};

export const PRESET_NAMES = Object.keys(PRESET_NOTES) as MotionPreset[];

/** Preset names grouped by kind, for tool descriptions and error hints. */
export function presetsByKind(): Record<PresetKind, MotionPreset[]> {
  const out: Record<PresetKind, MotionPreset[]> = { entrance: [], exit: [], loop: [] };
  for (const p of PRESET_NAMES) out[PRESET_KIND[p]].push(p);
  return out;
}

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

    case 'pop':
      return {
        keyframes: [{ t: 0, scale: 0.6, opacity: 0 }, { t: 1, scale: 1, opacity: 1 }],
        loop: false, defaultDuration: 550, defaultEasing: 'ease-out-back',
      };

    case 'drop':
      return {
        keyframes: [{ t: 0, y: -(d ?? 120), opacity: 0 }, { t: 0.2, y: -(d ?? 120) * 0.8, opacity: 1 }, { t: 1, y: 0 }],
        loop: false, defaultDuration: 900, defaultEasing: 'ease-out-bounce',
      };

    case 'blur_in':
      return {
        keyframes: [{ t: 0, blur: 16, opacity: 0 }, { t: 1, blur: 0, opacity: 1 }],
        loop: false, defaultDuration: 800, defaultEasing: 'ease-out',
      };

    case 'draw_on':
      return {
        keyframes: [{ t: 0, draw: 0 }, { t: 1, draw: 1 }],
        loop: false, defaultDuration: 1200, defaultEasing: 'ease-in-out',
      };

    case 'spin_in':
      return {
        keyframes: [{ t: 0, rotation: -180, scale: 0.5, opacity: 0 }, { t: 1, rotation: 0, scale: 1, opacity: 1 }],
        loop: false, defaultDuration: 700, defaultEasing: 'ease-out-cubic',
      };

    case 'flip_in':
      return {
        keyframes: [{ t: 0, scale_x: 0, opacity: 0 }, { t: 1, scale_x: 1, opacity: 1 }],
        loop: false, defaultDuration: 500, defaultEasing: 'ease-out-cubic',
      };

    case 'grow_up':
      return {
        keyframes: [{ t: 0, scale_y: 0 }, { t: 1, scale_y: 1 }],
        loop: false, defaultDuration: 700, defaultEasing: 'ease-out-cubic', anchor: 'bottom',
      };

    case 'whip':
      return {
        keyframes: [{ t: 0, x: -(d ?? 80), skew_x: 20, opacity: 0 }, { t: 1, x: 0, skew_x: 0, opacity: 1 }],
        loop: false, defaultDuration: 600, defaultEasing: 'ease-out-expo',
      };

    // ── exits — start at rest, end gone. Pair with `at`/delay so they fire late.
    case 'fade_out':
      return { keyframes: [{ t: 0, opacity: 1 }, { t: 1, opacity: 0 }], loop: false, defaultDuration: 400, defaultEasing: 'ease-in' };

    case 'sink':
      return {
        keyframes: [{ t: 0, y: 0, opacity: 1 }, { t: 1, y: d ?? 24, opacity: 0 }],
        loop: false, defaultDuration: 500, defaultEasing: 'ease-in',
      };

    case 'shrink_out':
      return {
        keyframes: [{ t: 0, scale: 1, opacity: 1 }, { t: 1, scale: 0.8, opacity: 0 }],
        loop: false, defaultDuration: 400, defaultEasing: 'ease-in',
      };

    case 'blur_out':
      return {
        keyframes: [{ t: 0, blur: 0, opacity: 1 }, { t: 1, blur: 16, opacity: 0 }],
        loop: false, defaultDuration: 600, defaultEasing: 'ease-in',
      };

    case 'sweep_out':
      return {
        keyframes: [{ t: 0, x: 0, opacity: 1 }, { t: 1, x: d ?? 40, opacity: 0 }],
        loop: false, defaultDuration: 500, defaultEasing: 'ease-in',
      };

    case 'pop_out':
      return {
        keyframes: [{ t: 0, scale: 1, opacity: 1 }, { t: 1, scale: 0.6, opacity: 0 }],
        loop: false, defaultDuration: 450, defaultEasing: 'ease-in-back',
      };

    case 'wobble':
      return {
        keyframes: [{ t: 0, rotation: -3 }, { t: 1, rotation: 3 }],
        loop: true, direction: 'alternate', defaultDuration: 1200, defaultEasing: 'ease-in-out',
      };

    case 'sway':
      return {
        keyframes: [{ t: 0, skew_x: -4 }, { t: 1, skew_x: 4 }],
        loop: true, direction: 'alternate', defaultDuration: 2200, defaultEasing: 'ease-in-out', anchor: 'bottom',
      };

    case 'heartbeat':
      return {
        keyframes: [
          { t: 0, scale: 1 }, { t: 0.14, scale: 1.08 }, { t: 0.28, scale: 1 },
          { t: 0.42, scale: 1.12 }, { t: 0.7, scale: 1 }, { t: 1, scale: 1 },
        ],
        loop: true, direction: 'normal', defaultDuration: 1600, defaultEasing: 'ease-in-out',
      };

    case 'flicker':
      return {
        keyframes: [
          { t: 0, opacity: 1, hold: true }, { t: 0.1, opacity: 0.4, hold: true }, { t: 0.2, opacity: 1, hold: true },
          { t: 0.55, opacity: 0.7, hold: true }, { t: 0.6, opacity: 1, hold: true }, { t: 1, opacity: 1 },
        ],
        loop: true, direction: 'normal', defaultDuration: 2400, defaultEasing: 'linear',
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
): { keyframes: Keyframe[]; playback: { duration: number; loop?: boolean; easing?: EasingFunction; direction?: 'normal' | 'alternate'; delay?: number; origin: 'offset'; anchor?: AnchorPoint } } {
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
      ...(tl.anchor ? { anchor: tl.anchor } : {}),
      ...(opts.delay ? { delay: Math.round(opts.delay) } : {}),
    },
  };
}
