/**
 * Many rest states per layer — a layer that moves A → B → C and stays.
 *
 * Presets are rest-relative: 0 is where the layer was authored, and every
 * entrance lands there. A continuous composition needs more: the headline
 * shrinks into a corner label and STAYS there while the next beat plays, then
 * moves again. This compiles a list of absolute states into one ordinary
 * track — offsets from the authored spot, per-segment easing, holds between —
 * so both players play it as they play everything else.
 *
 * `x`/`y` place the top-left of what the layer DRAWS, after its scale: the box
 * a model sees in op:frame. Presets compose onto a state, so `rise` lands the
 * layer where the state puts it, not where it was authored.
 */

import type { Layer } from '../../schema/types';
import type { AnimationSpec, AnchorPoint, Keyframe } from '../../animation/types';
import type { RevealFrom } from '../../animation/reveal';
import { drawnBox, type Box } from '../../export/frame-geometry';
import { expandPreset, type MotionPreset } from './motion-presets';

export interface LayerState {
  x?: number; y?: number; dx?: number; dy?: number;
  scale?: number; scale_x?: number; scale_y?: number;
  rotation?: number; opacity?: number; blur?: number; skew_x?: number; skew_y?: number;
  'fill.color'?: string; 'stroke.color'?: string;
  hidden?: boolean;
  enter?: MotionPreset; exit?: MotionPreset;
}

/** One change of state: when it starts, how long the move takes, on which curve. */
export interface StateChange {
  at: number;
  state: LayerState;
  /** How long the move (or the preset) takes; default 700 ms for a move, the preset's own for a preset. */
  duration?: number;
  /** The curve; default ease-in-out-cubic for a move, the preset's own for a preset. */
  easing?: string;
}

interface Pose {
  x: number; y: number; scale_x: number; scale_y: number; rotation: number; opacity: number;
  blur: number; skew_x: number; skew_y: number; fill?: string; stroke?: string;
  /** Channels a preset drives (draw, reveal, tracking, count, …), carried at their rest values otherwise. */
  extra: Record<string, number>;
}
interface Frame { t: number; pose: Pose; easing?: string; hold?: boolean }

export interface CompiledStates {
  animation: AnimationSpec;
  in?: number;
  out?: number;
  /** Where each change leaves the layer: the landing pose, for the reply. */
  landings: Array<{ at: number; to: number; x: number; y: number; scale: number; opacity: number }>;
  notes: string[];
}

const EXTRA_REST: Record<string, number> = { draw: 1, draw_start: 0, reveal: 1, tracking: 0, count: 1, morph: 0 };
const REST: Pose = { x: 0, y: 0, scale_x: 1, scale_y: 1, rotation: 0, opacity: 1, blur: 0, skew_x: 0, skew_y: 0, extra: { ...EXTRA_REST } };
const r2 = (v: number): number => Math.round(v * 100) / 100 || 0;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Pivot fractions for an anchor — the same ones keyframe-css turns into transform-origin. */
function pivot(anchor: AnchorPoint): { fx: number; fy: number } {
  return { fx: anchor.includes('left') ? 0 : anchor.includes('right') ? 1 : 0.5, fy: anchor.includes('top') ? 0 : anchor.includes('bottom') ? 1 : 0.5 };
}

/** The pose a state asks for, from the pose before it. */
function landing(prev: Pose, s: LayerState, box: Box | null, anchor: AnchorPoint, notes: string[], id: string): Pose {
  const sx = num(s.scale_x) ?? num(s.scale) ?? prev.scale_x;
  const sy = num(s.scale_y) ?? num(s.scale) ?? prev.scale_y;
  const next: Pose = { ...prev, extra: { ...prev.extra }, scale_x: sx, scale_y: sy };
  const { fx, fy } = pivot(anchor);
  if (num(s.x) !== undefined || num(s.y) !== undefined) {
    if (!box) notes.push(`${id}: its drawn box is unknown, so x/y cannot place it — use dx/dy (offsets from where it was authored).`);
    else {
      // Where the scaled box's top-left sits for offset 0, then the offset that moves it to x/y.
      if (num(s.x) !== undefined) next.x = (num(s.x) ?? 0) - (box.x + fx * box.width * (1 - sx));
      if (num(s.y) !== undefined) next.y = (num(s.y) ?? 0) - (box.y + fy * box.height * (1 - sy));
    }
  }
  if (num(s.x) === undefined && num(s.dx) !== undefined) next.x = num(s.dx) ?? 0;
  if (num(s.y) === undefined && num(s.dy) !== undefined) next.y = num(s.dy) ?? 0;
  for (const k of ['rotation', 'blur', 'skew_x', 'skew_y'] as const) next[k] = num(s[k]) ?? prev[k];
  // A layer mentioned again after it was hidden comes back, unless the state says otherwise.
  next.opacity = s.hidden ? 0 : num(s.opacity) ?? (prev.opacity <= 0 ? 1 : prev.opacity);
  if (typeof s['fill.color'] === 'string') next.fill = s['fill.color'];
  if (typeof s['stroke.color'] === 'string') next.stroke = s['stroke.color'];
  return next;
}

