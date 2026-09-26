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

import type { Layer, DesignSpec, Page } from '../schema/types';
import { resolveAutoLayouts } from './auto-layout-place';
import { resolveGalleries } from './resolve-gallery';
import { resolveSourceFormulas, resolveNames, hasSourceFormulas, type SourceProblem } from '../scripting/formula-source';

export interface ResolveOptions {
  /** Give auto-layout children the x/y/width/height their container places them at. */
  place?: boolean;
  /** The design's resolved names, and its canvas — what source formulas read (sourceOptions). */
  names?: Record<string, unknown>;
  W?: number;
  H?: number;
  /** Where formulas that could not be applied are reported. */
  problems?: SourceProblem[];
}

/** What a surface's source formulas read: the design's names with the page's over them, and the canvas. */
export function sourceOptions(spec: DesignSpec, page?: Page, problems?: SourceProblem[]): ResolveOptions {
  const W = spec.document?.width ?? 1080, H = spec.document?.height ?? 1080;
  const raw = { ...(spec.names ?? {}), ...(page?.names ?? {}) };
  return { names: resolveNames(raw, W, H, problems), W, H, ...(problems ? { problems } : {}) };
}

/** Whether anything under `layers` is a rule this step expands. */
function hasRules(layers: Layer[], opts: ResolveOptions): boolean {
  return layers.some(l => {
    if ((opts.place && l.type === 'auto_layout') || hasSourceFormulas(l) || (l.type === 'group' && (l as { gallery?: unknown }).gallery)) return true;
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    return Array.isArray(kids) && hasRules(kids, opts);
  });
}

/** A layer list as consumers see it — the same array when there is nothing to resolve. */
export function resolveLayers(layers: Layer[], opts: ResolveOptions = {}): Layer[] {
  if (!hasRules(layers, opts)) return layers;
  const scope = { names: opts.names ?? {}, W: opts.W ?? 1080, H: opts.H ?? 1080 };
  // A gallery's own formulas (its box, its columns) first; its cells then read their row.
  const galleries = resolveGalleries(resolveSourceFormulas(layers, scope, opts.problems), scope, opts.problems);
  return opts.place ? resolveAutoLayouts(galleries) : galleries;
}

/** A design as consumers see it: its layers and every page's resolved — the same object when nothing changes. */
export function resolveSpec(spec: DesignSpec, opts: ResolveOptions = {}): DesignSpec {
  const layers = spec.layers ? resolveLayers(spec.layers, { ...sourceOptions(spec, undefined, opts.problems), ...opts }) : spec.layers;
  let pagesChanged = false;
  const pages = spec.pages?.map(p => {
    const ls = p.layers ? resolveLayers(p.layers, { ...sourceOptions(spec, p, opts.problems), ...opts }) : p.layers;
    if (ls !== p.layers) pagesChanged = true;
    return ls === p.layers ? p : { ...p, layers: ls };
  });
  if (layers === spec.layers && !pagesChanged) return spec;
  return { ...spec, ...(layers ? { layers } : {}), ...(pagesChanged && pages ? { pages } : {}) };
}
