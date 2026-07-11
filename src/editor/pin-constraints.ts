// WP-4.10 — responsive pin constraints. When the document is resized, a layer
// with `constraints` keeps the offset from each pinned edge (and stretches when
// BOTH opposing edges are pinned and its size isn't fixed). Unpinned axes float
// proportionally so an unconstrained layer keeps its relative placement.
//
// Pure + DOM-free so it unit-tests cleanly and could run server-side too. Only
// numeric x/y/width/height are touched; layers without them pass through.

import type { Layer, PinConstraints } from '../schema/types';

export interface DocSize { width: number; height: number }

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// One axis: returns the new [start, size] for the given pin edges. `start` is
// x or y; `size` is width or height; `D`/`D2` are the old/new doc extents.
function solveAxis(
  start: number, size: number, D: number, D2: number,
  pinStart: boolean, pinEnd: boolean, fixSize: boolean,
): [number, number] {
  const endGap = D - start - size;          // offset from the far edge (old doc)
  if (pinStart && pinEnd && !fixSize) {
    // Stretch: hold both offsets, absorb the delta in size.
    return [start, Math.max(1, D2 - start - endGap)];
  }
  if (pinEnd && !pinStart) {
    // Hold the far-edge offset; size unchanged.
    return [D2 - endGap - size, size];
  }
  if (pinStart) {
    // Hold the near-edge offset; size unchanged (covers left+right+fixSize too).
    return [start, size];
  }
  // Neither edge pinned → float proportionally by the layer's center.
  const ratio = D === 0 ? 1 : D2 / D;
  const center = (start + size / 2) * ratio;
  return [center - size / 2, size];
}

/** Reposition/resize one layer for a doc resize per its constraints. Returns a
 *  new layer object when anything changed, else the same reference. */
export function pinLayer(layer: Layer, from: DocSize, to: DocSize): Layer {
  const c = (layer as { constraints?: PinConstraints }).constraints;
  if (!c) return layer;
  const x = num((layer as { x?: unknown }).x);
  const y = num((layer as { y?: unknown }).y);
  const w = num((layer as { width?: unknown }).width);
  const h = num((layer as { height?: unknown }).height);
  if (x === null || y === null || w === null || h === null) return layer;

  const [nx, nw] = solveAxis(x, w, from.width, to.width, !!c.left, !!c.right, !!c.fix_width);
  const [ny, nh] = solveAxis(y, h, from.height, to.height, !!c.top, !!c.bottom, !!c.fix_height);

  const rx = Math.round(nx), ry = Math.round(ny), rw = Math.round(nw), rh = Math.round(nh);
  if (rx === x && ry === y && rw === w && rh === h) return layer;
  return { ...layer, x: rx, y: ry, width: rw, height: rh } as Layer;
}

/** Apply pin constraints to a layer list (top level). Recurses into groups so a
 *  pinned child of a group is still adjusted against the DOCUMENT (matching how
 *  the model authors full-canvas pins). Returns a new array when any changed. */
export function applyPinConstraints(layers: Layer[], from: DocSize, to: DocSize): Layer[] {
  if (from.width === to.width && from.height === to.height) return layers;
  let changed = false;
  const out = layers.map((l) => {
    let next = pinLayer(l, from, to);
    const kids = (next as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) {
      const nkids = applyPinConstraints(kids, from, to);
      if (nkids !== kids) next = { ...(next as object), layers: nkids } as unknown as Layer;
    }
    if (next !== l) changed = true;
    return next;
  });
  return changed ? out : layers;
}