/** A preset frame laid over a state: offsets add, ratios multiply, trims and wipes replace. */
function compose(base: Pose, kf: Keyframe): Pose {
  const out: Pose = { ...base, extra: { ...base.extra } };
  out.x = base.x + (num(kf.x) ?? 0);
  out.y = base.y + (num(kf.y) ?? 0);
  out.scale_x = base.scale_x * (num(kf.scale_x) ?? num(kf.scale) ?? 1);
  out.scale_y = base.scale_y * (num(kf.scale_y) ?? num(kf.scale) ?? 1);
  out.rotation = base.rotation + (num(kf.rotation) ?? 0);
  out.opacity = base.opacity * (num(kf.opacity) ?? 1);
  out.blur = base.blur + (num(kf.blur) ?? 0);
  out.skew_x = base.skew_x + (num(kf.skew_x) ?? 0);
  out.skew_y = base.skew_y + (num(kf.skew_y) ?? 0);
  for (const k of Object.keys(EXTRA_REST)) if (num(kf[k]) !== undefined) out.extra[k] = num(kf[k]) ?? 0;
  return out;
}

/** The pivot and wipe side a layer's presets need (grow_up pivots on its bottom edge), else the centre. */
function presetPlayback(changes: StateChange[]): { anchor: AnchorPoint; reveal_from?: RevealFrom } {
  let anchor: AnchorPoint | undefined, reveal: RevealFrom | undefined;
  for (const c of changes) {
    const p = c.state.enter ?? c.state.exit;
    if (!p) continue;
    const pb = expandPreset(p).playback;
    anchor = anchor ?? pb.anchor;
    reveal = reveal ?? pb.reveal_from;
  }
  return { anchor: anchor ?? 'center', ...(reveal ? { reveal_from: reveal } : {}) };
}

/** A preset segment's frames, starting at t0, laid over `base`. The frame before it holds, then cuts in. */
function pushPreset(frames: Frame[], t0: number, preset: MotionPreset, base: Pose, c: StateChange): { end: number; last: Pose } {
  const exp = expandPreset(preset, { ...(c.duration ? { duration: c.duration } : {}), ...(c.easing ? { easing: c.easing } : {}) });
  const prev = frames[frames.length - 1];
  if (prev && prev.t === t0) frames.pop(); else if (prev) prev.hold = true;
  let last = base;
  for (const kf of exp.keyframes) {
    last = compose(base, kf);
    frames.push({ t: t0 + kf.t, pose: last, ...(kf.easing || exp.playback.easing ? { easing: String(kf.easing ?? exp.playback.easing) } : {}) });
  }
  return { end: t0 + exp.playback.duration, last };
}

/**
 * One layer's changes of state as one track, plus the in/out window they imply:
 * a layer that starts hidden exists from its first entrance, one that ends
 * hidden is gone once it has left. `endMs` holds the last state to the scene's end.
 */
