// A transition between two clips on a main track, compiled into what every
// player already plays.
//
// `video.transition` on a clip says how it ENTERS from the clip that ends where
// it starts. Nothing downstream learns a new feature: this pass, run first in
// resolveTimeline, widens the two clips over the cut — the outgoing one plays on
// past it, the incoming one starts before it, from the file's own footage — and
// writes ordinary keys on them: opacity (crossfade, dip through a colour rect),
// `reveal` (wipe) or an x offset (push). Their sounds crossfade over the same
// window. The cut stays where it was, so nothing after it moves.

import type { Layer } from '../schema/types';
import type { AnimationSpec, Keyframe } from './types';
import { naturalLength, edgeRates, shiftRamp } from './video-time';

export type ClipTransitionType = 'crossfade' | 'dip' | 'wipe' | 'push';
export interface ClipTransition { type: ClipTransitionType; duration_ms?: number; color?: string; direction?: 'left' | 'right' | 'up' | 'down' }
export const TRANSITION_TYPES: readonly ClipTransitionType[] = ['crossfade', 'dip', 'wipe', 'push'];
export const DEFAULT_TRANSITION_MS = 500;
export const MIN_TRANSITION_MS = 100;
/** A clip follows another when it starts within this of where the other stops (one frame at 25 fps). */
export const JOIN_MS = 40;

type Clip = Layer & {
  in?: number; out?: number; z?: number; x?: number; y?: number; width?: number; height?: number; animation?: AnimationSpec; layers?: Layer[];
  video?: { offset_ms?: number; duration_ms?: number; speed?: number; loop?: boolean; fade_in_ms?: number; fade_out_ms?: number; transition?: ClipTransition };
};

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Where a clip plays on its list's clock: [from, until); until null when it plays on unbounded. */
export function clipPlays(layer: Layer): { from: number; until: number | null } {
  const c = layer as Clip;
  const from = num(c.in) ?? 0;
  const length = naturalLength(c.video);
  const natural = length !== null ? from + length : null;
  const out = num(c.out);
  const until = natural !== null && out !== undefined ? Math.min(natural, out) : natural ?? out ?? null;
  return { from, until };
}

/** The clip in `list` that ends where `c` starts — the one `c`'s transition comes from. */
export function predecessorOf(list: Layer[], c: Layer): Layer | null {
  const from = clipPlays(c as Clip).from;
  let best: Layer | null = null, gap = Infinity;
  for (const o of list) {
    if (o === c || o.type !== 'video') continue;
    const until = clipPlays(o as Clip).until;
    if (until === null) continue;
    const d = Math.abs(until - from);
    if (d <= JOIN_MS && d < gap) { best = o; gap = d; }
  }
  return best;
}

/** True when any clip in the tree asks for a transition. */
export function usesClipTransitions(layers: Layer[]): boolean {
  return layers.some(l => Boolean((l as Clip).video?.transition) || (Array.isArray((l as Clip).layers) && usesClipTransitions((l as Clip).layers ?? [])));
}

/** The window a transition plays over, [cut − before, cut + after]: `before` uses the incoming file's footage ahead of its offset. */
export function transitionWindow(a: Layer, b: Layer, t: ClipTransition): { cut: number; before: number; after: number } | null {
  const A = clipPlays(a as Clip), B = clipPlays(b as Clip);
  const cut = B.from;
  const d = Math.min(Math.max(MIN_TRANSITION_MS, num(t.duration_ms) ?? DEFAULT_TRANSITION_MS), cut - A.from, (B.until ?? Infinity) - cut);
  if (!(d >= MIN_TRANSITION_MS)) return null;
  // Footage ahead of the incoming clip's offset, in scene ms (a still's one frame has no limit).
  const rate = edgeRates((b as Clip).video, 0).file;
  const head = rate > 0 ? (num((b as Clip).video?.offset_ms) ?? 0) / rate : Infinity;
  const before = Math.round(Math.min(d / 2, head));
  return { cut, before, after: Math.round(d - before) };
}

/** The outgoing clip plays on `after` ms, the incoming starts `before` ms early — same frames at the cut; sounds crossfade over the window. */
function widen(a: Clip, b: Clip, w: { cut: number; before: number; after: number }): void {
  const d = w.before + w.after;
  // At each edge the clip runs at the speed it has there (a ramp), or holds its frame (a still): video-time.ts edgeRates.
  const ra = edgeRates(a.video, w.cut - (num(a.in) ?? 0)), rb = edgeRates(b.video, 0);
  const va = { ...(a.video ?? {}) };
  let vb = { ...(b.video ?? {}) };
  if (num(va.duration_ms) !== undefined) va.duration_ms = (num(va.duration_ms) ?? 0) + w.after * ra.length;
  if (num(a.out) !== undefined) a.out = Math.max(num(a.out) ?? 0, w.cut + w.after);
  b.in = w.cut - w.before;
  vb.offset_ms = Math.max(0, (num(vb.offset_ms) ?? 0) - w.before * rb.file);
  if (num(vb.duration_ms) !== undefined) vb.duration_ms = (num(vb.duration_ms) ?? 0) + w.before * rb.length;
  vb = shiftRamp(vb, w.before);
  va.fade_out_ms = Math.max(num(va.fade_out_ms) ?? 0, d);
  vb.fade_in_ms = Math.max(num(vb.fade_in_ms) ?? 0, d);
  a.video = va; b.video = vb;
}

