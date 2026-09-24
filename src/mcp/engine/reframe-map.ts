/**
 * Carry a layer subtree to a new place and size — geometry AND motion.
 *
 * scaleSubtree (preset-fit.ts) rewrites a layer's box, path points and lengths,
 * but a track's x/y keys are pixel distances too: scaled to 0.56 without them, a
 * 600 px slide-in still travels 600 px and lands off the new canvas. Everything
 * here is the same affine map, v → o + d + (v − o)·k, applied to every field
 * that holds a canvas point or a pixel length: the box, the path and its
 * `morph_to`, a `clip_rect`, a track's x/y/width/height/blur/tracking keys (all
 * deltas: scaled, never shifted), and the canvas-point pivots a parented or
 * pivoting track turns about.
 */

import type { Layer } from '../../schema/types';
import type { AnimationSpec, PivotPoint, LayerLink } from '../../animation/types';
import { scaleSubtree, scalePathD } from '../preset-fit';

type Node = Layer & { layers?: Layer[]; animation?: AnimationSpec; link?: LayerLink; clip_rect?: { x: number; y: number; width: number; height: number }; morph_to?: string };

/** Keyframe channels measured in px — distances, so they scale and never shift. */
const PX_KEYS = ['x', 'y', 'width', 'height', 'blur', 'tracking'] as const;

export interface Affine { k: number; ox: number; oy: number; dx: number; dy: number }

const round2 = (v: number): number => Math.round(v * 100) / 100;
const point = (p: PivotPoint, m: Affine): PivotPoint => ({ x: round2(m.ox + m.dx + (p.x - m.ox) * m.k), y: round2(m.oy + m.dy + (p.y - m.oy) * m.k) });

/** One layer's own motion and masks under the map (its children are walked by the caller). */
function mapOwn(l: Node, m: Affine): void {
  const a = l.animation;
  if (a?.keyframes) {
    a.keyframes = a.keyframes.map(key => {
      const next = { ...key };
      for (const c of PX_KEYS) if (typeof next[c] === 'number') next[c] = round2((next[c] as number) * m.k);
      return next;
    });
  }
  if (a?.playback?.pivot) a.playback = { ...a.playback, pivot: point(a.playback.pivot, m) };
  if (l.link?.pivot) l.link = { ...l.link, pivot: point(l.link.pivot, m) };
  if (l.clip_rect) {
    const c = point({ x: l.clip_rect.x, y: l.clip_rect.y }, m);
    l.clip_rect = { ...c, width: round2(l.clip_rect.width * m.k), height: round2(l.clip_rect.height * m.k) };
  }
  if (typeof l.morph_to === 'string') l.morph_to = scalePathD(l.morph_to, m.k, m.ox, m.oy, m.dx, m.dy);
}

function mapMotion(l: Node, m: Affine): void {
  mapOwn(l, m);
  if (Array.isArray(l.layers)) for (const c of l.layers) mapMotion(c as Node, m);
}

/** Map a subtree in place: geometry through scaleSubtree, motion and masks here. */
export function mapSubtree(layer: Layer, m: Affine): void {
  scaleSubtree(layer, m.k, m.ox, m.oy, m.dx, m.dy);
  mapMotion(layer as Node, m);
}
