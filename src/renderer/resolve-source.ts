/**
 * The one step between a design's SOURCE and what every consumer draws or
 * measures (phase 3: procedural source). A design may store rules instead of
 * results — a container that places its children, and in later slices named
 * formulas, galleries and motion rules — and this is the only place they turn
 * into the literal layers and keyframes the renderer, exports, the editor and
 * diagnose already read. Additive by construction: a design with no rules comes
 * back as the SAME object, so literal designs render byte for byte as before.
 *
 * `place` also sets each auto-layout child's box, for the consumers that
 * measure boxes (the renderer places those children itself while it draws).
 */

import type { Layer, DesignSpec } from '../schema/types';
import { resolveAutoLayouts } from './auto-layout-place';

export interface ResolveOptions {
  /** Give auto-layout children the x/y/width/height their container places them at. */
  place?: boolean;
}

/** Whether anything under `layers` is a rule this step expands. */
function hasRules(layers: Layer[], opts: ResolveOptions): boolean {
  return layers.some(l => {
    if (opts.place && l.type === 'auto_layout') return true;
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    return Array.isArray(kids) && hasRules(kids, opts);
  });
}

/** A layer list as consumers see it — the same array when there is nothing to resolve. */
export function resolveLayers(layers: Layer[], opts: ResolveOptions = {}): Layer[] {
  if (!hasRules(layers, opts)) return layers;
  return opts.place ? resolveAutoLayouts(layers) : layers;
}

/** A design as consumers see it: its layers and every page's resolved — the same object when nothing changes. */
export function resolveSpec(spec: DesignSpec, opts: ResolveOptions = {}): DesignSpec {
  const layers = spec.layers ? resolveLayers(spec.layers, opts) : spec.layers;
  let pagesChanged = false;
  const pages = spec.pages?.map(p => {
    const ls = p.layers ? resolveLayers(p.layers, opts) : p.layers;
    if (ls !== p.layers) pagesChanged = true;
    return ls === p.layers ? p : { ...p, layers: ls };
  });
  if (layers === spec.layers && !pagesChanged) return spec;
  return { ...spec, ...(layers ? { layers } : {}), ...(pagesChanged && pages ? { pages } : {}) };
}
