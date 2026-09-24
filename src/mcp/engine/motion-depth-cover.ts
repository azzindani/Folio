/**
 * What a layer set at a depth must reach to fill the frame through the whole
 * move (B7). Found in the benchmark (r8): near grass at depth −0.3 travels 143%
 * of the camera — spanned to the 7200 px world like everything else, it runs
 * out 2263 px before the ride ends and the last frames' bottom strip is bare.
 * Nothing said so. A band that fills the frame's width (or height) where the
 * camera starts must fill it at every framing; where it does not, this says by
 * how much, in the layer's own px, and where its edge has to reach.
 */

import type { Layer } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';
import type { ProgressItem } from '../types';
import { layersAt } from '../../export/gif-frames';
import { canvasBoxes, type CanvasBox } from '../../export/frame-cull';
import { drawnBox } from '../../export/frame-geometry';
import { pWarn } from './utils';
import { cameraHome, parallax, DEPTH } from './motion-depth';

type Side = 'left' | 'right' | 'top' | 'bottom';
export interface Gap { id: string; depth: number; at: number; side: Side; short: number; edge: number; reach: number }
type Node = Layer & { layers?: Layer[]; animation?: AnimationSpec; camera_depth?: number };

/** Every drawn leaf under a depth wrapper, with the wrapper's depth. */
function depthLeaves(home: Layer[]): Map<string, { layer: Layer; depth: number }> {
  const out = new Map<string, { layer: Layer; depth: number }>();
  const walk = (ls: Layer[], depth: number, pin: string): void => {
    for (const l of ls as Node[]) {
      if (Array.isArray(l.layers)) walk(l.layers, depth, pin);
      else if (l.id !== pin) out.set(l.id, { layer: l, depth });
    }
  };
  for (const w of home as Node[]) if (w.id.startsWith(DEPTH) && typeof w.camera_depth === 'number') walk(w.layers ?? [], w.camera_depth, `${w.id}_pin`);
  return out;
}

/** The bands at a depth that stop filling the frame somewhere in the camera's move — the worst shortfall per side. */
export function depthGaps(layers: Layer[], W: number, H: number): Gap[] {
  const found = cameraHome(layers);
  const keys = found?.camera.animation?.keyframes ?? [];
  if (!found || keys.length < 2) return [];
  const leaves = depthLeaves(found.home);
  if (!leaves.size) return [];
  const delay = found.camera.animation?.playback?.delay ?? 0;
  const at = (t: number): Map<string, CanvasBox> =>
    new Map(canvasBoxes(layersAt(layers, t)).filter(b => leaves.has(b.layer.id)).map(b => [b.layer.id, b]));
  const [start, ...rest] = keys.map(k => delay + k.t);
  const first = at(start ?? 0);
  const worst = new Map<string, Gap>();
  for (const t of rest) {
    const now = at(t);
    for (const [id, b0] of first) {
      const b = now.get(id), leaf = leaves.get(id), own = leaf ? drawnBox(leaf.layer) : null;
      if (!b || !leaf || !own) continue;
      const s = b.scale ?? 1;
      const miss: Array<[Side, number, number]> = [];
      if (b0.box.x <= 0.5 && b0.box.x + b0.box.width >= W - 0.5) {
        miss.push(['left', b.box.x, own.x], ['right', W - (b.box.x + b.box.width), own.x + own.width]);
      }
      if (b0.box.y <= 0.5 && b0.box.y + b0.box.height >= H - 0.5) {
        miss.push(['top', b.box.y, own.y], ['bottom', H - (b.box.y + b.box.height), own.y + own.height]);
      }
      for (const [side, px, edge] of miss) {
        if (px <= 0.5) continue;
        const short = Math.ceil(px / s), key = `${id}:${side}`;
        const reach = side === 'left' || side === 'top' ? edge - short : edge + short;
        if ((worst.get(key)?.short ?? 0) < short) worst.set(key, { id, depth: leaf.depth, at: t, side, short, edge: Math.round(edge), reach: Math.round(reach) });
      }
    }
  }
  return [...worst.values()];
}

/** The gaps as warnings a reply carries. */
export function gapNotes(layers: Layer[], W: number, H: number): ProgressItem[] {
  return depthGaps(layers, W, H).map(g => {
    const axis = g.side === 'left' || g.side === 'right' ? 'x' : 'y';
    return pWarn(`"${g.id}" leaves the frame bare on the ${g.side} at ${g.at} ms`,
      `at depth ${g.depth} it moves ${Math.round(parallax(g.depth) * 100)}% of the camera: its ${g.side} edge (${axis} ${g.edge}) must reach ${axis} ${g.reach} — ${g.short} px further — to fill the frame to the end, or set it nearer 0.`);
  });
}
