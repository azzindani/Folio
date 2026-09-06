// Finding a layer by id — ONE implementation, because the ops that do it their
// own way kept disagreeing about what a layer even is.
//
// A poster's layers are a TREE: every MCP poster is one group, and 267 of the
// 279 designs on the server contain one. But most ops scanned only the top
// level, so the same id meant different things depending on which door you
// used:
//
//   update      recursed        → could edit a group child
//   remove      flat            → "Layer not found" for that same child
//   align       flat            → "No positioned target layers found" (pass 16)
//   component   flat            → "No matching layers for IDs"
//
// And the carousel guard — the one whose comment calls it "the silent-nuke
// footgun" — asked only about TOP-LEVEL ids, so an unscoped update on a group
// child sailed past it and patched all three pages, reporting one.
//
// `locked` had the same shape: a user's explicit "do not touch this" was
// honoured by update and align, and ignored by split_text, keyframe, motion and
// patch_spec.
import type { DesignSpec, Layer } from '../../schema/types';

/** A layer found in the tree, with the nearest LOCKED group above it (if any). */
export interface Hit {
  layer: Layer;
  lockedBy?: string;
}

const childrenOf = (l: Layer): Layer[] | undefined => {
  const kids = (l as Layer & { layers?: Layer[] }).layers;
  return l.type === 'group' && Array.isArray(kids) ? kids : undefined;
};

const isLocked = (l: Layer): boolean => Boolean((l as { locked?: unknown }).locked);

/** Depth-first walk, carrying the nearest locked group down the tree. */
export function findDeep(layers: Layer[] | undefined, id: string, lockedAncestor?: string): Hit | null {
  for (const l of layers ?? []) {
    if (l.id === id) return lockedAncestor === undefined ? { layer: l } : { layer: l, lockedBy: lockedAncestor };
    const kids = childrenOf(l);
    if (kids) {
      const found = findDeep(kids, id, lockedAncestor ?? (isLocked(l) ? l.id : undefined));
      if (found) return found;
    }
  }
  return null;
}

/**
 * Which scopes — root and/or page ids — contain this layer, AT ANY DEPTH.
 *
 * More than one means an unscoped edit would hit several carousel pages at
 * once. Carousel pages are built from the same presets, so their group children
 * share ids (st_grain, sections_1) exactly as their groups do; checking only the
 * top level answered "nowhere" for every one of them.
 */
export function scopesWithLayer(spec: DesignSpec, layerId: string): string[] {
  const hits: string[] = [];
  if (findDeep(spec.layers, layerId)) hits.push('(root)');
  for (const p of spec.pages ?? []) if (findDeep(p.layers, layerId)) hits.push(p.id);
  return hits;
}

/**
 * The nearest LOCKED group above this layer, or null.
 *
 * `pageId` scopes the search to one carousel page; without it the whole design
 * is searched and the first match wins, which matches how the unscoped ops
 * resolve an id.
 */
export function lockedAncestorOf(spec: DesignSpec, layerId: string, pageId?: string): string | null {
  const scopes: (Layer[] | undefined)[] = pageId
    ? [spec.pages?.find(p => p.id === pageId)?.layers]
    : [spec.layers, ...(spec.pages ?? []).map(p => p.layers)];
  for (const layers of scopes) {
    const hit = findDeep(layers, layerId);
    if (hit) return hit.lockedBy ?? null;
  }
  return null;
}

/** The refusal every mutating op should give, worded the same way. */
export function lockedError(layerId: string, lockedBy: string): { error: string; hint: string } {
  return {
    error: `Layer "${layerId}" is inside the LOCKED group "${lockedBy}" — not modified.`,
    hint: `Unlock it first: edit_layer {op:"update", layer_id:"${lockedBy}", props:{locked:false}}.`,
  };
}

/** Drop a layer by id ANYWHERE in the tree; returns how many were removed. */
export function removeDeep(layers: Layer[], id: string): { layers: Layer[]; removed: number } {
  let removed = 0;
  const walk = (ls: Layer[]): Layer[] => {
    const kept: Layer[] = [];
    for (const l of ls) {
      if (l.id === id) { removed++; continue; }
      const kids = childrenOf(l);
      if (kids) kept.push({ ...l, layers: walk(kids) } as Layer);
      else kept.push(l);
    }
    return kept;
  };
  return { layers: walk(layers), removed };
}

/**
 * The id of the GROUP directly containing this layer, or null when it sits at
 * the top level. Returned as an id rather than the array itself because callers
 * that rebuild the tree (removeDeep spreads new objects) would be left holding a
 * stale reference.
 */
export function parentIdOf(layers: Layer[] | undefined, id: string): string | null {
  for (const l of layers ?? []) {
    const kids = childrenOf(l);
    if (!kids) continue;
    if (kids.some(k => k.id === id)) return l.id;
    const deeper = parentIdOf(kids, id);
    if (deeper !== null) return deeper;
  }
  return null;
}

/** The group with this id, anywhere in the tree — for re-entering after a rebuild. */
export function groupById(layers: Layer[] | undefined, id: string): Layer | null {
  const hit = findDeep(layers, id);
  return hit && childrenOf(hit.layer) ? hit.layer : null;
}

/** Collect several layers by id from anywhere in the tree, in the order asked. */
export function findAllDeep(layers: Layer[] | undefined, ids: string[]): { found: Hit[]; missing: string[] } {
  const found: Hit[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const hit = findDeep(layers, id);
    if (hit) found.push(hit); else missing.push(id);
  }
  return { found, missing };
}
