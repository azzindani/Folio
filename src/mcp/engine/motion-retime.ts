/**
 * Ripple time on a layer tree — the pure half of `animation(op:retime)`.
 *
 * Found live: the time-aware lint said six shots of a 57 s piece ran 0.5–0.8 s
 * short of reading time, and nothing could act on it short of re-blocking the
 * whole piece — every keyframe, in/out point, marker, camera shot and sound cue
 * after the shot sits at an absolute time. A ripple edit moves all of them at
 * once: open `by` ms at `at`, or close the `-by` ms after it.
 */

import type { Layer } from '../../schema/types';
import type { AnimationSpec, Keyframe, LayerClock } from '../../animation/types';

/** Open `by` ms at `at` (by > 0), or close the `-by` ms after it (by < 0). */
export interface Ripple { at: number; by: number }

export interface RippleReport {
  /** Layers with any time moved. */
  moved: Set<string>;
  /** Moves under way at `at`: they now run longer (or shorter). A hold that stretches is just a longer rest. */
  stretched: string[];
  /** What sits inside a closed span — the edit is refused while any remain. */
  blocked: string[];
  /** Crossing `at`, left as they were: a looping precomp, a path already travelling. */
  untouched: string[];
}

type Node = Layer & {
  animation?: AnimationSpec; layers?: Layer[]; clock?: LayerClock; in?: number; out?: number;
  motion_path?: { path: string; duration?: number; delay?: number; loop?: boolean };
};

export const emptyReport = (): RippleReport => ({ moved: new Set(), stretched: [], blocked: [], untouched: [] });

/**
 * A time on this clock after the ripple; null when a closed span swallows it.
 * Opening shifts `at` itself, so a shot's moves starting on the mark go with it.
 */
export function rippled(t: number, r: Ripple): number | null {
  if (r.by >= 0) return t >= r.at ? t + r.by : t;
  const end = r.at - r.by;
  if (t <= r.at) return t;
  return t >= end ? t + r.by : null;
}

const pose = (k: Keyframe): string =>
  JSON.stringify(Object.entries(k).filter(([key]) => key !== 't' && key !== 'easing' && key !== 'hold').sort());

/** Keyframe index ranges [a, b] whose segments are all a loop the layer rests in (storyboard `loop`, unrolled). */
function ambientRuns(sorted: Keyframe[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  sorted.forEach((k, i) => {
    if (!k.ambient || i + 1 >= sorted.length) return;
    const last = runs[runs.length - 1];
    if (last && last[1] === i) last[1] = i + 1; else runs.push([i, i + 1]);
  });
  return runs;
}

/**
 * A resting loop keeps its rhythm: an edit inside the run is spread over every
 * pass, not dumped into the one pass it lands in. Found live: six edits each
 * left a spinning gear one visibly slow turn. Returns the paced segment starts.
 */
function paceLoops(id: string, sorted: Keyframe[], scene: number[], moved: Array<number | null>, r: Ripple, rep: RippleReport): Set<number> {
  const paced = new Set<number>();
  for (const [a, b] of ambientRuns(sorted)) {
    const S = scene[a], E = scene[b];
    if (S === undefined || E === undefined || E <= S) continue;
    const inside = r.by > 0 ? S < r.at && r.at < E : S <= r.at && r.at - r.by <= E;
    // Closing more than half the run would race it; that one is refused as a keyframe inside.
    if (!inside || E - S + r.by < (E - S) / 2) continue;
    const k = (E - S + r.by) / (E - S);
    for (let i = a + 1; i <= b; i++) moved[i] = Math.round(S + ((scene[i] ?? S) - S) * k);
    for (let i = a; i < b; i++) paced.add(i);
    rep.stretched.push(`${id} loop ${S}–${E}ms → ${S}–${E + r.by}ms (each pass ×${k.toFixed(2)})`);
  }
  return paced;
}

/** A track after the ripple, on the clock its delay is written on. */
export function rippleTrack(id: string, anim: AnimationSpec, r: Ripple, rep: RippleReport): AnimationSpec {
  const pb = anim.playback;
  const frames = anim.keyframes;
  if (!pb || !frames?.length) return anim;
  const delay = pb.delay ?? 0;
  if (pb.loop) {
    const d = rippled(delay, r);
    if (d === null) { rep.blocked.push(`${id} (a loop starts inside)`); return anim; }
    if (d === delay) return anim;
    rep.moved.add(id);
    return { ...anim, playback: { ...pb, delay: d } };
  }
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const f0 = sorted[0]?.t ?? 0;
  const scene = sorted.map(k => delay + k.t - f0);
  const end = delay + (pb.duration ?? (sorted[sorted.length - 1]?.t ?? f0) - f0);
  // Opening exactly where a move LANDS leaves the landing where it is: the time
  // opens after it. Found live: a hold opened at 1200 ms, where a fade finished,
  // stretched the 600 ms fade to 4.6 s ("under way" — it had just ended).
  const moves = (i: number): boolean => {
    const p = sorted[i], q = sorted[i + 1];
    return Boolean(p && q && !p.hold && pose(p) !== pose(q));
  };
  const moved = scene.map((s, i) => (r.by > 0 && s === r.at && i > 0 && moves(i - 1) && !moves(i) ? s : rippled(s, r)));
  const paced = paceLoops(id, sorted, scene, moved, r, rep);
  const endAt = rippled(end, r);
  const first = moved[0];
  if (first === undefined || first === null || endAt === null || moved.some(m => m === null)) {
    rep.blocked.push(`${id} (a keyframe at ${scene.filter(s => rippled(s, r) === null).join(', ') || end}ms)`);
    return anim;
  }
  if (moved.every((m, i) => m === scene[i]) && endAt === end) return anim;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const p = sorted[i], q = sorted[i + 1], a = moved[i], b = moved[i + 1], sa = scene[i], sb = scene[i + 1];
    if (!p || !q || a == null || b == null || sa === undefined || sb === undefined || pose(p) === pose(q) || p.hold || paced.has(i)) continue;
    if (b === a) { rep.blocked.push(`${id} (moves ${sa}–${sb}ms)`); return anim; }
    if (b - a !== sb - sa) rep.stretched.push(`${id} ${sa}–${sb}ms → ${a}–${b}ms`);
  }
  rep.moved.add(id);
  return {
    ...anim,
    keyframes: sorted.map((k, i) => ({ ...k, t: f0 + ((moved[i] ?? first) - first) })),
    playback: { ...pb, delay: first, duration: endAt - first },
  };
}

