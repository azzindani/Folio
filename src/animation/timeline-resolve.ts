/**
 * The composition's time structure, flattened onto one scene clock.
 *
 * A continuous piece nests time: a precomp group runs its own clock (start,
 * speed, loop), a wrapper follows another layer's track a beat later, and a
 * child cannot outlive the group it sits in. Neither player knows any of that.
 * This pass rewrites the tree so it does not have to: every track, in point
 * and out point comes back on the scene clock, links come back as ordinary
 * tracks, and windows come back already clipped to their ancestors'. The CSS
 * route and the flipbook both read the result, so they cannot disagree.
 *
 * A tree with none of these features is returned as the SAME array — no
 * copies, and callers that walk the original beside the result stay aligned.
 */

import type { Layer } from '../schema/types';
import type { AnimationSpec, Keyframe, LayerClock, LayerLink } from './types';
import { interpolateKeyframes } from './keyframe-engine';
import { windowOf, intersectWindows, type LifeWindow } from './lifespan';

type Node = Layer & { animation?: AnimationSpec; layers?: Layer[]; clock?: LayerClock; link?: LayerLink; in?: number; out?: number };

/** Channels a link follows when it names none: where the target goes and how it turns and grows. */
export const DEFAULT_LINK_CHANNELS = ['x', 'y', 'rotation', 'scale'] as const;
const META = new Set(['t', 'easing', 'hold', 'ambient']);
const RATIO = new Set(['scale', 'scale_x', 'scale_y', 'opacity']);

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// Sampling a 30 s piece resolves the same page once per frame; the page array is the key.
const CACHE = new WeakMap<Layer[], Layer[]>();

/** The layers with every clock, link and window resolved onto the scene clock. */
export function resolveTimeline(layers: Layer[]): Layer[] {
  const hit = CACHE.get(layers);
  if (hit) return hit;
  if (!usesTimeFeatures(layers)) { CACHE.set(layers, layers); return layers; }
  const out = applyWindows(applyLinks(layers.map(l => applyClocks(l as Node))), null);
  CACHE.set(layers, out);
  CACHE.set(out, out);
  return out;
}

/** True when any layer carries a clock, a link or an in/out point. */
export function usesTimeFeatures(layers: Layer[]): boolean {
  return layers.some(l => {
    const o = l as Node;
    if (o.clock || o.link || num(o.in) !== undefined || num(o.out) !== undefined) return true;
    return Array.isArray(o.layers) && usesTimeFeatures(o.layers);
  });
}

// ── Precomp clocks ───────────────────────────────────────────

/** Resolve inner clocks first, so an outer clock retimes tracks that are already on its own time. */
function applyClocks(l: Node): Node {
  if (!Array.isArray(l.layers)) return l;
  let kids = l.layers.map(k => applyClocks(k as Node));
  const { clock, ...rest } = l;
  if (clock) kids = kids.map(k => retimeDeep(k, clock));
  return { ...rest, layers: kids } as Node;
}

function retimeDeep(l: Node, clock: LayerClock): Node {
  const start = num(clock.start) ?? 0;
  const speed = (num(clock.speed) ?? 1) > 0 ? (num(clock.speed) ?? 1) : 1;
  const out: Node = { ...l };
  if (l.animation?.keyframes?.length) out.animation = retimeTrack(l.animation, start, speed, num(clock.loop));
  // A path travels on the precomp's clock too: set off later, cover it faster. In a looping
  // precomp a one-shot path runs every pass — waits its delay, travels, rests at the end — as
  // a one-shot track is cycled; a path that loops by itself is left to its own loop.
  const mp = (l as unknown as Record<string, unknown>)['motion_path'] as { delay?: unknown; duration?: unknown; loop?: unknown; period?: unknown; offset?: unknown } | undefined;
  if (mp && typeof mp === 'object') {
    const d = num(mp.delay) ?? 0, dur = (num(mp.duration) ?? 2000) / speed, loopMs = num(clock.loop);
    const period = num(mp.period), offset = num(mp.offset);
    (out as unknown as Record<string, unknown>)['motion_path'] = loopMs && loopMs > 0 && mp.loop !== true
      ? { ...mp, loop: true, delay: start, duration: dur, period: loopMs / speed, offset: d / speed }
      : { ...mp, delay: start + d / speed, duration: dur,
        ...(period !== undefined ? { period: period / speed } : {}), ...(offset !== undefined ? { offset: offset / speed } : {}) };
  }
  const w = windowOf(l);
  if (w) {
    out.in = start + w.in / speed;
    if (Number.isFinite(w.out)) out.out = start + w.out / speed; else delete out.out;
  }
  if (Array.isArray(l.layers)) out.layers = l.layers.map(k => retimeDeep(k as Node, clock));
  return out;
}

/** A track from a precomp's local clock onto its parent's: cycled when the precomp loops, then shifted and scaled. */
export function retimeTrack(anim: AnimationSpec, start: number, speed: number, loopMs?: number): AnimationSpec {
  const base = loopMs && loopMs > 0 && anim.playback?.loop !== true ? cycleTrack(anim, loopMs) : anim;
  const pb = base.playback ?? { duration: 1000 };
  return {
    ...base,
    keyframes: (base.keyframes ?? []).map(k => ({ ...k, t: k.t / speed })),
    playback: { ...pb, duration: pb.duration / speed, delay: start + (pb.delay ?? 0) / speed },
  };
}

