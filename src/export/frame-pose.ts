/**
 * A track's sampled values as ONE SVG transform — how a still frame moves,
 * turns, leans and scales a layer the way the CSS route does.
 *
 * The animated SVG plays `transform: translate() rotate() skew() scale()` about
 * a transform-origin on the layer's fill-box. This builds the same matrix as an
 * SVG transform attribute: translate by the offset, then rotate/skew/scale
 * about the anchor of what the layer draws.
 *
 * It replaced editing x/y/width/height, which disagreed with the SVG three
 * ways: only layers with x/y moved (a line has x1..y2, a path has `d`), text
 * never scaled (font-size is not the box), and a group's children never
 * followed — so `rise` on a connector and `pop` on a headline did nothing in a
 * GIF or MP4.
 */

import type { Layer } from '../schema/types';
import type { AnchorPoint, PivotPoint } from '../animation/types';
import { drawnBox, anchorPoint } from './frame-geometry';

/** Where a sampled frame layer keeps its pose for readouts (op:frame). The renderer ignores it. */
export const FRAME_POSE = '_frame_pose';

export interface FramePose {
  dx: number;
  dy: number;
  rotation: number;
  scale_x: number;
  scale_y: number;
  skew_x: number;
  skew_y: number;
}

export const REST_POSE: FramePose = { dx: 0, dy: 0, rotation: 0, scale_x: 1, scale_y: 1, skew_x: 0, skew_y: 0 };

const f = (n: number): string => String(Number(n.toFixed(3)));
const RAD = Math.PI / 180;

/**
 * The SVG transform for a pose, or '' at rest. `layer` is the AUTHORED layer:
 * the pivot is measured before the offset, which is why the translate comes
 * first — the same composition CSS gets from a transform-origin on the box.
 */
export function poseTransform(layer: Layer, pose: FramePose, anchor?: AnchorPoint | PivotPoint): string {
  const parts: string[] = [];
  if (pose.dx !== 0 || pose.dy !== 0) parts.push(`translate(${f(pose.dx)} ${f(pose.dy)})`);
  const pivots = pose.rotation !== 0 || pose.skew_x !== 0 || pose.skew_y !== 0 || pose.scale_x !== 1 || pose.scale_y !== 1;
  const o = pivots ? pivotOf(layer, anchor) : null;
  if (o) {
    parts.push(`translate(${f(o.x)} ${f(o.y)})`);
    if (pose.rotation !== 0) parts.push(`rotate(${f(pose.rotation)})`);
    // CSS skew(ax, ay) is the matrix [1 tan(ax); tan(ay) 1] — not skewX() then skewY().
    if (pose.skew_x !== 0 || pose.skew_y !== 0) {
      parts.push(`matrix(1 ${f(Math.tan(pose.skew_y * RAD))} ${f(Math.tan(pose.skew_x * RAD))} 1 0 0)`);
    }
    if (pose.scale_x !== 1 || pose.scale_y !== 1) parts.push(`scale(${f(pose.scale_x)} ${f(pose.scale_y)})`);
    parts.push(`translate(${f(-o.x)} ${f(-o.y)})`);
  }
  return parts.join(' ');
}

/** Where a layer's pose pivots: a canvas point as given, else the anchor on the box it draws. */
export function pivotOf(layer: Layer, anchor?: AnchorPoint | PivotPoint): { x: number; y: number } | null {
  if (anchor && typeof anchor === 'object') return anchor;
  const box = drawnBox(layer);
  return box ? anchorPoint(box, anchor) : null;
}
