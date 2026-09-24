/**
 * The arrangement of a piece's blocks as a tree, by recursive XY-cut (the
 * document-layout classic): split at the widest run of empty space across the
 * blocks — between columns (x) or between rows (y) — and recurse into each
 * side. A number and the label under it stay one column; the columns of a
 * 16:9 slide are the children of an x node.
 *
 * Laid out, a subtree nothing inside has changed keeps its arrangement whole
 * (one map for all of it). An x node may be STACKED: its columns go one under
 * another, left edges together, `gap` apart — the design's own row rhythm. The
 * rest keeps the offsets and gaps it was authored with.
 */

import type { Layer } from '../../schema/types';
import type { Affine } from './reframe-map';

export interface Box { x: number; y: number; width: number; height: number }
export interface Block { items: Layer[]; box: Box }
export type Tree = { kind: 'leaf'; blocks: Block[]; box: Box } | { kind: 'x' | 'y'; kids: Tree[]; box: Box };
export interface Size { w: number; h: number }

export const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};
const unionAll = (bs: Block[]): Box => bs.map(b => b.box).reduce(union);

/** Blocks grouped by the empty runs along one axis, and the widest run. */
function runs(blocks: Block[], axis: 'x' | 'y'): { groups: Block[][]; widest: number } {
  const lo = (b: Block): number => (axis === 'x' ? b.box.x : b.box.y);
  const hi = (b: Block): number => (axis === 'x' ? b.box.x + b.box.width : b.box.y + b.box.height);
  const sorted = [...blocks].sort((p, q) => lo(p) - lo(q));
  const groups: Block[][] = [];
  let end = -Infinity, widest = 0;
  for (const b of sorted) {
    const last = groups[groups.length - 1];
    if (last && lo(b) < end) last.push(b);
    else { if (last) widest = Math.max(widest, lo(b) - end); groups.push([b]); }
    end = Math.max(end, hi(b));
  }
  return { groups, widest };
}

export function xyCut(blocks: Block[]): Tree {
  const box = unionAll(blocks);
  if (blocks.length < 2) return { kind: 'leaf', blocks, box };
  const bx = runs(blocks, 'x'), by = runs(blocks, 'y');
  // Rows win a tie: reading order is top to bottom first.
  const [kind, best] = bx.widest > by.widest ? ['x', bx] as const : ['y', by] as const;
  if (best.groups.length < 2) return { kind: 'leaf', blocks, box };
  return { kind, kids: best.groups.map(xyCut), box };
}

/** Every x node, outermost first: the places a row can become a column. */
export const xNodes = (t: Tree): Tree[] => (t.kind === 'leaf' ? [] : [...(t.kind === 'x' ? [t] : []), ...t.kids.flatMap(xNodes)]);
/** The empty space between a node's consecutive children along its axis. */
const gapBefore = (t: Tree & { kids: Tree[] }, i: number): number => {
  const a = t.kids[i - 1]?.box, b = t.kids[i]?.box;
  if (!a || !b) return 0;
  return Math.max(0, t.kind === 'x' ? b.x - (a.x + a.width) : b.y - (a.y + a.height));
};
/** The design's own vertical rhythm: the median gap between its rows. */
export function rowGap(t: Tree, floor: number): number {
  const gaps: number[] = [];
  const walk = (n: Tree): void => { if (n.kind === 'leaf') return; if (n.kind === 'y') n.kids.forEach((_, i) => { if (i) gaps.push(gapBefore(n, i)); }); n.kids.forEach(walk); };
  walk(t);
  const s = gaps.filter(g => g > 0).sort((a, b) => a - b);
  return Math.max(floor, s[Math.floor(s.length / 2)] ?? floor);
}

const intact = (t: Tree, stacked: Set<Tree>): boolean => t.kind === 'leaf' || (!stacked.has(t) && t.kids.every(k => intact(k, stacked)));

/** A node's size (in source px) with the chosen x nodes stacked. */
export function sizeOf(t: Tree, stacked: Set<Tree>, gap: number): Size {
  if (t.kind === 'leaf' || intact(t, stacked)) return { w: t.box.width, h: t.box.height };
  const kids = t.kids.map(k => sizeOf(k, stacked, gap));
  if (stacked.has(t)) return { w: Math.max(...kids.map(s => s.w)), h: kids.reduce((s, k) => s + k.h, 0) + gap * (kids.length - 1) };
  let w = 0, h = 0;
  t.kids.forEach((k, i) => {
    const s = kids[i] ?? { w: 0, h: 0 };
    if (t.kind === 'y') { w = Math.max(w, k.box.x - t.box.x + s.w); h += s.h + gapBefore(t, i); }
    else { h = Math.max(h, k.box.y - t.box.y + s.h); w += s.w + gapBefore(t, i); }
  });
  return { w, h };
}

const leaves = (t: Tree): Block[] => (t.kind === 'leaf' ? t.blocks : t.kids.flatMap(leaves));

/** Seat a node's top-left at (x, y) at scale k, writing each layer's map. */
export function placeTree(t: Tree, x: number, y: number, k: number, stacked: Set<Tree>, gap: number, maps: Map<Layer, Affine>): void {
  if (t.kind === 'leaf' || intact(t, stacked)) {
    const m: Affine = { k, ox: t.box.x, oy: t.box.y, dx: x - t.box.x, dy: y - t.box.y };
    for (const b of leaves(t)) for (const l of b.items) maps.set(l, m);
    return;
  }
  let cx = x, cy = y;
  t.kids.forEach((kid, i) => {
    const s = sizeOf(kid, stacked, gap);
    if (stacked.has(t)) { if (i) cy += k * gap; placeTree(kid, x, cy, k, stacked, gap, maps); cy += k * s.h; }
    else if (t.kind === 'y') { cy += k * gapBefore(t, i); placeTree(kid, x + k * (kid.box.x - t.box.x), cy, k, stacked, gap, maps); cy += k * s.h; }
    else { cx += k * gapBefore(t, i); placeTree(kid, cx, y + k * (kid.box.y - t.box.y), k, stacked, gap, maps); cx += k * s.w; }
  });
}
