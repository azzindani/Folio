/**
 * Motion blur — After Effects' per-layer switch, drawn from the sampled motion.
 *
 * A frame is an instant, but a camera's shutter stays open for part of one, so
 * a thing crossing the frame smears along its path. `motion_blur` on a layer
 * (true, or {shutter: degrees of a frame — 180 by default, as in AE}) makes
 * every raster frame show the layer's travel over that interval: the sampler
 * measures where the layer's own pose goes from half a shutter before t to
 * half after, and the renderer draws that travel as N offset copies averaged
 * in premultiplied colour — the exact mean of N sub-frames of a move, for the
 * price of one filter instead of N renders. Turns and zooms are not smeared:
 * travel is what reads as speed.
 */

import type { Layer } from '../schema/types';
import { FRAME_POSE, REST_POSE, type FramePose } from './frame-pose';
import { drawnBox, type Box } from './frame-geometry';

/** What the renderer draws: the travel over the shutter in the layer's own coordinates, and the box it smears. */
export interface MotionSmear { dx: number; dy: number; samples: number; box: Box }

export const DEFAULT_SHUTTER = 180;
/** The frame op:frame and the editor preview assume: a 30 fps video frame. */
export const PREVIEW_FRAME_MS = 1000 / 30;
/** Copies no further apart than this, px, so the smear reads as a streak and not a row of ghosts. */
const STEP_PX = 3;
const MAX_SAMPLES = 32;
/** Less travel than this over the shutter does not visibly smear. */
const MIN_TRAVEL = 1;

const round = (v: number): number => Math.round(v * 100) / 100;

/** The shutter angle a layer asks for, or null when motion blur is off. */
export function shutterOf(layer: Layer): number | null {
  const mb = (layer as unknown as { motion_blur?: unknown }).motion_blur;
  if (mb === true) return DEFAULT_SHUTTER;
  if (!mb || typeof mb !== 'object') return null;
  const s = (mb as { shutter?: unknown }).shutter;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? Math.min(720, s) : DEFAULT_SHUTTER;
}

const poseOf = (l: Layer): FramePose =>
  ((l as unknown as Record<string, unknown>)[FRAME_POSE] as FramePose | undefined) ?? REST_POSE;

/**
 * The smear of `layer` at t, or null when it barely moves. `posedAt` samples
 * the layer alone at any time (its track and motion path). The travel is its
 * pose's offset from t − shutter/2 to t + shutter/2, carried into the layer's
 * local space — the filter works under the pose's own turn and scale.
 */
export function smearOf(layer: Layer, posedAt: (t: number) => Layer, t: number, frameMs: number, shutter: number): MotionSmear | null {
  const half = ((shutter / 360) * frameMs) / 2;
  const a = poseOf(posedAt(t - half)), b = poseOf(posedAt(t + half)), now = poseOf(posedAt(t));
  const vx = b.dx - a.dx, vy = b.dy - a.dy;
  if (Math.hypot(vx, vy) < MIN_TRAVEL) return null;
  const box = drawnBox(layer);
  if (!box) return null;
  // Undo the pose's turn, then its scale: parent-space travel → local travel.
  const r = (-now.rotation * Math.PI) / 180;
  const lx = (vx * Math.cos(r) - vy * Math.sin(r)) / (now.scale_x || 1);
  const ly = (vx * Math.sin(r) + vy * Math.cos(r)) / (now.scale_y || 1);
  // A power of two, so the renderer can average the copies pairwise.
  const want = Math.ceil(Math.hypot(lx, ly) / STEP_PX) + 1;
  const samples = Math.min(MAX_SAMPLES, 2 ** Math.max(1, Math.ceil(Math.log2(want))));
  return { dx: round(lx), dy: round(ly), samples, box };
}
