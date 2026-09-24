/**
 * 2.5D depth under a camera (B7) — After Effects' layers in z behind a camera,
 * for a 2D camera: what is far away travels and zooms less than the camera
 * does, what is near travels more. Parallax.
 *
 * A layer at `depth` gets f = 1 / (1 + depth) of the camera's move: 0 is the
 * focal plane (it moves with the camera), 1 is twice as far (half the travel),
 * −0.5 is half as far (twice the travel). Layers at one depth ride a wrapper
 * group, `__depth_<d>`, a sibling of the camera on the camera's own box — so
 * both players pivot it on the camera's centre — whose track is the camera's
 * with each key's travel and zoom scaled:
 *   x_d = f·x,  y_d = f·y,  scale_d = 1 + f·(scale − 1),  rotation kept.
 * Linear in the camera's values, on the camera's times and curves, so the
 * wrapper's pose is exact at every frame the camera's keys interpolate to —
 * not only at its keys. Whatever changes the camera (op:camera, a reframe)
 * re-derives the wrappers with syncDepth.
 */

import type { Layer } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';

export const CAMERA = '__camera';
export const DEPTH = '__depth_';
type Node = Layer & { layers?: Layer[]; animation?: AnimationSpec; camera_depth?: number; x?: number; y?: number; width?: number; height?: number };

/** How much of the camera's move a layer at `depth` gets. */
export const parallax = (depth: number): number => 1 / (1 + depth);

/** A wrapper's id for a depth: "__depth_1", "__depth_0_5", "__depth_m0_3". */
export const depthId = (depth: number): string => `${DEPTH}${String(Math.round(depth * 100) / 100).replace('-', 'm').replace('.', '_')}`;

/** The camera's track, its travel and zoom scaled for a layer at `depth`. */
export function depthTrack(camera: AnimationSpec, depth: number): AnimationSpec {
  const f = parallax(depth);
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  return {
    ...camera,
    keyframes: (camera.keyframes ?? []).map(k => ({
      ...k,
      x: r3(f * (typeof k['x'] === 'number' ? k['x'] : 0)),
      y: r3(f * (typeof k['y'] === 'number' ? k['y'] : 0)),
      scale: r3(1 + f * ((typeof k['scale'] === 'number' ? k['scale'] : 1) - 1)),
    })),
  };
}

/** The list that holds the camera, and the camera — wherever it sits (a deck page's group wraps it). */
export function cameraHome(layers: Layer[]): { home: Layer[]; camera: Node } | null {
  for (const l of layers as Node[]) {
    if (l.id === CAMERA) return { home: layers, camera: l };
    const hit = Array.isArray(l.layers) ? cameraHome(l.layers) : null;
    if (hit) return hit;
  }
  return null;
}

/** Re-derive every depth wrapper beside the camera from it: its box and pin, and its track. The count synced. */
export function syncDepth(layers: Layer[]): number {
  const found = cameraHome(layers);
  if (!found) return 0;
  const { home, camera } = found;
  const box = { x: camera.x ?? 0, y: camera.y ?? 0, width: camera.width ?? 0, height: camera.height ?? 0 };
  let n = 0;
  for (const w of home as Node[]) {
    if (!w.id.startsWith(DEPTH) || typeof w.camera_depth !== 'number') continue;
    Object.assign(w, box);
    const pin = (w.layers ?? []).find(l => l.id === `${w.id}_pin`);
    if (pin) Object.assign(pin, box);
    if (camera.animation) w.animation = depthTrack(camera.animation, w.camera_depth);
    else delete w.animation;
    n++;
  }
  return n;
}