interface Track { keyframes: Keyframe[]; reveal_from?: 'left' | 'right' | 'top' | 'bottom' }
const OPPOSITE = { left: 'right', right: 'left', up: 'bottom', down: 'top' } as const;
const SIDE = { left: 'left', right: 'right', up: 'top', down: 'bottom' } as const;

/** The keys each clip takes for one transition over [s, s + d], on the scene clock. `aTop`: the outgoing clip paints over the incoming. */
function tracksFor(t: ClipTransition, s: number, d: number, aTop: boolean, width: number, height: number): { a?: Track; b?: Track } {
  const k = (ms: number, v: Record<string, number | string>): Keyframe => ({ t: Math.round(s + ms), ...v }) as Keyframe;
  const dir = t.direction ?? 'left';
  switch (t.type) {
    case 'crossfade':
      return aTop ? { a: { keyframes: [k(0, { opacity: 1 }), k(d, { opacity: 0 })] } } : { b: { keyframes: [k(0, { opacity: 0 }), k(d, { opacity: 1 })] } };
    case 'dip':
      return { a: { keyframes: [k(0, { opacity: 1 }), k(d / 2, { opacity: 0 })] }, b: { keyframes: [k(d / 2, { opacity: 0 }), k(d, { opacity: 1 })] } };
    case 'wipe':
      // The edge travels toward `direction`: over the outgoing clip it shrinks toward that side; the incoming grows from the far one.
      return aTop
        ? { a: { keyframes: [k(0, { reveal: 1, easing: 'ease-in-out' }), k(d, { reveal: 0 })], reveal_from: SIDE[dir] } }
        : { b: { keyframes: [k(0, { reveal: 0, easing: 'ease-in-out' }), k(d, { reveal: 1 })], reveal_from: OPPOSITE[dir] } };
    case 'push': {
      const ch = dir === 'left' || dir === 'right' ? 'x' : 'y';
      const span = (ch === 'x' ? width : height) * (dir === 'left' || dir === 'up' ? -1 : 1);
      return { a: { keyframes: [k(0, { [ch]: 0, easing: 'ease-in-out' }), k(d, { [ch]: span })] }, b: { keyframes: [k(0, { [ch]: -span, easing: 'ease-in-out' }), k(d, { [ch]: 0 })] } };
    }
  }
}

const channels = (tr: Track): string => [...new Set(tr.keyframes.flatMap(k => Object.keys(k).filter(c => c !== 't' && c !== 'easing')))].sort().join(',') + `|${tr.reveal_from ?? ''}`;
/** A track in the players' form: keys from the first at t 0, played from `delay` (gif-frames valuesAt; the CSS route reads the same). */
const spec = (tr: Track): AnimationSpec => {
  const keys = [...tr.keyframes].sort((p, q) => p.t - q.t);
  const t0 = keys[0]?.t ?? 0, t1 = keys[keys.length - 1]?.t ?? t0;
  return {
    keyframes: keys.map(k => ({ ...k, t: k.t - t0 })),
    playback: { delay: t0, duration: Math.max(1, t1 - t0), origin: 'offset', ...(tr.reveal_from ? { reveal_from: tr.reveal_from } : {}) },
  } as AnimationSpec;
};

/** A clip with its transition tracks: tracks on one channel merge (in at its head, out at its tail); the first sits on the clip unless it moves already, the rest on wrappers. */
function dress(c: Clip, tracks: Track[]): Layer {
  const merged = new Map<string, Track>();
  for (const tr of tracks) {
    const key = channels(tr), had = merged.get(key);
    merged.set(key, had ? { ...had, keyframes: [...had.keyframes, ...tr.keyframes] } : tr);
  }
  let out: Layer = c;
  [...merged.values()].forEach((tr, n) => {
    if (n === 0 && !c.animation) { out = { ...c, animation: spec(tr) } as Layer; return; }
    out = { id: `${c.id}__tx${n}`, type: 'group', z: c.z ?? 1, x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0, layers: [out], animation: spec(tr) } as unknown as Layer;
  });
  return out;
}

type Plan = { a: number; b: number; t: ClipTransition; w: NonNullable<ReturnType<typeof transitionWindow>> };

/** Each transition of one list: which clips it joins and the window it plays over (read from the clips as authored). */
function plansOf(list: Layer[]): Plan[] {
  const plans: Plan[] = [];
  list.forEach((l, b) => {
    const t = (l as Clip).video?.transition;
    if (l.type !== 'video' || !t || !TRANSITION_TYPES.includes(t.type)) return;
    const prev = predecessorOf(list, l);
    const w = prev ? transitionWindow(prev, l, t) : null;
    if (prev && w) plans.push({ a: list.indexOf(prev), b, t, w });
  });
  return plans;
}

