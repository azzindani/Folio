/**
 * A parented layer's wrapper stack — how a child inherits its parent's WORLD.
 *
 * op:parent puts the child on `<id>_link`, which follows the parent's own
 * track. But the parent may itself ride wrappers: its own parent link, a
 * follow-through link, a wiggle. Each of those gets a mirror level around the
 * child (`<id>_link2`, `<id>_link3`, … innermost first) that follows it, so a
 * hand parented to a forearm parented to an upper arm swings with all three —
 * the child's world is its parent's world, as in After Effects, and the child
 * stays where it is in the paint order.
 */

import type { Layer } from '../../schema/types';
import type { AnimationSpec, LayerLink, PivotPoint } from '../../animation/types';
import { pivotOf } from '../../export/frame-pose';

export type RigNode = Layer & { layers?: Layer[]; link?: LayerLink; animation?: AnimationSpec; z?: number };

export const BASE_SUFFIX = '_link';
/** `<child>_link<n>`, n ≥ 2 — a mirror level. */
export const mirrorId = (child: string, level: number): string => `${child}${BASE_SUFFIX}${level}`;

/** The layers from the top of the scope down to `id`, or null. */
export function pathTo(layers: Layer[], id: string): RigNode[] | null {
  for (const l of layers as RigNode[]) {
    if (l.id === id) return [l];
    if (Array.isArray(l.layers)) {
      const p = pathTo(l.layers, id);
      if (p) return [l, ...p];
    }
  }
  return null;
}

/** A group holding one layer and moving it — a link, parent, mirror or wiggle wrapper. */
const isMotionWrapper = (g: RigNode): boolean =>
  Array.isArray(g.layers) && g.layers.length === 1 && Boolean(g.link || g.animation?.keyframes?.length);

/** The motion wrappers a layer rides, innermost first. */
export function stackAround(scope: Layer[], id: string): RigNode[] {
  const path = pathTo(scope, id) ?? [];
  const out: RigNode[] = [];
  for (let i = path.length - 2; i >= 0; i--) {
    const g = path[i];
    if (!g || !isMotionWrapper(g)) break;
    out.push(g);
  }
  return out;
}

/** Where a wrapper turns: a parent link's stored pivot, else the anchor of what it draws. */
export function wrapperPivot(w: RigNode): PivotPoint | null {
  if (w.link?.pivot) return w.link.pivot;
  const pb = w.animation?.playback;
  const at = pivotOf(w, pb?.pivot ?? pb?.anchor);
  return at ? { x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10 } : null;
}

/** Every `<child>_link` wrapper that parents (its link has a pivot). */
export function parentBases(layers: Layer[]): RigNode[] {
  const out: RigNode[] = [];
  const walk = (ls: Layer[]): void => {
    for (const l of ls as RigNode[]) {
      const child = l.layers?.[0];
      if (l.link?.pivot && child && l.id === `${child.id}${BASE_SUFFIX}`) out.push(l);
      if (Array.isArray(l.layers)) walk(l.layers);
    }
  };
  walk(layers);
  return out;
}

/** A child's mirror levels around its base, innermost first. */
export function mirrorsOf(scope: Layer[], base: RigNode): RigNode[] {
  const child = base.layers?.[0]?.id ?? '';
  return stackAround(scope, base.id).filter((w, i) => w.id === mirrorId(child, i + 2));
}

const samePoint = (a: PivotPoint | null | undefined, b: PivotPoint | null | undefined): boolean =>
  (!a && !b) || (Boolean(a && b) && Math.abs((a?.x ?? 0) - (b?.x ?? 0)) <= 0.5 && Math.abs((a?.y ?? 0) - (b?.y ?? 0)) <= 0.5);

/** What the mirrors should follow — the parent's stack — and whether they already do. */
export function chainOf(scope: Layer[], base: RigNode): { want: RigNode[]; inStep: boolean } {
  const want = base.link ? stackAround(scope, base.link.to) : [];
  const have = mirrorsOf(scope, base);
  const inStep = want.length === have.length && want.every((w, i) => have[i]?.link?.to === w.id && samePoint(have[i]?.link?.pivot, wrapperPivot(w)));
  return { want, inStep };
}
