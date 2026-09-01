/**
 * Easing library — the After-Effects half of the keyframe engine.
 *
 * The keyframe engine used to know five curves and ignored everything else,
 * including the `cubic-bezier(…)` strings the type system already allowed. A
 * model writing motion has no way to make a landing feel weighty or a pop feel
 * springy with only ease-in/ease-out, and "add a keyframe" is not an answer —
 * overshoot and bounce are curves, not positions.
 *
 * Two audiences read this file:
 *
 *   resolveEasing(name)  → a (t) => t function for anything that samples the
 *                          timeline itself: the flipbook (GIF) route, the
 *                          editor scrubber, tests.
 *   easingToCSS(name)    → a CSS timing-function string for the animated-SVG
 *                          route. Curves CSS cannot express as one bezier
 *                          (elastic, bounce, back with a big overshoot) report
 *                          `null`, and the CSS generator bakes them into extra
 *                          keyframe steps instead — see keyframe-css.ts.
 *
 * Both must agree on every curve, or the same design animates differently in
 * SVG and GIF — worse than either being wrong.
 */

export type EasingFn = (t: number) => number;

export interface EasingDef {
  fn: EasingFn;
  /** Exact CSS timing function, or null when CSS needs a baked curve. */
  css: string | null;
  note: string;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

// ── Cubic bezier solver (same maths as the browser's) ───────

function bezierFn(x1: number, y1: number, x2: number, y2: number): EasingFn {
  const A = (a1: number, a2: number): number => 1 - 3 * a2 + 3 * a1;
  const B = (a1: number, a2: number): number => 3 * a2 - 6 * a1;
  const C = (a1: number): number => 3 * a1;
  const calc = (t: number, a1: number, a2: number): number => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
  const slope = (t: number, a1: number, a2: number): number => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);

  const solveX = (x: number): number => {
    let t = x;
    // Newton–Raphson, then bisection if the slope is too flat to trust.
    for (let i = 0; i < 8; i++) {
      const s = slope(t, x1, x2);
      if (Math.abs(s) < 1e-6) break;
      const err = calc(t, x1, x2) - x;
      if (Math.abs(err) < 1e-6) return t;
      t -= err / s;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 24 && hi - lo > 1e-6; i++) {
      t = (lo + hi) / 2;
      if (calc(t, x1, x2) < x) lo = t; else hi = t;
    }
    return t;
  };

  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (x1 === y1 && x2 === y2) return t; // linear shortcut
    return calc(solveX(t), y1, y2);
  };
}

export function parseCubicBezier(s: string): [number, number, number, number] | null {
  const m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/i.exec(s.trim());
  if (!m) return null;
  const v = m.slice(1, 5).map(Number);
  if (v.some(n => !Number.isFinite(n))) return null;
  // x must stay inside [0,1] or the curve is not a function of time.
  const x1 = clamp01(v[0]), x2 = clamp01(v[2]);
  return [x1, v[1], x2, v[3]];
}

export function parseSteps(s: string): { n: number; jump: 'start' | 'end' } | null {
  const m = /^steps\(\s*(\d+)\s*(?:,\s*(start|end|jump-start|jump-end)\s*)?\)$/i.exec(s.trim());
  if (!m) return null;
  const n = Math.max(1, parseInt(m[1], 10));
  const jump = (m[2] ?? 'end').toLowerCase().includes('start') ? 'start' : 'end';
  return { n, jump };
}

// ── Named curves ────────────────────────────────────────────

const bounceOut: EasingFn = (t) => {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
  if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
  t -= 2.625 / d1; return n1 * t * t + 0.984375;
};

const c1 = 1.70158;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;

const bez = (x1: number, y1: number, x2: number, y2: number, note: string): EasingDef => ({
  fn: bezierFn(x1, y1, x2, y2),
  css: `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`,
  note,
});

