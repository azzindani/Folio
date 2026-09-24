/**
 * Where an auto-layout container puts its children — the one placement the
 * renderer draws and every measure reads. Found in the benchmark (r8): a
 * timetable flowed its acts through column containers; the renderer placed
 * them, but diagnose read each child's own (absent) x/y as 0,0 — 32 texts
 * "inside the title-safe margin" and a headliner "overprinting" a lantern in
 * the canvas's top-left corner.
 */

import type { Layer, AutoLayoutLayer } from '../schema/types';
import { normalizePadding } from './layer-renderers-shared';

/** The children in paint order, each with the x/y/width/height the container gives it. */
export function placeAutoLayoutChildren(layer: AutoLayoutLayer): Layer[] {
  const isRow = layer.direction === 'row';
  const gap = layer.gap ?? 0;
  const pad = normalizePadding(layer.padding);
  const x = layer.x ?? 0;
  const y = layer.y ?? 0;
  const w = typeof layer.width === 'number' ? layer.width : 0;
  const h = typeof layer.height === 'number' ? layer.height : 0;
  const align = layer.align_items ?? 'start';
  const justify = layer.justify_content ?? 'start';

  const sorted = [...(layer.layers ?? [])].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  const mainSizes = sorted.map(c => (isRow ? (typeof c.width === 'number' ? c.width : 0) : (typeof c.height === 'number' ? c.height : 0)));
  const crossSizes = sorted.map(c => (isRow ? (typeof c.height === 'number' ? c.height : 0) : (typeof c.width === 'number' ? c.width : 0)));

  const mainPadStart = isRow ? pad.left : pad.top;
  const mainPadEnd = isRow ? pad.right : pad.bottom;
  const crossPadStart = isRow ? pad.top : pad.left;
  const availableMain = (isRow ? w : h) - mainPadStart - mainPadEnd;
  const availableCross = (isRow ? h : w) - crossPadStart - (isRow ? pad.bottom : pad.right);

  // Flexbox-style sizing for children that omit dimensions: those with no
  // main-axis size share the leftover main space (flex-grow:1); those with no
  // cross-axis size fill the cross. Skipped when wrapping (wrap needs
  // intrinsic sizes). Sized children are left untouched.
  if (!layer.wrap && availableMain > 0) {
    const flexIdx = sorted.map((_, i) => i).filter(i => !((mainSizes[i] ?? 0) > 0));
    if (flexIdx.length) {
      const fixed = mainSizes.reduce((s, v) => s + (v > 0 ? v : 0), 0);
      const gaps = Math.max(0, sorted.length - 1) * gap;
      const share = Math.max(0, (availableMain - fixed - gaps) / flexIdx.length);
      for (const i of flexIdx) mainSizes[i] = share;
    }
    for (let i = 0; i < crossSizes.length; i++) if (!((crossSizes[i] ?? 0) > 0)) crossSizes[i] = availableCross;
  }
  const totalMain = mainSizes.reduce((s, v) => s + v, 0) + Math.max(0, sorted.length - 1) * gap;

  const cursorFor = (total: number, count: number, sizes: number[]): { start: number; dynGap: number } => {
    const used = sizes.reduce((s, v) => s + v, 0);
    switch (justify) {
      case 'center': return { start: mainPadStart + (availableMain - total) / 2, dynGap: gap };
      case 'end': return { start: mainPadStart + availableMain - total, dynGap: gap };
      case 'space-between': return { start: mainPadStart, dynGap: count > 1 ? (availableMain - used) / (count - 1) : 0 };
      case 'space-around': { const sp = availableMain - used; return { start: mainPadStart + (sp / count) / 2, dynGap: sp / count }; }
      default: return { start: mainPadStart, dynGap: gap };
    }
  };

  const out: Layer[] = [];
  const place = (child: Layer, mc: number, cc: number, i: number, trackCross: number): void => {
    const cross = crossSizes[i] ?? 0;
    const crossPos = align === 'center' ? cc + (trackCross - cross) / 2 : align === 'end' ? cc + trackCross - cross : cc;
    // The layout-computed sizes (== the child's own size when it set one; the
    // flex/fill value otherwise), so nested containers know their box.
    const mainSize = mainSizes[i] ?? 0;
    const crossSize = align === 'stretch' ? trackCross : cross;
    out.push({ ...child, x: isRow ? x + mc : x + crossPos, y: isRow ? y + crossPos : y + mc,
      width: isRow ? mainSize : crossSize, height: isRow ? crossSize : mainSize } as Layer);
  };

  if (layer.wrap && availableMain > 0) {
    const tracks: number[][] = [];
    let track: number[] = [];
    let used = 0;
    for (let i = 0; i < sorted.length; i++) {
      const sz = mainSizes[i] ?? 0;
      const needed = track.length === 0 ? sz : used + gap + sz;
      if (track.length > 0 && needed > availableMain + 0.5) { tracks.push(track); track = [i]; used = sz; } else { track.push(i); used = needed; }
    }
    if (track.length > 0) tracks.push(track);
    let crossCursor = crossPadStart;
    for (const idxs of tracks) {
      const sizes = idxs.map(i => mainSizes[i] ?? 0);
      const total = sizes.reduce((s, v) => s + v, 0) + Math.max(0, idxs.length - 1) * gap;
      const trackCross = Math.max(...idxs.map(i => crossSizes[i] ?? 0));
      const { start, dynGap } = cursorFor(total, idxs.length, sizes);
      let mc = start;
      idxs.forEach((i, j) => { const c = sorted[i]; if (c) place(c, mc, crossCursor, i, trackCross); mc += (sizes[j] ?? 0) + dynGap; });
      crossCursor += trackCross + gap;
    }
  } else {
    const { start, dynGap } = cursorFor(totalMain, sorted.length, mainSizes);
    let cursor = start;
    sorted.forEach((c, i) => { place(c, cursor, crossPadStart, i, availableCross); cursor += (mainSizes[i] ?? 0) + dynGap; });
  }
  return out;
}

/** The tree with every auto-layout container's children placed where the renderer draws them. */
export function resolveAutoLayouts(layers: Layer[]): Layer[] {
  return layers.map(l => {
    if (l.type === 'auto_layout') return { ...l, layers: resolveAutoLayouts(placeAutoLayoutChildren(l as AutoLayoutLayer)) } as Layer;
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    return Array.isArray(kids) ? ({ ...l, layers: resolveAutoLayouts(kids) } as Layer) : l;
  });
}
