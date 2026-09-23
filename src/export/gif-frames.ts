/**
 * Sampling a design's animation into discrete frames.
 *
 * The animated-SVG export hands motion to the browser as CSS. A GIF has no
 * such luxury: it is a flipbook, so every moment has to be materialised as a
 * still design and rasterised. This module does the materialising — given a
 * design and a time, it returns a spec whose layers sit where the animation
 * would have put them at that instant.
 */

import type { DesignSpec, Layer } from '../schema/types';
import type { AnimationSpec, Keyframe } from '../animation/types';
import { interpolateKeyframes } from '../animation/keyframe-engine';
import { opacityBase } from '../animation/opacity-base';
import { samplePath, type SampledPath } from '../animation/motion-path';
import { pathAt } from '../animation/path-ease';
import { roundedRectPath } from '../renderer/layer-renderers-shared';
import { clipRectFor, intersectRect } from '../renderer/clip-rect';
import { revealRect } from '../animation/reveal';
import { countText } from '../animation/count';
import { morphPairCached, morphPathAt } from '../engine/path-ops';
import { videoSourceMs, type VideoTiming } from '../animation/video-time';
import { drawnBox } from './frame-geometry';
import { poseTransform, FRAME_POSE, REST_POSE, type FramePose } from './frame-pose';
import { resolveTimeline } from '../animation/timeline-resolve';
import { windowOf, aliveAt, windowEnd } from '../animation/lifespan';

const fmt = (n: number): string => String(Number(n.toFixed(3)));

type AnimatedLayer = Layer & { animation?: AnimationSpec; layers?: Layer[] };

/**
 * Total run length of a design's animation, ms.
 *
 * Looping layers set the cycle; one-shot entrances must be allowed to finish.
 * Taking the maximum of delay + duration across every layer means a stagger is
 * not cut off halfway, which is the obvious way to get a GIF that ends mid-move.
 */
export function animationDuration(layers: Layer[]): number {
  let total = 0;
  const visit = (l: AnimatedLayer): void => {
    // A layer that arrives at 12 s must be on screen before the clip ends.
    const w = windowOf(l);
    if (w) total = Math.max(total, windowEnd(w));
    const pb = l.animation?.playback;
    if (pb?.duration) {
      // An 'alternate' loop only returns to its start after TWO passes. Export
      // one pass and the GIF ends mid-swell, then snaps back to the beginning
      // on repeat — a visible jolt every cycle that the CSS version never has,
      // because the browser plays the return leg the flipbook never captured.
      const finite = pb.loop && pb.iterations && pb.iterations > 0 ? pb.iterations : undefined;
      const cycles = finite ?? (pb.loop && pb.direction === 'alternate' ? 2 : 1);
      total = Math.max(total, (pb.delay ?? 0) + pb.duration * cycles);
    }
    // A layer travelling a motion_path has no keyframes, so without this a
    // design animated ONLY by a path reported duration 0 and the flipbook
    // produced a single frame of it standing still.
    const mp = (l as unknown as Record<string, unknown>)['motion_path'] as MotionPath | undefined;
    if (mp?.path) total = Math.max(total, (mp.delay ?? 0) + (mp.loop && mp.period ? mp.period : mp.duration ?? 2000));
    // Footage moves by itself: a page whose only motion is a clip runs as long as the clip (one pass of a loop).
    const clip = clipEnd(l);
    if (clip !== null) total = Math.max(total, clip);
    if (Array.isArray(l.layers)) for (const c of l.layers) visit(c as AnimatedLayer);
  };
  // Precomp clocks and links change when tracks run: measure the resolved tree.
  for (const l of resolveTimeline(layers)) visit(l as AnimatedLayer);
  return total;
}

/**
 * When a scene's motion FINISHES: the latest end of every track that ends. An
 * endless loop (a wiggle, a float, a pulse) never finishes, so it does not push
 * the scene longer — found on the promo, where a 4 s wiggle on a chip stretched
 * its scene and raised a false "motion cut off" warning. A loop with a set
 * number of iterations does end, and counts. animationDuration stays the clip
 * length a single-page loop export needs, where a loop's cycle is the point.
 */
