/**
 * How long a piece without pages lasts — a sting, a looping GIF, a poster that
 * moves. It has no scene to carry a length: it lasts as long as its longest
 * track, and a track lasts to its last key plus its hold (playback.duration).
 * An 8 s loop whose motion ends at 7.6 s could only reach 8 s by keying a
 * dummy frame or rebuilding every track through op:storyboard (benchmark r6,
 * b21). Here the length is written the way it is read: every one-shot track
 * holds its last pose to `length`. Length never cuts motion — a track whose
 * keys run past it is named instead — and 0 takes the holds back off.
 */

import type { Layer } from '../../schema/types';
import type { AnimationSpec, LayerClock } from '../../animation/types';

type Node = Layer & { layers?: Layer[]; clock?: LayerClock; animation?: AnimationSpec };

/** A one-shot keyframed track on the scene clock (not looping, not inside a precomp clock). */
interface Held { id: string; delay: number; span: number }

function oneShots(layers: Layer[], out: Held[] = []): Held[] {
  for (const l of layers as Node[]) {
    const a = l.animation, keys = a?.keyframes ?? [];
    if (keys.length >= 2 && !a?.playback?.loop) {
      const ts = keys.map(k => k.t);
      out.push({ id: l.id, delay: a?.playback?.delay ?? 0, span: Math.max(...ts) - Math.min(...ts) });
    }
    // A precomp's children play on its clock; its own length is the precomp's business.
    if (Array.isArray(l.layers) && !l.clock) oneShots(l.layers, out);
  }
  return out;
}

export type PosterLength = { layers: Layer[]; tracks: number; ends_ms: number } | { error: string; hint: string };

/**
 * The layers with every one-shot track held to `length` ms (0: to its own last key).
 * A piece moved only by loops, rules or script components has no track to hold —
 * its length is the design's own (length_ms), so that is not a refusal here.
 */
export function holdToLength(layers: Layer[], length: number): PosterLength {
  const held = oneShots(layers);
  if (!held.length) return { layers, tracks: 0, ends_ms: length };
  const late = held.filter(h => h.delay + h.span > length);
  if (length > 0 && late.length) {
    const worst = Math.max(...late.map(h => h.delay + h.span));
    return { error: `${late.map(h => h.id).slice(0, 6).join(', ')} still move${late.length === 1 ? 's' : ''} until ${worst} ms — a length of ${length} ms would cut ${late.length === 1 ? 'it' : 'them'} off.`,
      hint: `Use length_ms ≥ ${worst}, or close time first (op:retime with a negative shift_ms).` };
  }
  const want = new Map(held.map(h => [h.id, length > 0 ? length - h.delay : h.span]));
  const apply = (ls: Layer[]): Layer[] => (ls as Node[]).map(l => {
    const d = want.get(l.id);
    const kids = Array.isArray(l.layers) && !l.clock ? { layers: apply(l.layers) } : {};
    if (d === undefined || !l.animation) return { ...l, ...kids } as Layer;
    return { ...l, ...kids, animation: { ...l.animation, playback: { ...(l.animation.playback ?? { duration: d }), duration: d } } } as Layer;
  });
  return { layers: apply(layers), tracks: held.length, ends_ms: length > 0 ? length : Math.max(...held.map(h => h.delay + h.span)) };
}
