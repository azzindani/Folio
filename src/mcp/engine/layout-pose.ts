// Where a posed layer is on screen — for the layout review's component boxes.
//
// A frame pose (export/frame-pose.ts) moves a layer, and everything inside a
// group, by one transform about the layer's anchor. The review measured the
// AUTHORED boxes, so inside a camera world (every layer a child of the posed
// `__camera` group) no component landed on the canvas and a shot listed none —
// "too big" could never be said about what the viewer actually sees.
//
// Offset and scale only: a camera pans and zooms; a turn is rare and a rotated
// box's extent is not a component's size anyway.
import type { Layer } from '../../schema/types';
import type { AnchorPoint, PivotPoint } from '../../animation/types';
import { FRAME_POSE, type FramePose, pivotOf } from '../../export/frame-pose';

/** p' = s·p + t, per axis. */
export interface Affine { sx: number; sy: number; tx: number; ty: number }
export const IDENTITY: Affine = { sx: 1, sy: 1, tx: 0, ty: 0 };

/** The layer's own pose as an affine map, or null at rest. */
export function poseAffine(l: Layer): Affine | null {
  const pose = (l as unknown as Record<string, unknown>)[FRAME_POSE] as FramePose | undefined;
  if (!pose) return null;
  const sx = pose.scale_x || 1, sy = pose.scale_y || 1;
  if (pose.dx === 0 && pose.dy === 0 && sx === 1 && sy === 1) return null;
  const pb = (l as { animation?: { playback?: { anchor?: AnchorPoint; pivot?: PivotPoint } } }).animation?.playback;
  const o = (sx !== 1 || sy !== 1 ? pivotOf(l, pb?.pivot ?? pb?.anchor) : null) ?? { x: 0, y: 0 };
  return { sx, sy, tx: pose.dx + o.x * (1 - sx), ty: pose.dy + o.y * (1 - sy) };
}

/** outer ∘ inner: apply `inner` first. */
export function compose(outer: Affine, inner: Affine): Affine {
  return { sx: outer.sx * inner.sx, sy: outer.sy * inner.sy, tx: outer.sx * inner.tx + outer.tx, ty: outer.sy * inner.ty + outer.ty };
}

export function mapBox<B extends { x: number; y: number; w: number; h: number }>(a: Affine, b: B): B {
  return { ...b, x: a.sx * b.x + a.tx, y: a.sy * b.y + a.ty, w: a.sx * b.w, h: a.sy * b.h };
}
