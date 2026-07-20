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
    const pb = l.animation?.playback;
    if (pb?.duration) {
      // An 'alternate' loop only returns to its start after TWO passes. Export
      // one pass and the GIF ends mid-swell, then snaps back to the beginning
      // on repeat — a visible jolt every cycle that the CSS version never has,
      // because the browser plays the return leg the flipbook never captured.
      const cycles = pb.loop && pb.direction === 'alternate' ? 2 : 1;
      total = Math.max(total, (pb.delay ?? 0) + pb.duration * cycles);
    }
    if (Array.isArray(l.layers)) for (const c of l.layers) visit(c as AnimatedLayer);
  };
  for (const l of layers) visit(l as AnimatedLayer);
  return total;
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

  const vx = num(v['x']);
  const vy = num(v['y']);
  if (vx !== undefined) out['x'] = (num(layer['x' as keyof Layer]) ?? 0) + (vx - baseX);
  if (vy !== undefined) out['y'] = (num(layer['y' as keyof Layer]) ?? 0) + (vy - baseY);

  const vo = num(v['opacity']);
  if (vo !== undefined) {
    const existing = num(layer['opacity' as keyof Layer]);
    out['opacity'] = (existing ?? 1) * vo;
  }

  const vr = num(v['rotation']);
  if (vr !== undefined) out['rotation'] = (num(layer['rotation' as keyof Layer]) ?? 0) + vr;

  // Scale is expressed by resizing about the centre, because the layer schema
  // has width/height rather than a transform — growing from the top-left would
  // read as a slide rather than a swell.
  const vs = num(v['scale']);
  if (vs !== undefined && vs !== 1) {
    const w = num(layer['width' as keyof Layer]) ?? 0;
    const h = num(layer['height' as keyof Layer]) ?? 0;
    const nw = w * vs;
    const nh = h * vs;
    out['width'] = nw;
    out['height'] = nh;
    out['x'] = (num(out['x']) ?? 0) - (nw - w) / 2;
    out['y'] = (num(out['y']) ?? 0) - (nh - h) / 2;
  }

  const fill = v['fill.color'];
  if (typeof fill === 'string') out['fill'] = fill;

  delete out['animation']; // the still frame has no timeline of its own
  return out as unknown as Layer;
}

/** Recursively resolve every animated layer at time t. */
export function layersAt(layers: Layer[], t: number): Layer[] {
  return layers.map(l => {
    const layer = l as AnimatedLayer;
    const resolved = applyValues(layer, t) as AnimatedLayer;
    if (Array.isArray(layer.layers)) {
      return { ...resolved, layers: layersAt(layer.layers, t) } as Layer;
    }
    return resolved;
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