/** One in/out point after the ripple — undefined stays unset. */
function point(l: Node, key: 'in' | 'out', r: Ripple, rep: RippleReport): number | undefined {
  const v = l[key];
  if (typeof v !== 'number') return v;
  const t = rippled(v, r);
  if (t === null) { rep.blocked.push(`${l.id}.${key} (${v}ms)`); return v; }
  if (t !== v) rep.moved.add(l.id);
  return t;
}

function ripplePath(l: Node, r: Ripple, rep: RippleReport): Node['motion_path'] {
  const mp = l.motion_path;
  if (!mp) return mp;
  const d = mp.delay ?? 0;
  const t = rippled(d, r);
  if (t === null) { rep.blocked.push(`${l.id} (its path sets off inside)`); return mp; }
  if (t !== d) { rep.moved.add(l.id); return { ...mp, delay: t }; }
  if (!mp.loop && d + (mp.duration ?? 2000) > r.at) rep.untouched.push(`${l.id} (its path is travelling at ${r.at}ms)`);
  return mp;
}

/**
 * Children of a precomp run on its clock: a ripple before it starts moves the
 * start and nothing inside; one after it starts reaches inside, on local time.
 * A looping precomp repeats its sub-sequence, so it has no one place to cut.
 */
function rippleKids(l: Node, r: Ripple, rep: RippleReport): Pick<Node, 'clock' | 'layers'> {
  const kids = l.layers;
  const clock = l.clock;
  if (!clock) return { clock, layers: Array.isArray(kids) ? rippleLayers(kids, r, rep) : kids };
  const start = clock.start ?? 0;
  const t = rippled(start, r);
  if (t === null) { rep.blocked.push(`${l.id} (its precomp starts inside)`); return { clock, layers: kids }; }
  if (t !== start) { rep.moved.add(l.id); return { clock: { ...clock, start: t }, layers: kids }; }
  if (!Array.isArray(kids)) return { clock, layers: kids };
  if (clock.loop) { rep.untouched.push(`${l.id} (a looping precomp)`); return { clock, layers: kids }; }
  const speed = (clock.speed ?? 1) > 0 ? (clock.speed ?? 1) : 1;
  return { clock, layers: rippleLayers(kids, { at: (r.at - start) * speed, by: r.by * speed }, rep) };
}

/** Every track, window, path and precomp start in the tree, rippled. */
export function rippleLayers(layers: Layer[], r: Ripple, rep: RippleReport): Layer[] {
  return layers.map(layer => {
    const l = layer as Node;
    const out: Node = { ...l };
    if (l.animation?.keyframes?.length) out.animation = rippleTrack(l.id, l.animation, r, rep);
    if (typeof l.in === 'number') out.in = point(l, 'in', r, rep);
    if (typeof l.out === 'number') out.out = point(l, 'out', r, rep);
    if (l.motion_path) out.motion_path = ripplePath(l, r, rep);
    if (Array.isArray(l.layers) || l.clock) {
      const { clock, layers: kids } = rippleKids(l, r, rep);
      if (clock) out.clock = clock;
      if (kids) out.layers = kids;
    }
    return out as Layer;
  });
}
