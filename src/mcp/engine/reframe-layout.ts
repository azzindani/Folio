/**
 * Where each part of a piece goes when its frame changes shape — the spatial
 * half of manage_design {op:"reframe"}. No layout is invented: the model's own
 * blocks (layers that overlap belong together) keep their inner composition,
 * and only the arrangement BETWEEN them is recomputed.
 *
 * The blocks' arrangement is read as an XY-cut tree (reframe-tree.ts). A 16:9
 * row of columns does not fit a 9:16 frame at any readable size, so its
 * columns may be stacked — but only where that lets the content scale larger
 * (each x node tried, greedily). The scale is capped at the ratio of the
 * frames' short sides, so type keeps its size relative to the frame. The whole
 * keeps where it sat across its old margins (left stays left, centred stays
 * centred) and the old split of empty space above and below.
 *
 * Grounds span the new frame. Bands, glows and faint shapes are not blocks:
 * they go wherever the block they sit behind goes. A page with a camera world,
 * or a scene group that itself moves, is carried whole by the op (uniform scale).
 */

import type { Layer } from '../../schema/types';
import { drawnBox } from '../../export/frame-geometry';
import type { Affine } from './reframe-map';
import { xyCut, xNodes, rowGap, sizeOf, placeTree, union, type Tree, type Block, type Box } from './reframe-tree';
import { feedSafeBox } from './diagnose-safe';

type Node = Layer & { layers?: Layer[]; animation?: unknown; clock?: unknown; link?: unknown; effects?: { blur?: unknown }; opacity?: number };
export type { Box };
export type Span = { w: boolean; h: boolean };

export interface ReframePlan {
  /** The content's scale. */
  k: number;
  /** Every layer that moves, and where to. */
  maps: Map<Layer, Affine>;
  /** Grounds and bands: after the map, they span the new frame on these axes. */
  spans: Map<Layer, Span>;
  /** Scene groups opened up to reach their blocks: their own box becomes the frame. */
  holders: Layer[];
  /** Blocks, and the side-by-side groups stacked into a column. */
  blocks: number; stacked: number;
}

const area = (b: Box): number => Math.max(0, b.width) * Math.max(0, b.height);
const meet = (a: Box, b: Box, pad = 0): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + pad;
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + pad;
  return w > 0 && h > 0 ? w * h : 0;
};
const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);

/** What a layer draws; a group, what its children draw. */
export function boxOf(l: Layer): Box | null {
  const kids = (l as Node).layers;
  if (Array.isArray(kids)) return kids.map(boxOf).reduce<Box | null>((a, b) => (a && b ? union(a, b) : a ?? b), null);
  return drawnBox(l);
}

const moves = (l: Node): boolean => !!(l.animation || l.clock || l.link);

/** Scene groups (most of the frame, not moving themselves) are opened up; everything else is an item. */
function items(layers: Layer[], oldArea: number, holders: Layer[], out: Layer[] = []): Layer[] {
  for (const l of layers as Node[]) {
    const b = boxOf(l);
    if (Array.isArray(l.layers) && l.layers.length > 1 && !moves(l) && b && area(b) >= 0.8 * oldArea) {
      holders.push(l);
      items(l.layers, oldArea, holders, out);
    } else out.push(l);
  }
  return out;
}

/** Faint or soft things sit behind a block rather than being one. */
const atmosphere = (l: Node): boolean => (typeof l.opacity === 'number' && l.opacity <= 0.3) || (typeof l.effects?.blur === 'number' && l.effects.blur >= 6);

/** Overlapping items, one block each (union-find over their boxes). */
function blocksOf(content: Array<{ l: Layer; b: Box }>): Block[] {
  const root = content.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i] ?? i)));
  for (let i = 0; i < content.length; i++) {
    for (let j = i + 1; j < content.length; j++) {
      const a = content[i], c = content[j];
      if (a && c && meet(a.b, c.b, 2) > 0) root[find(i)] = find(j);
    }
  }
  const by = new Map<number, Block>();
  content.forEach((c, i) => {
    const r = find(i), blk = by.get(r);
    if (blk) { blk.items.push(c.l); blk.box = union(blk.box, c.b); } else by.set(r, { items: [c.l], box: c.b });
  });
  return [...by.values()];
}

