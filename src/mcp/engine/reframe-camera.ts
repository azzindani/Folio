/**
 * A camera page re-shot for a new frame (B6b). Carried whole, a 16:9 camera
 * piece sat letterboxed in a 9:16 story: its shots had been framed for the old
 * canvas. The world keeps its coordinates; only the camera moves differently.
 *
 * No shot list is stored, but each camera key fixes the region of the world
 * the old frame showed: p = P + (p′ − P − T) / s over the old canvas, P the
 * camera's pivot (its box's centre), T and s the key's offset and scale. What
 * that shot showed — the posed content inside the region at the key's time —
 * is framed again for the new canvas (framePose, the same pose op:camera
 * writes), so each shot fills the new frame with its own subject. A key that
 * turns the camera is left as it was.
 */

import type { Layer } from '../../schema/types';
import type { AnimationSpec, Keyframe } from '../../animation/types';
import { layersAt } from '../../export/gif-frames';
import { canvasBoxes } from '../../export/frame-cull';
import { framePose, type Box } from './motion-camera';

const CAMERA = '__camera';
type Node = Layer & { layers?: Layer[]; animation?: AnimationSpec; x?: number; y?: number; width?: number; height?: number };

function findCamera(layers: Layer[]): Node | null {
  for (const l of layers as Node[]) {
    if (l.id === CAMERA) return l;
    const hit = Array.isArray(l.layers) ? findCamera(l.layers) : null;
    if (hit) return hit;
  }
  return null;
}

const clip = (b: Box, r: Box): Box | null => {
  const x = Math.max(b.x, r.x), y = Math.max(b.y, r.y);
  const w = Math.min(b.x + b.width, r.x + r.width) - x, h = Math.min(b.y + b.height, r.y + r.height) - y;
  return w > 0 && h > 0 ? { x, y, width: w, height: h } : null;
};
const union = (bs: Box[]): Box | null => bs.reduce<Box | null>((u, b) => {
  if (!u) return b;
  const x = Math.min(u.x, b.x), y = Math.min(u.y, b.y);
  return { x, y, width: Math.max(u.x + u.width, b.x + b.width) - x, height: Math.max(u.y + u.height, b.y + b.height) - y };
}, null);

/** What a shot shows at time t: the camera's posed content inside `region`, in world coordinates. */
function subject(layers: Layer[], t: number, region: Box): Box {
  const cam = findCamera(layersAt(layers, t));
  const kids = (cam?.layers ?? []).filter(l => l.id !== `${CAMERA}_pin`);
  const seen = canvasBoxes(kids).filter(b => b.opacity > 0.05).map(b => clip(b.box, region)).filter((b): b is Box => b !== null);
  return union(seen) ?? region;
}

/** Re-frame every camera key of a page for a W×H canvas; how many keys, or null when the page has no camera. */
export function reshootCamera(layers: Layer[], oldW: number, oldH: number, W: number, H: number): number | null {
  const cam = findCamera(layers);
  const keys = cam?.animation?.keyframes;
  if (!cam || !keys?.length || typeof cam.width !== 'number' || typeof cam.height !== 'number') return null;
  const P = { x: (cam.x ?? 0) + cam.width / 2, y: (cam.y ?? 0) + cam.height / 2 };
  const delay = cam.animation?.playback?.delay ?? 0;
  let n = 0;
  const next: Keyframe[] = keys.map(k => {
    const s = typeof k['scale'] === 'number' ? k['scale'] : 1, tx = typeof k['x'] === 'number' ? k['x'] : 0, ty = typeof k['y'] === 'number' ? k['y'] : 0;
    if (typeof k['rotation'] === 'number' && k['rotation'] !== 0) return k;
    const region: Box = { x: P.x + (0 - P.x - tx) / s, y: P.y + (0 - P.y - ty) / s, width: oldW / s, height: oldH / s };
    const shown = subject(layers, delay + k.t, region);
    const pose = framePose(shown, { width: W, height: H }, 0.05 * Math.max(shown.width, shown.height), P);
    n++;
    return { ...k, scale: pose.scale, x: pose.x, y: pose.y };
  });
  if (cam.animation) cam.animation = { ...cam.animation, keyframes: next };
  return n;
}
