/**
 * Leave out of a RASTER frame the clipped layers that cannot draw on the canvas.
 *
 * Found live (2026-09-15): a camera push-in carried a masked headline ~3000px off
 * the canvas and resvg 2.6.2 panicked (geom.rs:27, Option::unwrap on None). That
 * panic cannot unwind, so it ABORTED the process — the whole MCP server, not one
 * export. Probed on the SVG itself: a clipped group whose content lies far outside
 * the canvas aborts, whether its own coordinates, a child's transform or an
 * ancestor's put it there; the same content without the clip renders. A clip that
 * cannot reach the canvas draws nothing, so dropping it from a sampled frame is
 * exact. The animated SVG keeps it: there, CSS can still bring it into view.
 */

import type { DesignSpec, Layer } from '../schema/types';
import { drawnBox, type Box } from './frame-geometry';
import { clipRectFor } from '../renderer/clip-rect';

/** An SVG affine matrix [a b c d e f]. */
export type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const RAD = Math.PI / 180;
const FN = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** An SVG transform list as one matrix, or null for anything not read exactly. */
export function parseTransform(list: string): Matrix | null {
  if (list.replace(FN, '').replace(/[\s,]/g, '') !== '') return null;
  let m = IDENTITY;
  for (const [, fn, raw = ''] of list.matchAll(FN)) {
    const a = raw.split(/[\s,]+/).filter(Boolean).map(Number);
    if (a.some(n => !Number.isFinite(n))) return null;
    const [p = 0, q, r] = a;
    let n: Matrix;
    if (fn === 'matrix') {
      if (a.length !== 6) return null;
      n = a as Matrix;
    } else if (fn === 'translate') n = [1, 0, 0, 1, p, q ?? 0];
    else if (fn === 'scale') n = [a.length ? p : 1, 0, 0, q ?? (a.length ? p : 1), 0, 0];
    else if (fn === 'rotate') {
      const c = Math.cos(p * RAD), s = Math.sin(p * RAD), cx = q ?? 0, cy = r ?? 0;
      n = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
    } else if (fn === 'skewX') n = [1, 0, Math.tan(p * RAD), 1, 0, 0];
    else n = [1, Math.tan(p * RAD), 0, 1, 0, 0];
    m = mul(m, n);
  }
  return m;
}

function mapBox(m: Matrix, b: Box): Box {
  const pts = [b.x, b.x + b.width].flatMap(x => [b.y, b.y + b.height].map(y => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Edges touching count: a horizontal rule is a box with no height. */
const meets = (a: Box, b: Box): boolean =>
  Math.min(a.x + a.width, b.x + b.width) >= Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) >= Math.max(a.y, b.y);

const transformOf = (o: Record<string, unknown>): Matrix | null =>
  typeof o['transform'] === 'string' ? parseTransform(o['transform']) : IDENTITY;

/** The canvas box a layer's content can reach; 'none' when it draws nothing; null when it cannot be told. */
function reach(layer: Layer, parent: Matrix): Box | 'none' | null {
  const o = layer as unknown as Record<string, unknown>;
  if (o['visible'] === false) return 'none';
  const own = transformOf(o);
  if (!own) return null;
  const m = mul(parent, own);
  if (!Array.isArray(o['layers'])) {
    const b = drawnBox(layer);
    return b ? mapBox(m, b) : null;
  }
  // Only a plain group places its children where they say; a layout computes them.
  if (o['type'] !== 'group') return null;
  const parts = (o['layers'] as Layer[]).map(k => reach(k, m));
  if (parts.includes(null)) return null;
  const boxes = parts.filter((p): p is Box => p !== null && p !== 'none');
  if (boxes.length === 0) return 'none';
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
}

/** A sampled frame as a rasteriser should see it: the page it renders, unseen clips left out. */
export function cullFrame(spec: DesignSpec): DesignSpec {
  const w = spec.document?.width ?? 1080, h = spec.document?.height ?? 1080;
  const [page, ...rest] = spec.pages ?? [];
  if (page) return { ...spec, pages: [{ ...page, layers: cullUnseenClips(page.layers ?? [], w, h) }, ...rest] };
  return { ...spec, layers: cullUnseenClips(spec.layers ?? [], w, h) };
}

/** Every clipped layer that cannot reach the canvas left out — for a rasteriser, never for the animated SVG. */
export function cullUnseenClips(layers: Layer[], width: number, height: number, parent: Matrix = IDENTITY): Layer[] {
  // Slack for ink past a measured box (strokes, shadows, glyph overshoot); the abort needs far more.
  const pad = Math.max(64, Math.max(width, height) * 0.25);
  const canvas: Box = { x: -pad, y: -pad, width: width + pad * 2, height: height + pad * 2 };
  const out: Layer[] = [];
  for (const layer of layers) {
    const o = layer as unknown as Record<string, unknown>;
    const own = transformOf(o);
    const clip = clipRectFor(layer);
    if (clip && own) {
      const content = reach(layer, parent);
      // The renderer wraps a layer that already has a shape mask, so its rectangle sits in the parent's space.
      const clipBox = mapBox(o['clip_path_ref'] ? parent : mul(parent, own), clip);
      if (content === 'none' || !meets(clipBox, canvas) || (content !== null && !meets(content, canvas))) continue;
    }
    const kids = o['layers'];
    out.push(o['type'] === 'group' && Array.isArray(kids) && own
      ? ({ ...layer, layers: cullUnseenClips(kids as Layer[], width, height, mul(parent, own)) } as Layer)
      : layer);
  }
  return out;
}