/** Every named curve the engine knows, keyed by the name a keyframe uses. */
export const EASINGS: Record<string, EasingDef> = {
  linear:        { fn: (t) => t, css: 'linear', note: 'constant speed — mechanical, right for spins and scrolls' },
  ease:          { fn: bezierFn(0.25, 0.1, 0.25, 1), css: 'ease', note: 'gentle both ends (CSS default)' },
  'ease-in':     { fn: bezierFn(0.42, 0, 1, 1), css: 'ease-in', note: 'starts slow — for exits' },
  'ease-out':    { fn: bezierFn(0, 0, 0.58, 1), css: 'ease-out', note: 'ends slow — the default for entrances' },
  'ease-in-out': { fn: bezierFn(0.42, 0, 0.58, 1), css: 'ease-in-out', note: 'slow both ends — loops and moves between two rest states' },

  // Penner family — the vocabulary every motion designer already has.
  'ease-in-quad':     bez(0.11, 0, 0.5, 0, 'soft acceleration'),
  'ease-out-quad':    bez(0.5, 1, 0.89, 1, 'soft deceleration'),
  'ease-in-out-quad': bez(0.45, 0, 0.55, 1, 'soft both ends'),
  'ease-in-cubic':    bez(0.32, 0, 0.67, 0, 'firm acceleration'),
  'ease-out-cubic':   bez(0.33, 1, 0.68, 1, 'firm deceleration — crisp landings'),
  'ease-in-out-cubic':bez(0.65, 0, 0.35, 1, 'firm both ends'),
  'ease-in-quart':    bez(0.5, 0, 0.75, 0, 'strong acceleration'),
  'ease-out-quart':   bez(0.25, 1, 0.5, 1, 'strong deceleration'),
  'ease-in-out-quart':bez(0.76, 0, 0.24, 1, 'strong both ends'),
  'ease-in-expo':     bez(0.7, 0, 0.84, 0, 'explosive acceleration'),
  'ease-out-expo':    bez(0.16, 1, 0.3, 1, 'snaps in then settles — UI panels'),
  'ease-in-out-expo': bez(0.87, 0, 0.13, 1, 'explosive both ends'),
  'ease-in-circ':     bez(0.55, 0, 1, 0.45, 'circular acceleration'),
  'ease-out-circ':    bez(0, 0.55, 0.45, 1, 'circular deceleration'),
  'ease-in-out-circ': bez(0.85, 0, 0.15, 1, 'circular both ends'),

  // Overshoot: a real bezier can leave [0,1] on y, so CSS handles these natively.
  'ease-in-back':     { fn: (t) => c3 * t * t * t - c1 * t * t, css: 'cubic-bezier(0.36, 0, 0.66, -0.56)', note: 'pulls back before leaving' },
  'ease-out-back':    { fn: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2), css: 'cubic-bezier(0.34, 1.56, 0.64, 1)', note: 'overshoots then settles — the "pop"' },
  'ease-in-out-back': { fn: (t) => t < 0.5
    ? (Math.pow(2 * t, 2) * ((c1 * 1.525 + 1) * 2 * t - c1 * 1.525)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c1 * 1.525 + 1) * (t * 2 - 2) + c1 * 1.525) + 2) / 2,
    css: 'cubic-bezier(0.68, -0.6, 0.32, 1.6)', note: 'anticipation and overshoot' },

  // Oscillating: no single bezier can express these, so CSS gets a baked curve.
  'ease-out-elastic': { fn: (t) => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1,
    css: null, note: 'springs past and rings down — playful' },
  'ease-in-elastic':  { fn: (t) => t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4),
    css: null, note: 'winds up then snaps away' },
  'ease-in-out-elastic': { fn: (t) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5
    ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
    : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1,
    css: null, note: 'rings at both ends' },
  'ease-out-bounce':  { fn: bounceOut, css: null, note: 'lands and bounces like a dropped ball' },
  'ease-in-bounce':   { fn: (t) => 1 - bounceOut(1 - t), css: null, note: 'bounces before leaving' },
  'ease-in-out-bounce': { fn: (t) => t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2,
    css: null, note: 'bounces both ends' },

  // Friendly aliases a model will reach for without knowing the Penner names.
  snap:   bez(0.16, 1, 0.3, 1, 'alias of ease-out-expo'),
  smooth: bez(0.65, 0, 0.35, 1, 'alias of ease-in-out-cubic'),
  pop:    { fn: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2), css: 'cubic-bezier(0.34, 1.56, 0.64, 1)', note: 'alias of ease-out-back' },
  spring: { fn: (t) => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1, css: null, note: 'alias of ease-out-elastic' },
  bounce: { fn: bounceOut, css: null, note: 'alias of ease-out-bounce' },
  hold:   { fn: (t) => (t >= 1 ? 1 : 0), css: 'steps(1, end)', note: 'no interpolation — jump at the next keyframe' },
};

export const EASING_NAMES = Object.keys(EASINGS);

/** Names + one-line notes, for tool output that has to let a blind caller choose. */
export function describeEasings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(EASINGS)) out[k] = v.note;
  return out;
}

/** True when the string names a curve this engine can evaluate. */
export function isKnownEasing(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  return s in EASINGS || parseCubicBezier(s) !== null || parseSteps(s) !== null;
}

/**
 * Resolve any easing string to a function. Unknown names fall back to
 * ease-in-out rather than throwing: a typo in a curve name should soften a
 * move, not blank a poster.
 */
export function resolveEasing(name: string | undefined): EasingFn {
  if (!name) return EASINGS['ease-in-out'].fn;
  const def = EASINGS[name];
  if (def) return def.fn;
  const cb = parseCubicBezier(name);
  if (cb) return bezierFn(cb[0], cb[1], cb[2], cb[3]);
  const st = parseSteps(name);
  if (st) {
    return (t) => {
      const c = clamp01(t);
      const k = st.jump === 'start' ? Math.ceil(c * st.n) : Math.floor(c * st.n);
      return Math.min(1, k / st.n);
    };
  }
  return EASINGS['ease-in-out'].fn;
}

/**
 * CSS timing function for a curve, or null when it must be baked into
 * intermediate keyframes because no single bezier can draw it.
 */
export function easingToCSS(name: string | undefined): string | null {
  if (!name) return 'ease-in-out';
  const def = EASINGS[name];
  if (def) return def.css;
  if (parseCubicBezier(name)) return name.trim();
  const st = parseSteps(name);
  if (st) return `steps(${st.n}, ${st.jump})`;
  return 'ease-in-out';
}

/**
 * Sample a curve that CSS cannot express into N linear sub-steps.
 * Returns [fraction-of-segment, eased-value] pairs, endpoints included.
 * 16 steps make a bounce read as a bounce; fewer read as a stutter.
 */
export function bakeEasing(name: string, steps = 16): Array<[number, number]> {
  const fn = resolveEasing(name);
  const n = Math.max(2, Math.round(steps));
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const p = i / n;
    out.push([p, fn(p)]);
  }
  return out;
}
