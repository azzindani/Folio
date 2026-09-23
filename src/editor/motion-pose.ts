/**
 * The per-page player's frames and the timeline's clock — taken from the
 * EXPORT, not re-derived.
 *
 * The player used to pose layers with its own interpolation: x, y, opacity,
 * rotation, skew and blur, from each track's keyframes alone. It ignored
 * delays, loops, precomp clocks, links and in/out windows, and it never drew a
 * scale, a reveal, a draw or a morph — so a storyboard or a camera push-in
 * previewed as something the export never renders. A frame here is
 * `layersAt(layers, t)`, the flipbook's own sampler over the resolved
 * timeline; the player copies the fields it changed into the editor's state.
 *
 * Loaded on first use: the sampler pulls in the path, morph and reveal code,
 * and the main bundle is at its budget.
 */

import type { Layer } from '../schema/types';
import type { AnimationSpec, Keyframe, LayerClock, LayerLink } from '../animation/types';
import { layersAt, animationDuration } from '../export/gif-frames';
import { PREVIEW_FRAME_MS } from '../export/motion-blur';
import { resolveTimeline } from '../animation/timeline-resolve';
import { windowOf, type LifeWindow } from '../animation/lifespan';
import { toSceneTime } from '../animation/clock-time';

/**
 * Every field a sampled frame can change on a layer. Captured before the first
 * pose, put back on stop. `motion_path` is lifted while posed: the canvas SVG
 * plays <animateMotion> by itself, and on top of the frame's own offset along
 * the path the layer would travel twice as far.
 */
export const POSE_FIELDS = [
  'transform', 'opacity', 'effects', 'visible', 'fill', 'stroke',
  'stroke_dasharray', 'stroke_dashoffset', 'clip_rect', 'd', 'content', 'tracking_offset', 'motion_path',
] as const;

export type Pose = Record<string, unknown>;

/** One layer's time, on the scene clock — what the timeline draws. */
export interface RowTiming {
  /** Scene time of each authored keyframe, in the authored array's order. */
  keys: number[];
  /** Keyframe times of a track the layer plays but does not own (a link follower). */
  ghosts: number[];
  /** When the resolved track starts and stops moving; `end` is Infinity for a loop. */
  start: number;
  end: number;
  loop: boolean;
  /** The layer's in/out window, clipped to its ancestors'. */
  window: LifeWindow | null;
  link: { to: string; lag: number } | null;
  /** The precomp clocks around the layer, innermost first. */
  clocks: LayerClock[];
}

export interface PosePlan {
  /** The authored tree the plan was built from. Its identity keys the resolve cache. */
  layers: Layer[];
  /** Ids a frame writes: animated, travelling a path, or living in a window. */
  touched: string[];
  duration: number;
  rows: Map<string, RowTiming>;
}

type Node = Layer & { animation?: AnimationSpec; layers?: Layer[]; clock?: LayerClock; link?: LayerLink };

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * What the player and the timeline need from one authored page: the ids a frame
 * writes, the clip length the export uses, and every row's time on the scene
 * clock. Walks the authored tree beside the resolved one — the authored side
 * says which keyframes the user can edit, the resolved side when they play.
 */
export function buildPosePlan(layers: Layer[]): PosePlan {
  const byId = new Map<string, Node>();
  const index = (ls: Layer[]): void => {
    for (const l of ls) {
      byId.set(l.id, l as Node);
      const kids = (l as Node).layers;
      if (Array.isArray(kids)) index(kids);
    }
  };
  index(resolveTimeline(layers));

  const rows = new Map<string, RowTiming>();
  const touched: string[] = [];
  const walk = (ls: Layer[], clocks: LayerClock[]): void => {
    for (const l of ls) {
      const o = l as Node;
      const r = byId.get(o.id);
      rows.set(o.id, rowTiming(o, r, clocks));
      const path = r ? (r as unknown as Record<string, unknown>)['motion_path'] : undefined;
      if (r && (r.animation?.keyframes?.length || path || windowOf(r))) touched.push(o.id);
      // A precomp's clock retimes what is INSIDE it; its own track stays on the parent's clock.
      if (Array.isArray(o.layers)) walk(o.layers, o.clock ? [o.clock, ...clocks] : clocks);
    }
  };
  walk(layers, []);
  return { layers, touched, duration: Math.ceil(animationDuration(layers)), rows };
}

/** Every layer gets a row, still ones included: a click on its ruler still needs its clocks. */
function rowTiming(o: Node, r: Node | undefined, clocks: LayerClock[]): RowTiming {
  const anim = r?.animation;
  const window = r ? windowOf(r) : null;
  const link = o.link ? { to: o.link.to, lag: Math.max(0, num(o.link.lag) ?? 0) } : null;

  // A keyframe plays `delay + (t − first)` after its track starts — valuesAt's rule — then through each clock.
  const own = (o.animation?.keyframes ?? []) as Keyframe[];
  const first = own.length ? Math.min(...own.map(k => k.t)) : 0;
  const delay = num(o.animation?.playback?.delay) ?? 0;
  const keys = own.map(k => toSceneTime(delay + k.t - first, clocks));

  const played = [...(anim?.keyframes ?? [])].sort((a, b) => a.t - b.t);
  const pb = anim?.playback;
  let start = num(pb?.delay) ?? 0;
  const iterations = num(pb?.iterations) ?? 0;
  let loop = pb?.loop === true && iterations <= 0;
  let end = !played.length ? start : loop ? Infinity : start + (num(pb?.duration) ?? 1000) * (pb?.loop && iterations > 0 ? iterations : 1);
  const ghosts = own.length || !played.length ? [] : played.map(k => start + k.t - (played[0]?.t ?? 0));
  // A path is motion too: the stretch it travels, on the scene clock.
  const mp = r ? (r as unknown as Record<string, unknown>)['motion_path'] as { delay?: unknown; duration?: unknown; loop?: unknown } | undefined : undefined;
  if (mp && typeof mp === 'object') {
    const from = num(mp.delay) ?? 0;
    const to = mp.loop === true ? Infinity : from + (num(mp.duration) ?? 2000);
    start = played.length ? Math.min(start, from) : from;
    end = played.length ? Math.max(end, to) : to;
    loop = loop || mp.loop === true;
  }
  return { keys, ghosts, start, end, loop, window, link, clocks };
}

/**
 * The editor fields of every touched layer at `t`. A field the frame does not
 * set comes back undefined, which state.updateLayers removes — so a transform
 * put on at one moment comes off at the next.
 */
export function poseFrame(plan: PosePlan, t: number): Map<string, Pose> {
  const want = new Set(plan.touched);
  const out = new Map<string, Pose>();
  const walk = (ls: Layer[]): void => {
    for (const l of ls) {
      const o = l as unknown as Record<string, unknown>;
      if (want.has(l.id)) {
        const pose: Pose = {};
        for (const f of POSE_FIELDS) pose[f] = o[f];
        pose['motion_path'] = undefined;
        out.set(l.id, pose);
      }
      const kids = o['layers'];
      if (Array.isArray(kids)) walk(kids as Layer[]);
    }
  };
  // A 30 fps frame, so motion_blur layers smear here as they do in the export.
  walk(layersAt(plan.layers, t, PREVIEW_FRAME_MS));
  return out;
}