export function planReframe(layers: Layer[], oldW: number, oldH: number, W: number, H: number): ReframePlan {
  const holders: Layer[] = [];
  const spans = new Map<Layer, Span>();
  const all = items(layers, oldW * oldH, holders);
  const content: Array<{ l: Layer; b: Box }> = [], behind: Array<{ l: Layer; b: Box }> = [];
  for (const l of all) {
    const b = boxOf(l);
    if (!b || area(b) <= 0) continue;
    const span = { w: b.x <= oldW * 0.01 && b.x + b.width >= oldW * 0.99, h: b.y <= oldH * 0.01 && b.y + b.height >= oldH * 0.99 };
    if (span.w || span.h) spans.set(l, span);
    (span.w || span.h || atmosphere(l as Node) ? behind : content).push({ l, b });
  }
  const blocks = blocksOf(content);
  const short = Math.min(oldW, oldH);
  const all0 = blocks.map(b => b.box).reduce<Box | null>((a, b) => (a ? union(a, b) : b), null) ?? { x: 0, y: 0, width: oldW, height: oldH };
  const oldMargin = Math.max(0, Math.min(all0.x, all0.y, oldW - all0.x - all0.width, oldH - all0.y - all0.height));
  const m = Math.round(Math.min(W, H) * Math.max(0.04, Math.min(0.12, oldMargin / short)));
  const cap = Math.min(W, H) / short;
  // Inside the margins — and on a 9:16 frame, clear of the feed's own interface, the box the gate measures.
  const safe = feedSafeBox(W, H);
  const ix = Math.max(m, safe?.x ?? 0), iy = Math.max(m, safe?.y ?? 0);
  const inner: Box = { x: ix, y: iy, width: Math.min(W - m, safe ? safe.x + safe.width : W) - ix, height: Math.min(H - m, safe ? safe.y + safe.height : H) - iy };
  const maps = new Map<Layer, Affine>();
  const stacked = new Set<Tree>();
  let k = cap;
  if (blocks.length) {
    const tree = xyCut(blocks);
    const gap = rowGap(tree, 0.04 * short);
    const fit = (): number => { const s = sizeOf(tree, stacked, gap); return Math.min(cap, s.w ? inner.width / s.w : cap, s.h ? inner.height / s.h : cap); };
    k = fit();
    // A row of marks — pagination dashes, dots — is one gesture: stacked, a progress bar read as a menu icon.
    const stackable = xNodes(tree).filter(n => n.kind !== 'leaf' && n.kids.some(c => c.box.height >= 0.03 * short));
    // Greedily stack the x node that most enlarges the content, while one does.
    for (;;) {
      let best: Tree | null = null, bestK = k;
      for (const n of stackable) { if (stacked.has(n)) continue; stacked.add(n); const kk = fit(); stacked.delete(n); if (kk > bestK + 1e-6) { best = n; bestK = kk; } }
      if (!best) break;
      stacked.add(best); k = bestK;
    }
    // The whole keeps its place across the old margins, and the old split of space above and below.
    const s = sizeOf(tree, stacked, gap);
    const above = all0.y, below = oldH - all0.y - all0.height;
    const x = inner.x + (inner.width - k * s.w) * clamp01((all0.x - oldMargin) / (oldW - 2 * oldMargin - all0.width));
    const y = inner.y + (inner.height - k * s.h) * clamp01(above / (above + below));
    placeTree(tree, x, y, k, stacked, gap, maps);
  }
  // What sits behind goes where the block it covers most goes; a ground, or a
  // shape behind nothing, about the frame's centre.
  const centre: Affine = { k, ox: oldW / 2, oy: oldH / 2, dx: W / 2 - oldW / 2, dy: H / 2 - oldH / 2 };
  for (const { l, b } of behind) {
    const span = spans.get(l);
    if (span?.w && span.h) { maps.set(l, centre); continue; }
    const host = blocks.map(blk => ({ blk, over: meet(blk.box, b) })).sort((p, q) => q.over - p.over)[0];
    const hostMap = host && host.over > 0 ? maps.get(host.blk.items[0] ?? l) : undefined;
    maps.set(l, hostMap ?? centre);
  }
  return { k, maps, spans, holders, blocks: blocks.length, stacked: stacked.size };
}
