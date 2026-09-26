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
 *
 * Order: source formulas (scripting/formula-source.ts) → galleries
 * (resolve-gallery.ts) → motion rules (resolve-motion.ts) → auto-layout placement.
 */

import type { Layer, DesignSpec, Page } from '../schema/types';
import { resolveAutoLayouts } from './auto-layout-place';
import { resolveGalleries } from './resolve-gallery';
import { resolveMotionRules } from './resolve-motion';
import { resolveSourceFormulas, resolveNames, hasSourceFormulas, type SourceProblem, type SourceScope } from '../scripting/formula-source';
import { readMarkers } from '../mcp/engine/motion-time';

export interface ResolveOptions {
  /** Give auto-layout children the x/y/width/height their container places them at. */
  place?: boolean;
  /** The design's resolved names, and its canvas — what source formulas read (sourceOptions). */
  names?: Record<string, unknown>;
  W?: number;
  H?: number;
  /** The surface's time markers — a motion rule may start at one ("cta+300"). */
  markers?: Record<string, number>;
  /** Where formulas that could not be applied are reported. */
  problems?: SourceProblem[];
}

/** What a surface's source formulas read: the design's names with the page's over them, the canvas and the markers. */
export function sourceOptions(spec: DesignSpec, page?: Page, problems?: SourceProblem[]): ResolveOptions {
  const W = spec.document?.width ?? 1080, H = spec.document?.height ?? 1080;
  const raw = { ...(spec.names ?? {}), ...(page?.names ?? {}) };
  const markers = readMarkers(spec, page);
  return { names: resolveNames(raw, W, H, problems), W, H, ...(Object.keys(markers).length ? { markers } : {}), ...(problems ? { problems } : {}) };
}

/** The scope formulas and rules are evaluated in, from a surface's options. */
export const scopeOf = (o: ResolveOptions): SourceScope =>
  ({ names: o.names ?? {}, W: o.W ?? 1080, H: o.H ?? 1080, ...(o.markers ? { markers: o.markers } : {}) });

/** Whether the layer itself stores a rule: source formulas, a gallery or a motion rule. */
export function carriesRule(l: Layer): boolean {
  return hasSourceFormulas(l) || (l.type === 'group' && !!(l as { gallery?: unknown }).gallery)
    || (l as { animation?: { rule?: unknown } }).animation?.rule !== undefined;
}

/** Whether anything under `layers` is a rule this step expands. */
function hasRules(layers: Layer[], opts: ResolveOptions): boolean {
  return layers.some(l => {
    if ((opts.place && l.type === 'auto_layout') || carriesRule(l) || (l.type === 'script' && opts.markers)) return true;
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    return Array.isArray(kids) && hasRules(kids, opts);
  });
}

/** A layer list as consumers see it — the same array when there is nothing to resolve. */
export function resolveLayers(layers: Layer[], opts: ResolveOptions = {}): Layer[] {
  if (!hasRules(layers, opts)) return layers;
  const scope = scopeOf(opts);
  // A gallery's own formulas (its box, its columns) first; its cells then read their row.
  const galleries = resolveGalleries(resolveSourceFormulas(layers, scope, opts.problems), scope, opts.problems);
  const moving = stampMarkers(resolveMotionRules(galleries, scope, opts.problems), opts.markers);
  return opts.place ? resolveAutoLayouts(moving) : moving;
}

/**
 * Every script component with the surface's markers, read as folio.markers.
 * Found live (Opus 5.5 promo): a script timed itself by writing the marker's
 * ms into its code ("t - 35600"), so op:retime or op:markers moved the scene
 * and left the drawing behind. "t - folio.markers.g" moves with it.
 */
function stampMarkers(layers: Layer[], markers: Record<string, number> | undefined): Layer[] {
  if (!markers) return layers;
  const out = layers.map((l): Layer => {
    if (l.type === 'script') return { ...l, script_markers: markers } as Layer;
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    const next = Array.isArray(kids) ? stampMarkers(kids, markers) : kids;
    return next === kids ? l : ({ ...l, layers: next } as Layer);
  });
  return out.every((l, i) => l === layers[i]) ? layers : out;
}

/** The layers without the stamp — for a resolved tree that is written back (edit_layer detach). */
export function unstampMarkers(layers: Layer[]): Layer[] {
  return layers.map((l): Layer => {
    const { script_markers: _m, ...rest } = l as Layer & { script_markers?: unknown; layers?: Layer[] };
    void _m;
    return (Array.isArray(rest.layers) ? { ...rest, layers: unstampMarkers(rest.layers) } : rest) as Layer;
  });
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