/** A one-shot track as one cycle of `period` local ms: held at its first pose until it starts, cut at the period. */
function cycleTrack(anim: AnimationSpec, period: number): AnimationSpec {
  const pb = anim.playback ?? { duration: 1000 };
  const sorted = [...(anim.keyframes ?? [])].sort((a, b) => a.t - b.t);
  const first = sorted[0];
  if (!first) return anim;
  const delay = pb.delay ?? 0;
  const abs: Keyframe[] = sorted.map(k => ({ ...k, t: delay + (k.t - first.t) }));
  const values = (k: Keyframe): Keyframe => Object.fromEntries(Object.entries(k).filter(([key]) => !META.has(key))) as Keyframe;
  const frames: Keyframe[] = abs.filter(k => k.t <= period);
  if (abs[0] && abs[0].t > 0) frames.unshift({ ...values(abs[0]), t: 0, easing: 'linear' });
  const last = frames[frames.length - 1];
  if (abs.some(k => k.t > period)) {
    frames.push({ ...(interpolateKeyframes(abs, period, pb.easing) as Keyframe), t: period });
  } else if (last && last.t < period) {
    frames.push({ ...values(last), t: period });
  }
  const { iterations: _i, direction: _d, delay: _delay, ...keep } = pb;
  void _i; void _d; void _delay;
  return { ...anim, keyframes: frames, playback: { ...keep, duration: period, loop: true } };
}

// ── Links ────────────────────────────────────────────────────

/** Every layer by id, anywhere in the tree. */
function indexById(layers: Layer[], into = new Map<string, Node>()): Map<string, Node> {
  for (const l of layers) {
    const o = l as Node;
    if (typeof o.id === 'string') into.set(o.id, o);
    if (Array.isArray(o.layers)) indexById(o.layers, into);
  }
  return into;
}

/** Fill every linked layer that has no track of its own with the track it follows. */
function applyLinks(layers: Layer[]): Layer[] {
  const byId = indexById(layers);
  const memo = new Map<string, AnimationSpec | undefined>();
  const trackOf = (id: string, seen: Set<string>): AnimationSpec | undefined => {
    if (memo.has(id)) return memo.get(id);
    const node = byId.get(id);
    let anim = node?.animation?.keyframes?.length ? node.animation : undefined;
    // A follower of a follower: resolve the chain, refusing to loop back on itself.
    if (!anim && node?.link && !seen.has(id)) {
      const target = trackOf(node.link.to, new Set([...seen, id]));
      anim = target ? followTrack(target, node.link) : undefined;
    }
    memo.set(id, anim);
    return anim;
  };
  const walk = (ls: Layer[]): Layer[] => ls.map(l => {
    const o = l as Node;
    if (!o.link && !Array.isArray(o.layers)) return l;
    const { link, ...rest } = o;
    const out: Node = { ...rest } as Node;
    if (link && !o.animation?.keyframes?.length) {
      const anim = trackOf(o.id, new Set());
      if (anim) out.animation = anim;
    }
    if (Array.isArray(o.layers)) out.layers = walk(o.layers);
    return out;
  });
  return walk(layers);
}

/**
 * The target's track as its follower plays it: the named channels only, `lag`
 * ms later, each channel's travel scaled by `factor` (0.5 = half as far, the
 * drag of a trailing element). Travel is measured from rest — 0 for offsets
 * and angles, 1 for scale and opacity, the first frame for an origin:first x/y.
 */
export function followTrack(anim: AnimationSpec, link: LayerLink): AnimationSpec | undefined {
  const channels = link.channels && link.channels.length > 0 ? link.channels : [...DEFAULT_LINK_CHANNELS];
  const factor = num(link.factor) ?? 1;
  const lag = Math.max(0, num(link.lag) ?? 0);
  const sorted = [...(anim.keyframes ?? [])].sort((a, b) => a.t - b.t);
  const first = sorted[0];
  if (!first) return undefined;
  const firstOrigin = (anim.playback?.origin ?? 'first') === 'first';
  let any = false;
  const keyframes = sorted.map(k => {
    const out: Keyframe = { t: k.t };
    if (k.easing !== undefined) out.easing = k.easing;
    if (k.hold !== undefined) out.hold = k.hold;
    for (const ch of channels) {
      const v = num(k[ch]);
      if (v === undefined) continue;
      const rest = RATIO.has(ch) ? 1 : firstOrigin && (ch === 'x' || ch === 'y') ? (num(first[ch]) ?? 0) : 0;
      const scaled = rest + (v - rest) * factor;
      out[ch] = ch === 'opacity' ? Math.min(1, Math.max(0, scaled)) : scaled;
      any = true;
    }
    return out;
  });
  if (!any) return undefined;
  const pb = anim.playback ?? { duration: Math.max(1, (sorted[sorted.length - 1]?.t ?? 1) - first.t) };
  return { keyframes, playback: { ...pb, delay: (pb.delay ?? 0) + lag } };
}

// ── Windows ──────────────────────────────────────────────────

/** Clip every window to its ancestors' — a child shown while its group is gone would float free in CSS. */
function applyWindows(layers: Layer[], parent: LifeWindow | null): Layer[] {
  return layers.map(l => {
    const o = l as Node;
    const eff = intersectWindows(parent, windowOf(o));
    if (!eff && !Array.isArray(o.layers)) return l;
    const out: Node = { ...o };
    if (eff) {
      out.in = eff.in;
      if (Number.isFinite(eff.out)) out.out = eff.out; else delete out.out;
    }
    if (Array.isArray(o.layers)) out.layers = applyWindows(o.layers, eff);
    return out;
  });
}
