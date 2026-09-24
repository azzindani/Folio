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
 * writes), so each shot fills the new frame with its own subject.
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
  // A backdrop — the night a scene is set in, which the whole shot sits inside — is not what the shot is of.
  const inside = (b: Box): boolean => b.x <= region.x + 1 && b.y <= region.y + 1 && b.x + b.width >= region.x + region.width - 1 && b.y + b.height >= region.y + region.height - 1;
  const seen = canvasBoxes(kids).filter(b => b.opacity > 0.05 && !inside(b.box)).map(b => clip(b.box, region)).filter((b): b is Box => b !== null);
  return union(seen) ?? region;
}

/** A shot's framing for the new canvas: the pose's scale, and the region of the world it shows. */
function reframe(shown: Box, W: number, H: number): { s: number; region: Box; pad: number } {
  const pad = 0.05 * Math.max(shown.width, shown.height);
  const s = Math.min(W / (shown.width + 2 * pad), H / (shown.height + 2 * pad));
  const cx = shown.x + shown.width / 2, cy = shown.y + shown.height / 2;
  return { s, pad, region: { x: cx - W / (2 * s), y: cy - H / (2 * s), width: W / s, height: H / s } };
}

/** Stretch what spanned the old world, inside the camera, to the new one — the sky a camera travels. */
function spanWorld(layers: Layer[], from: Box, to: Box): void {
  for (const l of layers as Node[]) {
    if (typeof l.x === 'number' && typeof l.width === 'number' && l.x <= from.x + 1 && l.x + l.width >= from.x + from.width - 1) { l.x = to.x; l.width = to.width; }
    if (typeof l.y === 'number' && typeof l.height === 'number' && l.y <= from.y + 1 && l.y + l.height >= from.y + from.height - 1) { l.y = to.y; l.height = to.height; }
    if (Array.isArray(l.layers)) spanWorld(l.layers, from, to);
  }
}

/**
 * Re-frame every camera key of a page for a W×H canvas. The world grows to hold
 * what the new shots show (a portrait shot of a landscape world sees above and
 * below it) and the canvas, the camera's box and pin with it, and every pose is
 * written about the new world's centre — the one pivot both players use. What
 * spanned the old world stretches to the new. Null when there is no camera to
 * re-shoot, or a key turns it (its pose is left to the author).
 */
export function reshootCamera(layers: Layer[], world: Box, oldW: number, oldH: number, W: number, H: number): { shots: number; world: Box } | null {
  const cam = findCamera(layers);
  const keys = cam?.animation?.keyframes;
  if (!cam || !keys?.length || typeof cam.width !== 'number' || typeof cam.height !== 'number') return null;
  if (keys.some(k => typeof k['rotation'] === 'number' && k['rotation'] !== 0)) return null;
  const from: Box = { x: cam.x ?? 0, y: cam.y ?? 0, width: cam.width, height: cam.height };
  const P = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const delay = cam.animation?.playback?.delay ?? 0;
  const num = (k: Keyframe, c: string, d: number): number => (typeof k[c] === 'number' ? k[c] as number : d);
  const seen = keys.map(k => {
    const s = num(k, 'scale', 1), tx = num(k, 'x', 0), ty = num(k, 'y', 0);
    const region: Box = { x: P.x + (0 - P.x - tx) / s, y: P.y + (0 - P.y - ty) / s, width: oldW / s, height: oldH / s };
    return subject(layers, delay + k.t, region);
  });
  // A held shot is two keys on one pose: re-shot as one framing, so the camera does not drift while it holds.
  const run: number[] = [];
  keys.forEach((k, i) => {
    const p = keys[i - 1];
    run.push(p && ['scale', 'x', 'y'].every(c => num(k, c, c === 'scale' ? 1 : 0) === num(p, c, c === 'scale' ? 1 : 0)) ? run[i - 1] ?? i : i);
  });
  const shots = keys.map((k, i) => {
    const shown = union(seen.filter((_, j) => run[j] === run[i])) ?? (seen[i] as Box);
    return { k, shown, ...reframe(shown, W, H) };
  });
  const grown = union([world, { x: 0, y: 0, width: W, height: H }, ...shots.map(x => x.region)]) ?? world;
  const next: Box = { x: Math.floor(grown.x), y: Math.floor(grown.y), width: Math.ceil(grown.width), height: Math.ceil(grown.height) };
  const P2 = { x: next.x + next.width / 2, y: next.y + next.height / 2 };
  spanWorld(cam.layers ?? [], from, next);
  Object.assign(cam, next);
  const pin = (cam.layers ?? []).find(l => l.id === `${CAMERA}_pin`);
  if (pin) Object.assign(pin, next);
  const keyed: Keyframe[] = shots.map(({ k, shown, pad }) => { const pose = framePose(shown, { width: W, height: H }, pad, P2); return { ...k, scale: pose.scale, x: pose.x, y: pose.y }; });
  if (cam.animation) cam.animation = { ...cam.animation, keyframes: keyed };
  return { shots: keyed.length, world: next };
}
