/**
 * The SVG route's `count`. CSS cannot change what a <text> says, so a counting
 * text layer becomes a group of stepped variants — one per distinct figure,
 * each visible for its own slice of the track — while the group keeps the
 * layer's id and every other channel, so a count that also rises rises as one.
 *
 * Figures are sampled with interpolateKeyframes, the flipbook's own sampler,
 * so the SVG and the GIF show the same number at the same moment. The flipbook
 * itself needs none of this: it writes the figure into each frame.
 */

import type { DesignSpec, Layer } from '../schema/types';
import type { AnimationSpec, Keyframe } from '../animation/types';
import { interpolateKeyframes } from '../animation/keyframe-engine';
import { countText } from '../animation/count';

/** Figures are read this often along the track; identical neighbours merge. */
const SAMPLE_MS = 1000 / 30;
/** A long count still ships a bounded file. */
const MAX_VARIANTS = 120;

type Animated = Layer & { animation?: AnimationSpec; layers?: Layer[] };

/** Keep `max` items spread evenly, first and last included. */
function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    const it = items[Math.round((i * (items.length - 1)) / (max - 1))];
    if (it !== undefined && out[out.length - 1] !== it) out.push(it);
  }
  return out;
}

function expandLayer(l: Animated): Layer {
  if (Array.isArray(l.layers)) return { ...l, layers: l.layers.map(k => expandLayer(k as Animated)) } as Layer;
  const anim = l.animation;
  const frames = [...(anim?.keyframes ?? [])].sort((a, b) => a.t - b.t);
  const content = (l as unknown as { content?: { type?: string; value?: unknown } }).content;
  if (l.type !== 'text' || typeof content?.value !== 'string' || !frames.some(k => typeof k.count === 'number')) return l;

  const text = content.value;
  const t0 = frames[0]?.t ?? 0;
  const pb = anim?.playback;
  const duration = pb?.duration ?? Math.max(1, (frames[frames.length - 1]?.t ?? 0) - t0);
  const samples = Math.max(1, Math.ceil(duration / SAMPLE_MS));
  const steps: Array<{ at: number; text: string }> = [];
  for (let i = 0; i <= samples; i++) {
    const at = (duration * i) / samples;
    const v = interpolateKeyframes(frames, t0 + at, pb?.easing)['count'];
    const figure = countText(text, typeof v === 'number' ? v : 1);
    if (steps[steps.length - 1]?.text !== figure) steps.push({ at, text: figure });
  }
  const shown = thin(steps, MAX_VARIANTS);

  const timing = {
    duration,
    ...(pb?.delay ? { delay: pb.delay } : {}), ...(pb?.loop ? { loop: true } : {}),
    ...(pb?.iterations ? { iterations: pb.iterations } : {}), ...(pb?.direction ? { direction: pb.direction } : {}),
  };
  // Held keyframes make each swap a cut, not a crossfade between two figures.
  const variants = shown.map((s, j) => {
    const next = shown[j + 1]?.at;
    const kf: Keyframe[] = [{ t: 0, opacity: j === 0 ? 1 : 0, hold: true }];
    if (j > 0) kf.push({ t: s.at, opacity: 1, hold: true });
    kf.push(next !== undefined ? { t: next, opacity: 0, hold: true } : { t: duration, opacity: 1, hold: true });
    return { ...l, id: `${l.id}__count${j}`, content: { ...content, value: s.text }, animation: { keyframes: kf, playback: timing } } as unknown as Layer;
  });

  const rest = frames.map(k => Object.fromEntries(Object.entries(k).filter(([key]) => key !== 'count')) as unknown as Keyframe);
  const moves = rest.some(k => Object.keys(k).some(key => key !== 't' && key !== 'easing' && key !== 'hold'));
  const o = l as unknown as Record<string, unknown>;
  return {
    id: l.id, type: 'group', z: o['z'] ?? 1, x: o['x'], y: o['y'], width: o['width'], height: o['height'],
    layers: variants, ...(moves && anim ? { animation: { ...anim, keyframes: rest } } : {}),
  } as unknown as Layer;
}

/** The spec with every counting text layer expanded — the root layers and every page. */
export function expandCounts(spec: DesignSpec): DesignSpec {
  const walk = (ls: Layer[] | undefined): Layer[] | undefined => ls?.map(l => expandLayer(l as Animated));
  return {
    ...spec,
    ...(spec.layers ? { layers: walk(spec.layers) } : {}),
    ...(spec.pages ? { pages: spec.pages.map(p => ({ ...p, layers: walk(p.layers) ?? [] })) } : {}),
  } as DesignSpec;
}
