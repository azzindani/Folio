// ── Animation Types (from CLAUDE.md Section 12.2) ──────────

export type EasingFunction =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | `cubic-bezier(${string})`;

// ── Level 1: CSS Enter/Exit Animations ──────────────────────
export type EnterAnimationType =
  | 'fade_in' | 'fade_up' | 'fade_down' | 'fade_left' | 'fade_right'
  | 'scale_in' | 'scale_up' | 'slide_up' | 'slide_down' | 'slide_left' | 'slide_right'
  | 'flip_in' | 'rotate_in' | 'blur_in' | 'bounce_in';

export type ExitAnimationType =
  | 'fade_out' | 'fade_up_out' | 'fade_down_out'
  | 'scale_out' | 'slide_up_out' | 'slide_down_out'
  | 'blur_out';

export type LoopAnimationType =
  | 'float' | 'pulse' | 'glow' | 'spin' | 'shake' | 'bounce' | 'breathe';

export interface EnterAnimation {
  type: EnterAnimationType;
  delay?: number;
  duration?: number;
  easing?: EasingFunction;
}

export interface ExitAnimation {
  type: ExitAnimationType;
  delay?: number;
  duration?: number;
  easing?: EasingFunction;
}

export interface LoopAnimation {
  type: LoopAnimationType;
  duration?: number;
  amplitude?: number;
  scale?: number;
  color?: string;
}

// ── Level 2: Keyframe Timeline ──────────────────────────────
export interface Keyframe {
  t: number; // time in ms
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  scale?: number;
  'fill.color'?: string;
  'stroke.color'?: string;
  [key: string]: unknown;
}

export interface KeyframeAnimation {
  keyframes: Keyframe[];
  playback: {
    duration: number;
    loop?: boolean;
    easing?: EasingFunction;
    direction?: 'normal' | 'reverse' | 'alternate';
  };
}

// ── Stagger Sequence ────────────────────────────────────────
export interface StaggerItem {
  ref: string;
  animate: EnterAnimationType;
}

export interface StaggerSequence {
  stagger: number; // delay between items in ms
  items: StaggerItem[];
}

// ── Combined Animation Spec ─────────────────────────────────
export interface AnimationSpec {
  enter?: EnterAnimation;
  exit?: ExitAnimation;
  loop?: LoopAnimation;
  keyframes?: Keyframe[];
  playback?: KeyframeAnimation['playback'];
  sequence?: StaggerSequence;
}