export function oneShotDuration(layers: Layer[]): number {
  let total = 0;
  const visit = (l: AnimatedLayer): void => {
    const w = windowOf(l);
    if (w) total = Math.max(total, windowEnd(w));
    const pb = l.animation?.playback;
    const endless = pb?.loop === true && !(pb.iterations && pb.iterations > 0);
    if (pb?.duration && !endless) total = Math.max(total, (pb.delay ?? 0) + pb.duration * (pb.loop && pb.iterations ? pb.iterations : 1));
    const mp = (l as unknown as Record<string, unknown>)['motion_path'] as MotionPath | undefined;
    if (mp?.path && !mp.loop) total = Math.max(total, (mp.delay ?? 0) + (mp.duration ?? 2000));
    // A looping clip never finishes, like any endless loop.
    const clip = (l as unknown as { video?: VideoTiming }).video?.loop ? null : clipEnd(l);
    if (clip !== null) total = Math.max(total, clip);
    if (Array.isArray(l.layers)) for (const c of l.layers) visit(c as AnimatedLayer);
  };
  for (const l of resolveTimeline(layers)) visit(l as AnimatedLayer);
  return total;
}

/** When a video layer's clip has played its used part, on the scene clock — null
 *  for anything else, or a clip whose length is not written (video-length.ts writes it). */
function clipEnd(l: AnimatedLayer): number | null {
  if (l.type !== 'video') return null;
  const v = (l as unknown as { in?: number; video?: VideoTiming }).video;
  const used = Number(v?.duration_ms);
  if (!(used > 0)) return null;
  const speed = Number(v?.speed) > 0 ? Number(v?.speed) : 1;
  return (Number((l as unknown as { in?: number }).in) || 0) + used / speed;
}

interface MotionPath { path: string; duration?: number; delay?: number; loop?: boolean; easing?: string; auto_rotate?: boolean; period?: number; offset?: number }

// Flattening a path costs a parse; the flipbook asks for the same one at every
// frame, so remember it. Keyed by the `d` string, which is what determines the
// answer.
const PATH_CACHE = new Map<string, SampledPath | null>();
function sampledPath(d: string): SampledPath | null {
  let hit = PATH_CACHE.get(d);
  if (hit === undefined) { hit = samplePath(d); PATH_CACHE.set(d, hit); }
  return hit;
}