export function compileStates(layer: Layer, changes: StateChange[], endMs: number): CompiledStates {
  const id = layer.id;
  const notes: string[] = [];
  const box = drawnBox(layer);
  const sorted = [...changes].sort((a, b) => a.at - b.at);
  const { anchor, reveal_from } = presetPlayback(sorted);
  const o = layer as unknown as Record<string, unknown>;
  const stroke = o['stroke'] && typeof o['stroke'] === 'object' ? (o['stroke'] as { color?: unknown }).color : o['stroke'];
  let cur: Pose = { ...REST, extra: { ...EXTRA_REST },
    ...(typeof o['fill'] === 'string' ? { fill: o['fill'] } : {}), ...(typeof stroke === 'string' ? { stroke } : {}) };
  const first = sorted[0];
  const startsHidden = !!first && (first.state.enter !== undefined || (first.state.hidden === true && first.at === 0));
  if (startsHidden) cur = { ...cur, opacity: 0 };
  const frames: Frame[] = [{ t: 0, pose: cur }];
  let visibleFrom: number | undefined = startsHidden ? undefined : 0;
  let hiddenFrom: number | undefined;
  const landings: CompiledStates['landings'] = [];

  for (const c of sorted) {
    const lastT = frames[frames.length - 1]?.t ?? 0;
    let t0 = c.at;
    if (t0 < lastT) { notes.push(`${id}: the change at ${c.at}ms starts before the one before it ends (${lastT}ms), so it waits until then.`); t0 = lastT; }
    let to = t0;
    if (c.state.hidden && c.at === 0 && frames.length === 1 && !c.state.enter) {
      cur = landing(cur, c.state, box, anchor, notes, id);
      frames[0] = { t: 0, pose: cur };
    } else if (c.state.enter) {
      const target = landing(cur, { ...c.state, hidden: false }, box, anchor, notes, id);
      const seg = pushPreset(frames, t0, c.state.enter, target, c);
      cur = seg.last; to = seg.end;
      if (visibleFrom === undefined) visibleFrom = t0;
      hiddenFrom = undefined;
    } else if (c.state.exit) {
      const seg = pushPreset(frames, t0, c.state.exit, cur, c);
      cur = seg.last; to = seg.end;
      hiddenFrom = seg.end;
    } else {
      const next = landing(cur, c.state, box, anchor, notes, id);
      const easing = c.easing ?? 'ease-in-out-cubic';
      const prev = frames[frames.length - 1];
      if (prev && prev.t === t0) prev.easing = easing; else frames.push({ t: t0, pose: cur, easing });
      to = t0 + Math.max(1, c.duration ?? 700);
      frames.push({ t: to, pose: next });
      if (cur.opacity <= 0 && next.opacity > 0 && visibleFrom === undefined) visibleFrom = t0;
      hiddenFrom = next.opacity <= 0 ? to : undefined;
      cur = next;
    }
    landings.push({ at: t0, to, x: r2(cur.x), y: r2(cur.y), scale: r2(cur.scale_x), opacity: r2(cur.opacity) });
  }
  const tail = frames[frames.length - 1];
  if (tail && endMs > tail.t) frames.push({ t: endMs, pose: cur });
  if (frames.length === 1 && tail) frames.push({ t: Math.max(1, endMs), pose: cur });

  const keyframes = toKeyframes(frames);
  const duration = Math.max(1, keyframes[keyframes.length - 1]?.t ?? 1);
  const win: { in?: number; out?: number } = {};
  if (startsHidden && visibleFrom !== undefined && visibleFrom > 0) win.in = visibleFrom;
  if (hiddenFrom !== undefined && hiddenFrom > (win.in ?? 0)) win.out = hiddenFrom;
  return {
    animation: { keyframes, playback: { duration, origin: 'offset', easing: 'linear', anchor, ...(reveal_from ? { reveal_from } : {}) } },
    ...win, landings, notes,
  };
}

/** Frames as keyframes, carrying only the channels that ever leave rest. */
function toKeyframes(frames: Frame[]): Keyframe[] {
  const differs = (f: (p: Pose) => number, rest: number): boolean => frames.some(fr => Math.abs(f(fr.pose) - rest) > 1e-6);
  const plain: Array<[string, (p: Pose) => number, number]> = [
    ['x', p => p.x, 0], ['y', p => p.y, 0], ['rotation', p => p.rotation, 0], ['blur', p => p.blur, 0],
    ['skew_x', p => p.skew_x, 0], ['skew_y', p => p.skew_y, 0],
  ];
  const used = plain.filter(([, f, rest]) => differs(f, rest));
  const uneven = frames.some(fr => Math.abs(fr.pose.scale_x - fr.pose.scale_y) > 1e-6);
  if (uneven) used.push(['scale_x', p => p.scale_x, 1], ['scale_y', p => p.scale_y, 1]);
  else if (differs(p => p.scale_x, 1)) used.push(['scale', p => p.scale_x, 1]);
  used.push(['opacity', p => p.opacity, 1]);
  for (const [k, rest] of Object.entries(EXTRA_REST)) if (differs(p => p.extra[k] ?? rest, rest)) used.push([k, p => p.extra[k] ?? rest, rest]);
  const fills = new Set(frames.map(f => f.pose.fill)), strokes = new Set(frames.map(f => f.pose.stroke));
  return frames.map(fr => {
    const kf: Keyframe = { t: Math.round(fr.t) };
    for (const [k, f] of used) kf[k] = k === 'opacity' ? Math.min(1, Math.max(0, r2(f(fr.pose)))) : r2(f(fr.pose));
    if (fills.size > 1 && fr.pose.fill) kf['fill.color'] = fr.pose.fill;
    if (strokes.size > 1 && fr.pose.stroke) kf['stroke.color'] = fr.pose.stroke;
    if (fr.easing) kf.easing = fr.easing;
    if (fr.hold) kf.hold = true;
    return kf;
  });
}
