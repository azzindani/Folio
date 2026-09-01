/**
 * Keyframe timeline → CSS `@keyframes`, v2.
 *
 * What v1 could not say: per-segment easing (every segment used one curve),
 * curves CSS has no bezier for (bounce, elastic), held keyframes, non-uniform
 * scale, skew, blur, stroke reveal, a pivot other than the centre, and a
 * finite repeat count. All of it is expressible in plain CSS animation, so
 * the animated-SVG export stays binary-free.
 *
 * Positions are emitted as a translate DELTA from the rest position rather
 * than absolute coordinates, because the renderer already drew the layer at
 * its own x/y — animating absolute values would double the offset and throw
 * the layer off-canvas. See KeyframeAnimation.playback.origin.
 */

import type { AnimationSpec, Keyframe, AnchorPoint } from './types';
import { easingToCSS, bakeEasing, resolveEasing } from './easing';

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Animated numeric channels, and what they lerp from when a frame omits them. */
const CHANNELS = ['x', 'y', 'rotation', 'opacity', 'scale', 'scale_x', 'scale_y', 'skew_x', 'skew_y', 'blur', 'draw'] as const;
type Channel = typeof CHANNELS[number];
const REST: Record<Channel, number> = {
  x: 0, y: 0, rotation: 0, opacity: 1, scale: 1, scale_x: 1, scale_y: 1, skew_x: 0, skew_y: 0, blur: 0, draw: 1,
};

/** A fully resolved pose: every channel has a number, colours may be absent. */
interface Pose {
  n: Record<Channel, number>;
  fill?: string;
  stroke?: string;
}

/**
 * Fill in channels a keyframe left out, so a frame that only says `opacity`
 * does not silently reset position to 0 mid-move. Each missing channel takes
 * the value from the nearest EARLIER frame that set it, else the rest value.
 */
function resolvePoses(sorted: Keyframe[], baseX: number, baseY: number): Pose[] {
  const cur: Record<Channel, number> = { ...REST };
  let fill: string | undefined;
  let stroke: string | undefined;
  return sorted.map(kf => {
    for (const c of CHANNELS) {
      const v = num(kf[c]);
      if (v !== undefined) cur[c] = c === 'x' ? v - baseX : c === 'y' ? v - baseY : v;
    }
    if (typeof kf['fill.color'] === 'string') fill = kf['fill.color'];
    if (typeof kf['stroke.color'] === 'string') stroke = kf['stroke.color'];
    return { n: { ...cur }, fill, stroke };
  });
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const n = { ...a.n };
  for (const c of CHANNELS) n[c] = a.n[c] + (b.n[c] - a.n[c]) * t;
  // Colours are not baked — a bounce on a colour is nonsense anyway.
  return { n, fill: t < 0.5 ? a.fill : b.fill, stroke: t < 0.5 ? a.stroke : b.stroke };
}

const fmt = (v: number): string => String(Number(v.toFixed(3)));

/** The CSS declarations for one pose. */
function poseDecls(p: Pose, hasDraw: boolean): string[] {
  const decls: string[] = [];
  const parts: string[] = [];
  const { n } = p;
  if (n.x !== 0 || n.y !== 0) parts.push(`translate(${fmt(n.x)}px, ${fmt(n.y)}px)`);
  if (n.rotation !== 0) parts.push(`rotate(${fmt(n.rotation)}deg)`);
  if (n.skew_x !== 0 || n.skew_y !== 0) parts.push(`skew(${fmt(n.skew_x)}deg, ${fmt(n.skew_y)}deg)`);
  const sx = n.scale_x !== 1 ? n.scale_x : n.scale;
  const sy = n.scale_y !== 1 ? n.scale_y : n.scale;
  if (sx !== 1 || sy !== 1) parts.push(sx === sy ? `scale(${fmt(sx)})` : `scale(${fmt(sx)}, ${fmt(sy)})`);
  // Always emit a transform once any frame moves, so a frame at rest reads as
  // "none" rather than inheriting whatever the previous step set.
  decls.push(`transform: ${parts.length ? parts.join(' ') : 'none'};`);
  decls.push(`opacity: ${fmt(n.opacity)};`);
  decls.push(`filter: ${n.blur > 0 ? `blur(${fmt(n.blur)}px)` : 'none'};`);
  if (hasDraw) decls.push(`stroke-dashoffset: ${fmt(1 - Math.max(0, Math.min(1, n.draw)))};`);
  if (p.fill) decls.push(`fill: ${p.fill};`);
  if (p.stroke) decls.push(`stroke: ${p.stroke};`);
  return decls;
}

/** transform-origin for an anchor point, in fill-box terms. */
export function anchorToOrigin(anchor: AnchorPoint | undefined): string {
  switch (anchor) {
    case 'top': return '50% 0%';
    case 'bottom': return '50% 100%';
    case 'left': return '0% 50%';
    case 'right': return '100% 50%';
    case 'top left': return '0% 0%';
    case 'top right': return '100% 0%';
    case 'bottom left': return '0% 100%';
    case 'bottom right': return '100% 100%';
    default: return '50% 50%';
  }
}