/** Ramanujan's second approximation — within a few ppm for any ellipse a design uses. */
function ellipsePerimeter(a: number, b: number): number {
  if (a + b <= 0) return 0;
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

function polygonPerimeter(points: string): number {
  const n = (points.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  let total = 0;
  for (let i = 0; i + 1 < n.length; i += 2) {
    const j = (i + 2) % (n.length - (n.length % 2));
    total += Math.hypot(n[j] - n[i], n[j + 1] - n[i + 1]);
  }
  return total;
}

/**
 * Length of the outline `draw` reveals, measured the way the renderer draws it.
 *
 * The SVG route never needed a number: it stamps pathLength="1" on whatever
 * element the layer becomes (path, line, rect, ellipse, polygon) and lets the
 * browser measure. A still frame has to give the dash in pixels, and only
 * layers carrying a `d` were measured — so a `line`, the commonest thing anyone
 * draws on, stood complete from the first frame while the SVG drew it in.
 */
function strokeLength(layer: Layer): number | null {
  const r = layer as unknown as Record<string, unknown>;
  if (typeof r['d'] === 'string') return sampledPath(r['d'])?.length ?? null;
  const n = (k: string): number => num(r[k]) ?? 0;
  const w = n('width'), h = n('height');
  switch (r['type']) {
    case 'line':
      return Math.hypot(n('x2') - n('x1'), n('y2') - n('y1'));
    case 'rect': {
      const rad = r['radius'];
      if (rad && typeof rad === 'object') {
        // Per-corner radii render as the renderer's own quadratic path — measure that path.
        const c = rad as { tl: number; tr: number; br: number; bl: number };
        return sampledPath(roundedRectPath(0, 0, w, h, c))?.length ?? null;
      }
      // <rect rx> clamps each axis to half the side, then draws quarter-ellipse corners.
      const rx = Math.min(Math.max(num(rad) ?? 0, 0), w / 2);
      const ry = Math.min(Math.max(num(rad) ?? 0, 0), h / 2);
      return 2 * (w - 2 * rx) + 2 * (h - 2 * ry) + ellipsePerimeter(rx, ry);
    }
    case 'circle':
    case 'ellipse':
      return ellipsePerimeter(num(r['rx']) ?? w / 2, num(r['ry']) ?? h / 2);
    case 'polygon': {
      if (typeof r['points'] === 'string' && r['points'].trim()) return polygonPerimeter(r['points']);
      const sides = n('sides');
      return sides >= 3 ? sides * 2 * (Math.min(w, h) / 2) * Math.sin(Math.PI / sides) : null;
    }
    default:
      return null;
  }
}

/**
 * Offset a layer along its motion_path at time t.
 *
 * The SVG route hands this to the browser as <animateMotion>; nothing else
 * could read it, so every exported frame showed the layer parked at its
 * authored position. Same sampler for the frame op and the GIF, so the still
 * a model inspects is the still the export produces.
 */
export function applyMotionPath(layer: Layer, t: number): Layer {
  const mp = (layer as unknown as Record<string, unknown>)['motion_path'] as MotionPath | undefined;
  if (!mp?.path) return layer;
  const sp = sampledPath(mp.path);
  if (!sp) return layer;                       // unparseable — leave it where it is
  // Before it sets off the path adds nothing — SMIL applies no motion before `begin`.
  const u = pathAt(mp, t);
  if (u === null) return layer;
  const p = sp.at(u);
  const out = { ...layer } as Record<string, unknown>;
  // animateMotion TRANSLATES by the path point — the path is an offset from
  // where the layer already sits, not an absolute destination. It lands as the
  // OUTERMOST transform, so a line or a path travels too (they have no x/y).
  const parts = [`translate(${fmt(p.x)} ${fmt(p.y)})`];
  const box = mp.auto_rotate ? drawnBox(layer) : null;
  if (box) parts.push(`rotate(${fmt(p.angle)} ${fmt(box.x + box.width / 2)} ${fmt(box.y + box.height / 2)})`);
  const prior = typeof out['transform'] === 'string' ? out['transform'] : '';
  out['transform'] = prior ? `${parts.join(' ')} ${prior}` : parts.join(' ');
  const pose = (out[FRAME_POSE] as FramePose | undefined) ?? REST_POSE;
  out[FRAME_POSE] = { ...pose, dx: pose.dx + p.x, dy: pose.dy + p.y, rotation: pose.rotation + (box ? p.angle : 0) };
  return out as unknown as Layer;
}

/** Resolve a layer's animated values at time t, honouring delay and loop/alternate. */
export function valuesAt(anim: AnimationSpec, t: number): Record<string, number | string> {
  const frames = anim.keyframes;
  if (!frames || frames.length === 0) return {};
  const pb = anim.playback;
  const duration = pb?.duration ?? 1000;
  const delay = pb?.delay ?? 0;

  // Before its delay elapses a layer holds its first keyframe — CSS `both` fill
  // does the same, so the GIF matches what the SVG export shows.
  let local = t - delay;
  if (local <= 0) return interpolateKeyframes(frames, frames[0]?.t ?? 0, pb?.easing);

  if (pb?.loop) {
    const cycle = local % duration;
    const iteration = Math.floor(local / duration);
    // 'alternate' plays every odd cycle backwards; sampling it forwards would
    // show a snap-back the SVG version never has.
    local = pb.direction === 'alternate' && iteration % 2 === 1 ? duration - cycle : cycle;
  } else if (local > duration) {
    local = duration;
  }

  const first = frames[0]?.t ?? 0;
  return interpolateKeyframes(frames, first + local, pb?.easing);
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/**
 * Apply interpolated values to one layer.
 *
 * Position handling mirrors generateKeyframeCSS exactly, including the
 * `origin` convention — if the GIF and the SVG disagreed about where a layer
 * sits, the same design would animate two different ways depending on which
 * format you exported, which is worse than either being wrong.
 */
function applyValues(layer: AnimatedLayer, t: number): Layer {
  const anim = layer.animation;
  if (!anim?.keyframes || anim.keyframes.length === 0) return layer;

  const v = valuesAt(anim, t);
  const frames = [...anim.keyframes].sort((a, b) => a.t - b.t);
  const first: Keyframe = frames[0];
  const offsetOrigin = anim.playback?.origin === 'offset';

  const baseX = offsetOrigin ? 0 : (num(first.x) ?? 0);
  const baseY = offsetOrigin ? 0 : (num(first.y) ?? 0);

  const out = { ...layer } as Record<string, unknown>;

  // Offset, rotate, skew and scale land as ONE transform about the anchor of
  // what the layer draws — see frame-pose.ts for why not x/y/width/height.
  const vx = num(v['x']);
  const vy = num(v['y']);
  const vs = num(v['scale']) ?? 1;
  const pose: FramePose = {
    dx: vx !== undefined ? vx - baseX : 0,
    dy: vy !== undefined ? vy - baseY : 0,
    rotation: num(v['rotation']) ?? 0,
    // Non-uniform scale wins on its axis; a plain `scale` fills in the rest.
    scale_x: num(v['scale_x']) ?? vs,
    scale_y: num(v['scale_y']) ?? vs,
    skew_x: num(v['skew_x']) ?? 0,
    skew_y: num(v['skew_y']) ?? 0,
  };
  const tf = poseTransform(layer, pose, anim.playback?.pivot ?? anim.playback?.anchor);
  if (tf) {
    const prior = typeof out['transform'] === 'string' ? out['transform'] : '';
    out['transform'] = prior ? `${prior} ${tf}` : tf;
  }
  out[FRAME_POSE] = pose;

  const vo = num(v['opacity']);
  if (vo !== undefined) {
    // The track scales the authored opacity — and an authored 0 on a layer the
    // track fades is hidden-until-shown (opacity-base.ts, shared with the CSS).
    const base = opacityBase(layer['opacity' as keyof Layer], anim.keyframes as unknown as Array<Record<string, unknown>>);
    // An overshooting curve (pop = ease-out-back) swings past 1. The renderer
    // clamps it anyway, but op:frame reports this number as the pose.
    out['opacity'] = Math.min(1, Math.max(0, base * vo));
  }

  // Blur rides on the layer's effects, which the renderer turns into a filter.
  const vb = num(v['blur']);
  if (vb !== undefined && vb > 0) {
    const fx = (layer['effects' as keyof Layer] as Record<string, unknown> | undefined) ?? {};
    out['effects'] = { ...fx, blur: vb };
  }

  // Draw: reveal a stroke by dashing it with its own length and pulling the
  // offset back. Needs the path's real length, which is what the motion-path
  // sampler already measures — the same flattener, so a drawn line and a
  // travelled line agree about where "halfway" is.
  // draw_start trims the other end, so the visible run is draw_start → draw.
  const end = Math.min(1, Math.max(0, num(v['draw']) ?? 1));
  const start = Math.min(1, Math.max(0, num(v['draw_start']) ?? 0));
  if (end < 1 || start > 0) {
    const len = strokeLength(layer);
    if (len !== null && len > 0) {
      // Offset against the SAME rounded dash, so draw:0 hides the stroke
      // entirely instead of leaving the sub-pixel remainder showing.
      const dash = Math.ceil(len);
      if (start > 0) {
        // A dash as long as the run, a gap as long as the path, pulled forward to start.
        out['stroke_dasharray'] = `${Math.round(dash * Math.max(0, end - start))} ${dash}`;
        out['stroke_dashoffset'] = -Math.round(dash * start);
      } else {
        out['stroke_dasharray'] = dash;
        out['stroke_dashoffset'] = Math.round(dash * (1 - end));
      }
    }
  }

  // Reveal: a wipe as a clip on the layer's own element, so it travels with the
  // pose above — the same rectangle keyframe-css draws as clip-path: inset().
  const vr = num(v['reveal']);
  const box = vr !== undefined && vr < 1 ? drawnBox(layer) : null;
  const wipe = box && vr !== undefined ? revealRect(box, vr, anim.playback?.reveal_from) : null;
  if (wipe) out['clip_rect'] = intersectRect(clipRectFor(layer), wipe);

  // Morph: the outline part-way to morph_to. Clamped, as the CSS route is — an
  // overshooting curve would otherwise push the shape past its target.
  const vm = num(v['morph']);
  const from = layer['d' as keyof Layer], to = layer['morph_to' as keyof Layer];
  if (vm !== undefined && vm > 0 && typeof from === 'string' && typeof to === 'string') {
    const pair = morphPairCached(from, to);
    if (pair) out['d'] = morphPathAt(pair, Math.min(1, vm));
  }

  // Count: the figure in the text at this fraction, in its own written format.
  const vc = num(v['count']);
  const words = layer['content' as keyof Layer] as { type?: string; value?: unknown } | undefined;
  if (vc !== undefined && vc < 1 && typeof words?.value === 'string' && (words.type ?? 'plain') === 'plain') {
    out['content'] = { ...words, value: countText(words.value, vc) };
  }

  // Tracking: spacing added at draw time only, so the lines keep their wrap.
  const vt = num(v['tracking']);
  if (vt !== undefined && vt !== 0) out['tracking_offset'] = vt;

  const fill = v['fill.color'];
  if (typeof fill === 'string') out['fill'] = fill;
  const stroke = v['stroke.color'];
  if (typeof stroke === 'string') {
    const st = layer['stroke' as keyof Layer];
    out['stroke'] = st && typeof st === 'object' ? { ...(st as Record<string, unknown>), color: stroke } : stroke;
  }

  delete out['animation']; // the still frame has no timeline of its own
  return out as unknown as Layer;
}

/**
 * Recursively resolve every animated layer at time t.
 *
 * A group's pose is a transform on its own `<g>`, so its children follow it in
 * the render exactly as they do in the browser. This used to push a group's
 * scale and offset down into each child's x/y/width/height — which moved only
 * children that HAVE x/y, and scaled no text — so a card with a connector and
 * a caption fell apart in every GIF.
 */
export function layersAt(layers: Layer[], t: number): Layer[] {
  // Clocks, links and windows first — once per page, cached — so the flipbook
  // plays exactly the tracks the CSS route is generated from.
  return sampleLayers(resolveTimeline(layers), t);
}

function sampleLayers(layers: Layer[], t: number): Layer[] {
  return layers.map(l => {
    const layer = l as AnimatedLayer;
    // Outside its in/out window the layer is not there. It stays in the tree,
    // hidden, so readouts keep their place; the raster cull drops it, and its
    // children are never sampled.
    if (!aliveAt(layer, t)) {
      const { animation: _a, ...rest } = layer;
      void _a;
      return { ...rest, visible: false } as Layer;
    }
    const resolved = applyMotionPath(applyValues(layer, t), t) as AnimatedLayer;
    // A clip shows the moment of its file that t lands on (video-time.ts).
    if (layer.type === 'video') {
      const v = layer as unknown as { in?: number; video?: VideoTiming };
      return { ...resolved, _video_ms: videoSourceMs(t, v.in, v.video) } as unknown as Layer;
    }
    if (!Array.isArray(layer.layers)) return resolved;
    return { ...resolved, layers: sampleLayers(layer.layers, t) } as Layer;
  });
}

/** A design as it appears at time t — ready to hand to the ordinary render path. */
export function specAt(spec: DesignSpec, pageIndex: number, t: number): DesignSpec {
  const pages = spec.pages;
  if (pages && pages.length > 0) {
    const idx = Math.min(Math.max(pageIndex, 0), pages.length - 1);
    const page = pages[idx];
    return { ...spec, pages: [{ ...page, layers: layersAt(page.layers ?? [], t) }] };
  }
  return { ...spec, layers: layersAt(spec.layers ?? [], t) };
}

/** Evenly spaced sample times covering one full run. */
export function frameTimes(durationMs: number, fps: number): number[] {
  const count = Math.max(1, Math.round((durationMs / 1000) * fps));
  const step = durationMs / count;
  return Array.from({ length: count }, (_, i) => Math.round(i * step));
}
