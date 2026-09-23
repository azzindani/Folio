/**
 * Moving motion in time on the ruler: drag a keyframe to retime it, drag a
 * layer's bar to move all of its motion.
 *
 * A keyframe plays at `delay + (t − first)` on its layer's clock, then through
 * any precomp clocks (motion-pose.ts). So a drag is worked in the layer's own
 * clock: every keyframe's time there, the dragged one moved (kept between its
 * neighbours), then written back with `delay` at the earliest one — moving the
 * first keyframe no longer drags the rest along. A hold at the end of the
 * track's `duration` is kept. The bar moves `delay` alone.
 */

import type { AnimationSpec, Keyframe, LayerClock, TimeMarkers } from '../../animation/types';
import type { RowTiming } from '../../editor/motion-pose';
import { fromSceneTime } from '../../animation/clock-time';
import { follow } from './timeline-edit';
import { KF_RADIUS } from './timeline-track-view';

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Keyframe `index` (authored order) moved to scene ms `scene`, the track rewritten in its own clock. */
export function retimeKeyframe(anim: AnimationSpec, index: number, scene: number, clocks: LayerClock[]): AnimationSpec {
  const kfs = (anim.keyframes ?? []) as Keyframe[];
  const moving = kfs[index];
  if (!moving) return anim;
  const first = Math.min(...kfs.map(k => k.t)), last = Math.max(...kfs.map(k => k.t));
  const pb = anim.playback;
  const delay = num(pb?.delay);
  const local = kfs.map(k => delay + k.t - first);
  // Neighbours by time, so the keyframes keep their order.
  const before = kfs.filter((k, i) => i !== index && k.t < moving.t).map(k => delay + k.t - first);
  const after = kfs.filter((k, i) => i !== index && k.t > moving.t).map(k => delay + k.t - first);
  const lo = before.length ? Math.max(...before) + 1 : 0;
  const hi = after.length ? Math.min(...after) - 1 : Infinity;
  local[index] = Math.min(hi, Math.max(lo, Math.round(fromSceneTime(scene, clocks))));
  const start = Math.min(...local), end = Math.max(...local);
  const tail = pb ? Math.max(0, num(pb.duration) - (last - first)) : 0;
  return {
    ...anim,
    keyframes: kfs.map((k, i) => ({ ...k, t: (local[i] ?? 0) - start + first })),
    playback: { ...(pb ?? {}), delay: start, duration: end - start + tail },
  };
}

/** The whole track moved so its first keyframe plays at scene ms `scene`. */
export function moveTrack(anim: AnimationSpec, scene: number, clocks: LayerClock[]): AnimationSpec {
  const ts = (anim.keyframes ?? []).map(k => k.t);
  const span = ts.length ? Math.max(...ts) - Math.min(...ts) : 0;
  return { ...anim, playback: { ...(anim.playback ?? { duration: span }), delay: Math.max(0, Math.round(fromSceneTime(scene, clocks))) } };
}

/** What the drags need from the panel. */
export interface TimelineDragContext {
  duration: () => number;
  playhead: () => number;
  rows: () => Map<string, RowTiming> | null;
  markers: () => TimeMarkers;
  preview: (ms: number) => void;
  animationOf: (layerId: string) => AnimationSpec | undefined;
  /** Write one layer's new track — one undo step. */
  write: (layerId: string, anim: AnimationSpec) => void;
  /** The soundtrack's beats on this page's ruler. */
  beats?: () => number[];
}

/** A finished drag is not a click: the click it ends in would open the easing picker or add a keyframe. */
function swallowNextClick(): void {
  const eat = (e: Event): void => { e.stopPropagation(); e.preventDefault(); };
  window.addEventListener('click', eat, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 0);
}

/** Where things snap: the ends, the playhead, the markers, and every other keyframe on the ruler. */
function snapsFor(ctx: TimelineDragContext, skip: (layerId: string, i: number) => boolean): number[] {
  const keys: number[] = [];
  for (const [id, row] of ctx.rows() ?? new Map<string, RowTiming>()) row.keys.forEach((k, i) => { if (!skip(id, i)) keys.push(k); });
  return [0, ctx.duration(), ctx.playhead(), ...Object.values(ctx.markers()).filter((v): v is number => typeof v === 'number'), ...(ctx.beats?.() ?? []), ...keys];
}

export function bindTimelineDrags(body: HTMLElement, ctx: TimelineDragContext): void {
  const pct = (ms: number): number => (ms / Math.max(1, ctx.duration())) * 100;
  body.querySelectorAll<HTMLElement>('.tl-keyframe').forEach(el => {
    const id = el.dataset['layerId'] ?? '', i = Number(el.dataset['i']);
    const area = el.closest<HTMLElement>('.tl-track-area');
    el.addEventListener('pointerdown', e => {
      const row = ctx.rows()?.get(id), anim = ctx.animationOf(id);
      if (e.button !== 0 || !area || !row || !anim || !Number.isInteger(i)) return;
      follow(e, el, area, ctx, snapsFor(ctx, (lid, k) => lid === id && k === i),
        ms => { el.style.left = `calc(${pct(ms)}% - ${KF_RADIUS}px)`; },
        ms => { if (ms === null) return; swallowNextClick(); ctx.write(id, retimeKeyframe(anim, i, ms, row.clocks)); });
    });
  });
  body.querySelectorAll<HTMLElement>('.tl-bar').forEach(bar => {
    const id = bar.dataset['layerId'] ?? '';
    const area = bar.closest<HTMLElement>('.tl-track-area');
    bar.addEventListener('pointerdown', e => {
      const row = ctx.rows()?.get(id), anim = ctx.animationOf(id);
      if (e.button !== 0 || !area || !row || !anim) return;
      // Held anywhere along the bar, it is dropped — and snapped — by its start.
      const grip = e.clientX - bar.getBoundingClientRect().left;
      follow(e, bar, area, ctx, snapsFor(ctx, lid => lid === id),
        ms => { bar.style.left = `${pct(ms)}%`; },
        ms => { if (ms === null) return; swallowNextClick(); ctx.write(id, moveTrack(anim, ms, row.clocks)); },
        grip);
    });
  });
}
