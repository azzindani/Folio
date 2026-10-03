// Where a clip lands on the canvas when it sits inside groups — a camera world,
// a transition's wrapper, a parent — so it can still be drawn as pixels.
//
// Every transform above the clip, and its own pose, multiply into one matrix.
// While that matrix only moves and scales (no turn, skew or flip) the clip draws
// as an axis-aligned box, and its decoded picture resampled into that box is what
// the SVG would draw. Clip rectangles on the way (a wipe, a `clip: true` window)
// intersect into one window; opacities multiply. Anything else answers null and
// the frame takes the embedded path, which draws everything the renderer can.

import type { Layer } from '../../schema/types';
import { parseTransform, type Matrix } from '../../export/frame-cull';
import type { Box } from '../../export/frame-geometry';
import { clipRectFor } from '../../renderer/clip-rect';

/** A clip on the canvas: the box its picture fills, its opacity down the tree, and the window it shows through (null: none). */
export interface ClipPlace { box: Box; opacity: number; window: Box | null }

/** Group fields that only place their children, or that the renderer ignores. */
const GROUP_KEYS = new Set([
  'id', 'type', 'name', 'x', 'y', 'width', 'height', 'z', 'layers', 'transform', 'opacity', 'visible',
  'clip', 'clip_rect', '_frame_pose', 'in', 'out', 'locked', 'role', 'alt', 'clock',
]);
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const axisAligned = (m: Matrix): boolean => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && m[0] > 0 && m[3] > 0;
const mapBox = (m: Matrix, b: Box): Box => ({ x: m[0] * b.x + m[4], y: m[3] * b.y + m[5], width: m[0] * b.width, height: m[3] * b.height });
const overlap = (a: Box | null, b: Box): Box => {
  if (!a) return b;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
};
const opacityOf = (l: Layer): number => {
  if (l.visible === false) return 0;
  const o = (l as unknown as Record<string, unknown>)['opacity'];
  return typeof o === 'number' ? Math.max(0, Math.min(1, o)) : 1;
};
const matrixOf = (l: Layer, parent: Matrix): Matrix | null => {
  const t = (l as unknown as Record<string, unknown>)['transform'];
  const own = typeof t === 'string' ? parseTransform(t) : IDENTITY;
  const m = own ? mul(parent, own) : null;
  return m && axisAligned(m) ? m : null;
};

const kidsOf = (l: Layer): Layer[] | null => {
  const k = (l as unknown as Record<string, unknown>)['layers'];
  return Array.isArray(k) ? (k as Layer[]) : null;
};
function holdsVideo(l: Layer): boolean {
  return (kidsOf(l) ?? []).some(k => k.type === 'video' || holdsVideo(k));
}
/** The leaves a group draws (hidden ones left out). */
function drawnLeaves(l: Layer, out: Layer[] = []): Layer[] {
  for (const k of kidsOf(l) ?? []) {
    if (opacityOf(k) === 0) continue;
    if (kidsOf(k)) drawnLeaves(k, out); else out.push(k);
  }
  return out;
}

/** Every video layer under `layers` placed on the canvas, by id; null when one cannot be (a turn, a layout, an effect on the way). */
export function placeClips(layers: Layer[]): Map<string, ClipPlace> | null {
  const out = new Map<string, ClipPlace>();
  return walk(layers, IDENTITY, 1, null, out) ? out : null;
}

function walk(layers: Layer[], parent: Matrix, alpha: number, window: Box | null, out: Map<string, ClipPlace>): boolean {
  for (const l of layers) {
    if (l.type === 'video') {
      const m = matrixOf(l, parent);
      if (!m || out.has(l.id)) return false;
      const w = typeof l.width === 'number' ? l.width : 640, h = typeof l.height === 'number' ? l.height : 360;
      const rect = clipRectFor(l);
      out.set(l.id, { box: mapBox(m, { x: l.x ?? 0, y: l.y ?? 0, width: w, height: h }), opacity: alpha * opacityOf(l), window: rect ? overlap(window, mapBox(m, rect)) : window });
      continue;
    }
    const kids = kidsOf(l);
    if (!kids || !holdsVideo(l)) continue;
    if (l.type !== 'group') return false;
    for (const [k, v] of Object.entries(l)) if (v !== undefined && v !== null && !GROUP_KEYS.has(k)) return false;
    const m = matrixOf(l, parent);
    if (!m) return false;
    const op = opacityOf(l);
    // A faded group composites whole: cut around a clip it is only the same when that clip is all it draws.
    if (op > 0 && op < 1) {
      const leaves = drawnLeaves(l);
      if (leaves.length !== 1 || leaves[0]?.type !== 'video') return false;
    }
    const rect = clipRectFor(l);
    if (!walk(kids, m, alpha * op, rect ? overlap(window, mapBox(m, rect)) : window, out)) return false;
  }
  return true;
}
