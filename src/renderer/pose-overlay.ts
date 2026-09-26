/**
 * The editor player's poses for layers the design does not hold (phase 3
 * close-out, C7). A gallery's cells are made by the resolver, so the player
 * cannot write a frame into them the way it writes into authored layers; it
 * hands the renderer the frame instead, laid over the resolved tree here.
 * Fields set to undefined come off, as they do in the editor's state.
 */

import type { Layer } from '../schema/types';

export type PoseMap = ReadonlyMap<string, Record<string, unknown>>;

/** `layers` with every pose laid over its layer, at any depth — the same array when nothing is posed. */
export function overlayPoses(layers: Layer[], poses: PoseMap | undefined): Layer[] {
  if (!poses?.size) return layers;
  let changed = false;
  const out = layers.map((l): Layer => {
    const o = l as unknown as Record<string, unknown>;
    const pose = poses.get(l.id);
    const kids = Array.isArray(o['layers']) ? overlayPoses(o['layers'] as Layer[], poses) : undefined;
    if (!pose && kids === o['layers']) return l;
    changed = true;
    const next: Record<string, unknown> = { ...o, ...(pose ?? {}) };
    if (pose) for (const [k, v] of Object.entries(pose)) if (v === undefined) delete next[k];
    if (kids) next['layers'] = kids;
    return next as unknown as Layer;
  });
  return changed ? out : layers;
}
