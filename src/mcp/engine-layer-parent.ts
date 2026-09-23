/**
 * `add_layers {parent_id}` — adding INTO a group that is already on the page.
 *
 * Found live (2026-09-20): a continuous scene keeps its whole world in ONE
 * locked group, and nothing could add to it afterwards. patch_design cannot
 * append (an out-of-range index does not resolve), edit_layer adds at the top
 * level, and rebuilding the group means rewriting a piece that already renders.
 * So an icon, a caption or a nested sub-scene could not join a finished scene.
 */

import type { Layer } from '../schema/types';

type Group = Layer & { layers?: Layer[]; locked?: boolean };

/**
 * Marks an incoming layer that arrived without a z. Shorthand fills in its
 * index in the call (shorthand-expand.ts), which inside a group means under
 * every sibling stacked higher — so the mark is taken before that. Transient:
 * addIntoGroup and clearAutoZ remove it; it is never written.
 */
const AUTO_Z = '__auto_z';

/** Mark the incoming layers whose source (shorthand or verbose, same order) gave no z. */
export function markAutoZ(incoming: Layer[], sources: readonly unknown[]): void {
  incoming.forEach((l, i) => {
    const src = sources[i] as { z?: unknown } | undefined;
    if (src && src.z === undefined) (l as unknown as Record<string, unknown>)[AUTO_Z] = true;
  });
}

/** Drop the marks — at the top level a layer keeps the z shorthand gave it. */
export function clearAutoZ(layers: Layer[]): void {
  for (const l of layers) delete (l as unknown as Record<string, unknown>)[AUTO_Z];
}

/** A group anywhere in the tree, by id. */
export function findGroup(layers: Layer[] | undefined, id: string): Group | null {
  for (const l of layers ?? []) {
    const node = l as Group;
    if (node.id === id) return node;
    const hit = Array.isArray(node.layers) ? findGroup(node.layers, id) : null;
    if (hit) return hit;
  }
  return null;
}

/**
 * Put `incoming` inside the group named `parentId`, at the end of its children.
 * Returns null when done, or the sentence to hand back when it cannot be.
 *
 * A LOCKED parent is not a refusal here: the lock keeps the engine's rescue
 * passes out, and the caller naming the group is saying it means this.
 */
export function addIntoGroup(container: Layer[], parentId: string, incoming: Layer[], where: string): string | null {
  const host = findGroup(container, parentId);
  if (!host) return `No group "${parentId}" ${where}.`;
  if (host.type !== 'group') return `"${parentId}" is a ${host.type}, not a group — only a group holds layers.`;
  // At the end means on top: a layer given no z was filled in with its index and drew under every
  // sibling stacked higher (benchmark r5: a chevron added to a scene drew beneath its grid lines).
  // A z the caller wrote is kept — tucking something under on purpose still works.
  let top = Math.max(0, ...(host.layers ?? []).map(l => (typeof l.z === 'number' ? l.z : 0)));
  const placed = incoming.map(l => {
    const auto = (l as unknown as Record<string, unknown>)[AUTO_Z] === true;
    clearAutoZ([l]);
    return auto ? ({ ...l, z: ++top } as Layer) : l;
  });
  host.layers = [...(host.layers ?? []), ...placed];
  return null;
}

/**
 * Whether a named parent sits under a lock — its own, or any group above it.
 * A scene locks ONE group at its root and blocks the beats inside it, so the
 * lock has to be inherited or adding into a beat would be rescued after all.
 */
export function parentIsLocked(container: Layer[] | undefined, parentId: string | undefined, locked = false): boolean {
  if (!parentId) return false;
  for (const l of container ?? []) {
    const node = l as Group;
    const under = locked || node.locked === true;
    if (node.id === parentId) return under;
    if (Array.isArray(node.layers) && parentIsLocked(node.layers, parentId, under)) return true;
  }
  return false;
}