/** The colour a dip passes through: a rect over the incoming clip's box, behind both clips, for the window. */
function dipRect(A: Clip, B: Clip, p: Plan): Layer {
  const s = p.w.cut - p.w.before, d = p.w.before + p.w.after;
  return { id: `${B.id}__dip`, type: 'rect', z: Math.min(num(A.z) ?? 0, num(B.z) ?? 0), x: B.x ?? 0, y: B.y ?? 0, width: B.width ?? 0, height: B.height ?? 0,
    in: s, out: s + d, fill: { type: 'solid', color: p.t.color ?? '#000000' } } as unknown as Layer;
}

/**
 * The colour rects of a design's dip transitions, with the two clips each lies behind. The compiled timeline
 * carries them as layers; a player that draws the AUTHORED layers (the editor's canvas) needs them separately.
 */
export function dipUnderlays(layers: Layer[], nested = true): Array<{ rect: Layer; clips: [string, string] }> {
  const out: Array<{ rect: Layer; clips: [string, string] }> = [];
  const walk = (list: Layer[]): void => {
    for (const p of plansOf(list)) {
      const A = list[p.a] as Clip | undefined, B = list[p.b] as Clip | undefined;
      if (p.t.type === 'dip' && A && B) out.push({ rect: dipRect(A, B, p), clips: [A.id, B.id] });
    }
    if (nested) for (const l of list) { const kids = (l as Clip).layers; if (Array.isArray(kids)) walk(kids); }
  };
  walk(layers);
  return out;
}

/** The layers with every clip transition compiled in; the same array when there are none. Nested lists are done first. */
export function applyClipTransitions(layers: Layer[]): Layer[] {
  if (!usesClipTransitions(layers)) return layers;
  const list = layers.map(l => (Array.isArray((l as Clip).layers) ? ({ ...l, layers: applyClipTransitions((l as Clip).layers ?? []) } as Layer) : l));
  // Windows come from the clips as authored; widening then stacks (a clip can be both the end and the start of a transition).
  const plans = plansOf(list);
  if (!plans.length) return list;
  const work = list.map(l => (l.type === 'video' ? ({ ...l } as Clip) : (l as Clip)));
  const tracks = new Map<number, Track[]>();
  const dips: Array<{ at: number; rect: Layer }> = [];
  const add = (i: number, tr: Track | undefined): void => { if (tr) tracks.set(i, [...(tracks.get(i) ?? []), tr]); };
  for (const p of plans) {
    const A = work[p.a] as Clip, B = work[p.b] as Clip;
    widen(A, B, p.w);
    const zA = num(A.z) ?? 0, zB = num(B.z) ?? 0;
    const aTop = zA > zB || (zA === zB && p.a > p.b);
    const s = p.w.cut - p.w.before, d = p.w.before + p.w.after;
    const keys = tracksFor(p.t, s, d, aTop, num(B.width) ?? 0, num(B.height) ?? 0);
    add(p.a, keys.a); add(p.b, keys.b);
    if (p.t.type === 'dip') dips.push({ at: Math.min(p.a, p.b), rect: dipRect(A, B, p) });
  }
  const dressed: Layer[] = work.map((c, i) => (tracks.has(i) ? dress(c, tracks.get(i) ?? []) : c));
  for (const dip of [...dips].sort((p, q) => q.at - p.at)) dressed.splice(dip.at, 0, dip.rect);
  return dressed;
}

const DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export const MAX_TRANSITION_MS = 5000;

/** A transition as asked for, checked: the reason as a string when it cannot be used. */
export function readTransition(raw: unknown): ClipTransition | string {
  if (!raw || typeof raw !== 'object') return 'transition must be an object.';
  const r = raw as Record<string, unknown>;
  const type = r['type'];
  if (typeof type !== 'string' || !TRANSITION_TYPES.includes(type as ClipTransitionType)) return `Unknown transition type ${JSON.stringify(type)}.`;
  const t: ClipTransition = { type: type as ClipTransitionType };
  if (r['duration_ms'] !== undefined) {
    const d = r['duration_ms'];
    if (typeof d !== 'number' || !(d >= MIN_TRANSITION_MS && d <= MAX_TRANSITION_MS)) return `duration_ms ${String(d)} is out of range (${MIN_TRANSITION_MS}–${MAX_TRANSITION_MS}).`;
    t.duration_ms = Math.round(d);
  }
  if (r['color'] !== undefined) {
    if (typeof r['color'] !== 'string' || !/^#[0-9a-f]{6}$/i.test(r['color'])) return 'color must be a #rrggbb hex.';
    t.color = r['color'];
  }
  if (r['direction'] !== undefined) {
    if (!DIRECTIONS.includes(r['direction'] as typeof DIRECTIONS[number])) return `direction must be one of ${DIRECTIONS.join(', ')}.`;
    t.direction = r['direction'] as ClipTransition['direction'];
  }
  return t;
}
