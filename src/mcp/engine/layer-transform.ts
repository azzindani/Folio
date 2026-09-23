// Moving and scaling a layer AS DRAWN — the layer and everything inside it.
//
// A group renders as a bare <g>: its children carry absolute document
// coordinates, and a path's `d` or a polygon's `points` are absolute too. So
// changing a group's x/y moves its box and nothing it draws. Found live
// (2026-09-20): a revision moved a group and "b1's children got baked with the
// group offset", and edit_layer(op:align) did the same to every group and path
// it aligned — the reply said aligned, the ink stayed where it was.

import type { Layer } from '../../schema/types';
import { scalePathD, scalePoints, scaleSubtree } from '../preset-fit';

export interface Rect { x: number; y: number; w: number; h: number }

const r2 = (v: number): number => Math.round(v * 100) / 100;
const kidsOf = (l: Layer): Layer[] | null => {
  const k = (l as { layers?: unknown }).layers;
  return Array.isArray(k) ? (k as Layer[]) : null;
};

/** Shift a layer and every descendant by (dx, dy). Sizes are untouched. */
export function translateSubtree(layer: Layer, dx: number, dy: number): void {
  const o = layer as unknown as Record<string, unknown>;
  const shift = (key: string, d: number): void => { if (d && typeof o[key] === 'number') o[key] = r2((o[key] as number) + d); };
  const pos = o['pos'];
  if (Array.isArray(pos) && typeof pos[0] === 'number' && typeof pos[1] === 'number') {
    pos[0] = r2(pos[0] + dx); pos[1] = r2(pos[1] + dy);
  } else { shift('x', dx); shift('y', dy); }
  shift('x1', dx); shift('x2', dx); shift('y1', dy); shift('y2', dy);
  if (typeof o['d'] === 'string') o['d'] = scalePathD(o['d'] as string, 1, 0, 0, dx, dy);
  if (typeof o['points'] === 'string') o['points'] = scalePoints(o['points'] as string, 1, 0, 0, dx, dy);
  for (const c of kidsOf(layer) ?? []) translateSubtree(c, dx, dy);
}

/** `pos:[x,y,w,h]` → x/y/width/height, through the subtree, so the box
 *  arithmetic in scaleSubtree sees every layer. */
function unpos(layer: Layer): void {
  const o = layer as unknown as Record<string, unknown>;
  const p = o['pos'];
  if (Array.isArray(p) && p.length >= 4 && p.every(v => typeof v === 'number')) {
    [o['x'], o['y'], o['width'], o['height']] = p as number[];
    delete o['pos'];
  }
  for (const c of kidsOf(layer) ?? []) unpos(c);
}

/** Scale a layer subtree by k about (ox, oy): boxes, endpoints, paths, and the
 *  lengths that go with them (font size, stroke, radius, gap…). */
export function scaleAbout(layer: Layer, k: number, ox: number, oy: number): void {
  unpos(layer);
  scaleSubtree(layer, k, ox, oy, 0, 0);
}

function ownBox(l: Layer): Rect | null {
  const o = l as unknown as Record<string, unknown>;
  const p = o['pos'];
  const [x, y, w, h] = Array.isArray(p) && p.length >= 4 ? p : [o['x'], o['y'], o['width'], o['height']];
  if ([x, y, w, h].every(v => typeof v === 'number')) return { x: x as number, y: y as number, w: w as number, h: h as number };
  const e = ['x1', 'y1', 'x2', 'y2'].map(k => o[k]);
  if (e.every(v => typeof v === 'number')) {
    const [x1, y1, x2, y2] = e as number[];
    return { x: Math.min(x1 ?? 0, x2 ?? 0), y: Math.min(y1 ?? 0, y2 ?? 0), w: Math.abs((x2 ?? 0) - (x1 ?? 0)), h: Math.abs((y2 ?? 0) - (y1 ?? 0)) };
  }
  return null;
}

export function union(boxes: Rect[]): Rect | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
}

/** Where a layer draws: a group's children when it has any (its declared box
 *  can disagree with them), the layer's own box otherwise. */
export function drawnBox(l: Layer): Rect | null {
  const kids = kidsOf(l);
  if (kids?.length) {
    const inner = union(kids.map(drawnBox).filter((b): b is Rect => b !== null));
    if (inner) return inner;
  }
  return ownBox(l);
}

export interface Targets {
  /** Found, and not inside another target (it would move twice). */
  targets: Layer[];
  unresolved: string[];
  /** Targets inside a LOCKED group — `id (in "group")`. Edited all the same (they
   *  were named — see LOCKED_EDIT_NOTE); listed so the reply can say so. */
  locked: string[];
}

/** Find layers by id anywhere in the tree. Group children carry absolute
 *  coordinates, so a target at any depth is edited where it is. */
export function findTargets(layers: Layer[], ids: string[]): Targets {
  const wanted = new Set(ids);
  const found = new Map<string, { l: Layer; lockedBy?: string; inTarget: boolean }>();
  const walk = (ls: Layer[], lockedBy: string | undefined, inTarget: boolean): void => {
    for (const l of ls) {
      const hit = wanted.has(l.id) && !found.has(l.id);
      if (hit) found.set(l.id, { l, ...(lockedBy ? { lockedBy } : {}), inTarget });
      const kids = kidsOf(l);
      if (kids) walk(kids, lockedBy ?? ((l as { locked?: unknown }).locked ? l.id : undefined), inTarget || hit);
    }
  };
  walk(layers, undefined, false);
  const all = [...found.values()];
  return {
    targets: all.filter(f => !f.inTarget).map(f => f.l),
    unresolved: ids.filter(id => !found.has(id)),
    locked: all.filter(f => f.lockedBy && !f.inTarget).map(f => `${f.l.id} (in "${f.lockedBy}")`),
  };
}