/** True when any frame animates the stroke reveal — the export must add pathLength. */
export function usesDraw(anim: AnimationSpec): boolean {
  return (anim.keyframes ?? []).some(k => num(k.draw) !== undefined);
}

interface Step { pct: number; decls: string[]; timing: string }

/**
 * Turn a keyframe timeline into a real `@keyframes` rule plus the selector
 * that plays it. Returns '' for anything with fewer than two frames.
 */
export function generateKeyframeCSS(layerId: string, anim: AnimationSpec): string {
  const frames = anim.keyframes;
  if (!frames || frames.length < 2) return '';

  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const playback = anim.playback;
  const span = last.t - first.t;
  const duration = playback?.duration ?? (span > 0 ? span : 1000);
  if (duration <= 0) return '';

  const offsetOrigin = playback?.origin === 'offset';
  const baseX = offsetOrigin ? 0 : (num(first.x) ?? 0);
  const baseY = offsetOrigin ? 0 : (num(first.y) ?? 0);
  const poses = resolvePoses(sorted, baseX, baseY);
  const hasDraw = usesDraw(anim);
  const defaultEasing = playback?.easing ?? 'ease-in-out';

  const steps: Step[] = [];
  const pctOf = (t: number): number => Math.max(0, Math.min(100, ((t - first.t) / duration) * 100));

  for (let i = 0; i < sorted.length; i++) {
    const kf = sorted[i];
    const pose = poses[i];
    const isLast = i === sorted.length - 1;
    const name = kf.hold ? 'hold' : (typeof kf.easing === 'string' ? kf.easing : defaultEasing);
    const css = easingToCSS(name);

    if (isLast || css !== null) {
      steps.push({ pct: pctOf(kf.t), decls: poseDecls(pose, hasDraw), timing: css ?? 'linear' });
      continue;
    }

    // A curve CSS cannot draw (bounce, elastic): bake it into linear
    // sub-steps between this frame and the next. Sixteen reads as the curve;
    // fewer reads as a stutter.
    const next = sorted[i + 1];
    const nextPose = poses[i + 1];
    const p0 = pctOf(kf.t), p1 = pctOf(next.t);
    const baked = bakeEasing(name, 16);
    for (let k = 0; k < baked.length - 1; k++) {
      const [frac, eased] = baked[k];
      steps.push({ pct: p0 + (p1 - p0) * frac, decls: poseDecls(lerpPose(pose, nextPose, eased), hasDraw), timing: 'linear' });
    }
  }

  const body = steps.map(s => `${fmt(s.pct)}% { ${s.decls.join(' ')} animation-timing-function: ${s.timing}; }`).join(' ');
  const name = `kf-${layerId}`;
  const iteration = playback?.loop ? (playback.iterations && playback.iterations > 0 ? String(playback.iterations) : 'infinite') : '1';
  const direction = playback?.direction ?? 'normal';
  const delay = Math.max(0, playback?.delay ?? 0);
  const origin = anchorToOrigin(playback?.anchor);
  const drawDecl = hasDraw ? ' stroke-dasharray: 1;' : '';

  const selector = hasDraw
    ? `[data-layer-id="${layerId}"], [data-layer-id="${layerId}"] *`
    : `[data-layer-id="${layerId}"]`;

  return [
    `@keyframes ${name} { ${body} }`,
    `${selector} { transform-box: fill-box; transform-origin: ${origin};${drawDecl} ` +
      `animation: ${name} ${duration}ms linear ${delay}ms ${iteration} ${direction} both; }`,
  ].join('\n');
}

/**
 * Sample the resolved pose of a timeline at time t (ms from the timeline's
 * first frame), honouring per-segment easing and holds — the reference the
 * flipbook route and tests use to check the CSS says the same thing.
 */
export function poseAt(anim: AnimationSpec, t: number): Record<Channel, number> {
  const frames = anim.keyframes ?? [];
  if (frames.length === 0) return { ...REST };
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const offsetOrigin = anim.playback?.origin === 'offset';
  const baseX = offsetOrigin ? 0 : (num(sorted[0].x) ?? 0);
  const baseY = offsetOrigin ? 0 : (num(sorted[0].y) ?? 0);
  const poses = resolvePoses(sorted, baseX, baseY);
  if (t <= sorted[0].t) return { ...poses[0].n };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const raw = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      const fn = a.hold ? (x: number): number => (x >= 1 ? 1 : 0) : resolveEasing(typeof a.easing === 'string' ? a.easing : anim.playback?.easing);
      return lerpPose(poses[i], poses[i + 1], fn(raw)).n;
    }
  }
  return { ...poses[poses.length - 1].n };
}
