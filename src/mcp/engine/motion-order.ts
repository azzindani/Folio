/**
 * Stagger order — which layer in a staggered set starts first (After Effects'
 * text-animator Order: forward, reverse, from the centre, random, by position).
 *
 * Returns a RANK per target rather than reordering them, so every stagger site
 * keeps its targets as given and multiplies the stagger by rank instead of
 * index. Equal keys share a rank: the two letters either side of the middle
 * start together, and a column of layers at one x sweeps in as one.
 */

import * as crypto from 'crypto';
import type { Layer } from '../../schema/types';
import { drawnBox } from '../../export/frame-geometry';
import { layerBBox } from '../engine-finalize-geom';

export const STAGGER_ORDERS = [
  'forward', 'reverse', 'center', 'edges', 'random',
  'left_to_right', 'right_to_left', 'top_to_bottom', 'bottom_to_top',
] as const;
export type StaggerOrder = typeof STAGGER_ORDERS[number];

export function isStaggerOrder(v: unknown): v is StaggerOrder {
  return typeof v === 'string' && (STAGGER_ORDERS as readonly string[]).includes(v);
}

/** Where a layer sits, for the position orders: the centre of what it draws. */
function centre(l: Layer): { x: number; y: number } {
  const b = drawnBox(l);
  if (b) return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const bb = layerBBox(l);
  return { x: (bb.x + bb.r) / 2, y: (bb.y + bb.b) / 2 };
}

/** Dense ranks from sort keys — equal keys (to 0.001) share a rank. */
function denseRanks(keys: number[]): number[] {
  const round = (k: number): number => Math.round(k * 1000) / 1000;
  const distinct = [...new Set(keys.map(round))].sort((a, b) => a - b);
  return keys.map(k => distinct.indexOf(round(k)));
}

/** The stagger rank of each target, in the order the targets were given. */
export function staggerRanks(targets: Layer[], order: StaggerOrder = 'forward'): number[] {
  const mid = (targets.length - 1) / 2;
  switch (order) {
    case 'reverse': return targets.map((_, i) => targets.length - 1 - i);
    case 'center': return denseRanks(targets.map((_, i) => Math.abs(i - mid)));
    case 'edges': return denseRanks(targets.map((_, i) => mid - Math.abs(i - mid)));
    case 'random': {
      // Seeded by the ids, never Math.random: the same set shuffles the same
      // way on every call, and a different set differently.
      const seed = targets.map(l => l.id).join('|');
      const key = (l: Layer): string => crypto.createHash('sha1').update(`${seed}#${l.id}`).digest('hex');
      const shuffled = [...targets].sort((a, b) => key(a).localeCompare(key(b)));
      return targets.map(l => shuffled.indexOf(l));
    }
    case 'left_to_right': return denseRanks(targets.map(l => centre(l).x));
    case 'right_to_left': return denseRanks(targets.map(l => -centre(l).x));
    case 'top_to_bottom': return denseRanks(targets.map(l => centre(l).y));
    case 'bottom_to_top': return denseRanks(targets.map(l => -centre(l).y));
    default: return targets.map((_, i) => i);
  }
}
