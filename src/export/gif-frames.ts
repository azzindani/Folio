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
      const finite = pb.loop && pb.iterations && pb.iterations > 0 ? pb.iterations : undefined;
      const cycles = finite ?? (pb.loop && pb.direction === 'alternate' ? 2 : 1);
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
  // Non-uniform scale wins on its axis; a plain `scale` fills in the rest.
  const vs = num(v['scale']) ?? 1;
  const sx = num(v['scale_x']) ?? vs;
  const sy = num(v['scale_y']) ?? vs;
  if (sx !== 1 || sy !== 1) {
    const w = num(layer['width' as keyof Layer]) ?? 0;
    const h = num(layer['height' as keyof Layer]) ?? 0;
    const nw = w * sx;
    const nh = h * sy;
    out['width'] = nw;
    out['height'] = nh;
    out['x'] = (num(out['x']) ?? 0) - (nw - w) / 2;
    out['y'] = (num(out['y']) ?? 0) - (nh - h) / 2;
  }

  // Blur rides on the layer's effects, which the renderer turns into a filter.
  const vb = num(v['blur']);
  if (vb !== undefined && vb > 0) {
    const fx = (layer['effects' as keyof Layer] as Record<string, unknown> | undefined) ?? {};
    out['effects'] = { ...fx, blur: vb };
  }

  // Skew and stroke reveal have no still-frame equivalent in the layer schema
  // (there is no skew field, and a partial outline needs a live dash), so the
  // flipbook holds those channels at rest. The animated-SVG route plays them.

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
 * A transform inherited from an animated ancestor group.
 *
 * The SVG route gets this free: `transform: scale()` on a group's `<g>`
 * cascades to everything inside it. A flipbook has no cascade — each frame is
 * rendered from absolute coordinates — so animating a group resized only the
 * group's own width/height while its children stayed exactly where they were,
 * and the GIF showed no motion at all. Verified against a live pulse on a
 * locked group: the ring's width was identical in all 48 frames.
 *
 * Since every carousel page and hand-placed composition this engine writes is
 * a locked group, that covered most of the cases anyone would animate.
 */
interface InheritedTransform {
  scale: number;
  /** Fixed point the scale expands about, in absolute canvas coordinates. */
  originX: number;
  originY: number;
  dx: number;
  dy: number;
}

/** Apply an ancestor's transform to a layer's absolute geometry. */
function inherit(layer: Layer, tf: InheritedTransform): Layer {
  const out = { ...layer } as Record<string, unknown>;
  const x = num(out['x']) ?? 0;
  const y = num(out['y']) ?? 0;
  const w = num(out['width']) ?? 0;
  const h = num(out['height']) ?? 0;

  if (tf.scale !== 1) {
    out['x'] = tf.originX + (x - tf.originX) * tf.scale;
    out['y'] = tf.originY + (y - tf.originY) * tf.scale;
    out['width'] = w * tf.scale;
    out['height'] = h * tf.scale;
    // Type scales with the box; leaving it fixed would make a scaling card's
    // text visibly drift out of its own layout.
    const size = num(out['size']);
    if (size !== undefined) out['size'] = size * tf.scale;
  }
  out['x'] = (num(out['x']) ?? 0) + tf.dx;
  out['y'] = (num(out['y']) ?? 0) + tf.dy;
  return out as unknown as Layer;
}

/** Recursively resolve every animated layer at time t. */
export function layersAt(layers: Layer[], t: number, inherited?: InheritedTransform): Layer[] {
  return layers.map(l => {
    const layer = inherited ? (inherit(l, inherited) as AnimatedLayer) : (l as AnimatedLayer);
    const before = layer;
    const resolved = applyValues(layer, t) as AnimatedLayer;

    if (!Array.isArray(layer.layers)) return resolved;

    // Work out what this group's own animation did to it, and pass that down.
    const w0 = num(before['width' as keyof Layer]) ?? 0;
    const rec = resolved as unknown as Record<string, unknown>;
    const w1 = num(rec['width']) ?? w0;
    const scale = w0 > 0 ? w1 / w0 : 1;
    const x0 = num(before['x' as keyof Layer]) ?? 0;
    const y0 = num(before['y' as keyof Layer]) ?? 0;
    const x1 = num(rec['x']) ?? x0;
    const y1 = num(rec['y']) ?? y0;

    const child: InheritedTransform = {
      scale,
      // Scale about the group's own top-left in its PRE-animation position, so
      // the recentring applyValues already did is not counted twice.
      originX: x0,
      originY: y0,
      dx: x1 - x0,
      dy: y1 - y0,
    };

    // `layer` already carries the parent's transform (inherit() ran above), so
    // `child` is expressed in post-parent coordinates and composes by itself.
    return { ...resolved, layers: layersAt(layer.layers, t, child) } as Layer;
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
