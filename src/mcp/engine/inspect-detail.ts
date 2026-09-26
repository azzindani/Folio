/**
 * manage_design {op:"inspect"} — reading back what was written, through the tool.
 *
 * Found live (Opus 5.5 promo): inspect listed ids, types and boxes, so a model
 * could not read a script component's code, a rule's start, a gallery's items,
 * the design's names or its markers without opening the file outside Folio.
 * `layer_id` returns one layer as written, with the patch_design path that
 * reaches it; the design's facts (names, markers, world, length) come with every
 * inspect.
 */

import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { ToolResult } from '../types';
import { errResult, okResult, pOk } from './utils';

type Node = Layer & { layers?: Layer[] };

/** A name's value past this size is summarised: the list is the model's own data, but not every byte of it every call. */
const NAME_CAP = 6000;

export interface LayerHit { layer: Node; path: string; parent?: string; page_id?: string }

/** The layer `id` at any depth — root layers, then each page's — with its patch_design path. */
export function findLayerPath(spec: DesignSpec, id: string): LayerHit | null {
  const walk = (ls: Layer[] | undefined, prefix: string, parent?: string, page?: string): LayerHit | null => {
    for (const l of (ls ?? []) as Node[]) {
      const path = `${prefix}layers[id=${l.id}]`;
      if (l.id === id) return { layer: l, path, ...(parent ? { parent } : {}), ...(page ? { page_id: page } : {}) };
      const hit = Array.isArray(l.layers) ? walk(l.layers, `${path}.`, l.id, page) : null;
      if (hit) return hit;
    }
    return null;
  };
  const root = walk(spec.layers, '');
  if (root) return root;
  for (const p of spec.pages ?? []) {
    const hit = walk(p.layers, `pages[id=${p.id}].`, undefined, p.id);
    if (hit) return hit;
  }
  return null;
}

/** The layer as written; a group's children as id/type rows (inspect each by its id). */
export function layerAsWritten(layer: Node): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(layer as unknown as Record<string, unknown>) };
  if (Array.isArray(layer.layers)) out['layers'] = layer.layers.map(k => ({ id: k.id, type: k.type }));
  return out;
}

const capped = (v: unknown): unknown => {
  const text = JSON.stringify(v) ?? '';
  if (text.length <= NAME_CAP) return v;
  return Array.isArray(v) ? { items: v.length, first: v.slice(0, 3), note: `${text.length} chars — the first 3 of ${v.length} shown` } : { note: `${text.length} chars — too long to repeat here` };
};

/** What the surface holds besides its layers: names, markers, the camera world and how long it lasts. */
export function surfaceFacts(spec: DesignSpec, page?: Page): Record<string, unknown> {
  const names = page ? page.names : spec.names;
  const markers = page ? page.markers : spec.markers;
  const world = page ? page.world : spec.world;
  const length = page ? page.auto_advance : spec.length_ms;
  return {
    ...(names && Object.keys(names).length ? { names: Object.fromEntries(Object.entries(names).map(([k, v]) => [k, capped(v)])) } : {}),
    ...(markers && Object.keys(markers).length ? { markers } : {}),
    ...(world ? { world } : {}),
    ...(typeof length === 'number' && length > 0 ? { [page ? 'auto_advance' : 'length_ms']: length } : {}),
  };
}

/** inspect {layer_id}: the layer as written, where it sits, and the path patch_design reaches it by. */
export function inspectLayer(spec: DesignSpec, designPath: string, layerId: string): ToolResult {
  const op = 'inspect_design';
  const hit = findLayerPath(spec, layerId);
  if (!hit) {
    return errResult(op, `No layer "${layerId}" in this design.`,
      'manage_design {op:"inspect"} lists the ids. A gallery\'s cells (<gallery>_<n>_<layer>) are made from its template: inspect the gallery itself.');
  }
  const kids = Array.isArray(hit.layer.layers) ? hit.layer.layers.length : 0;
  return okResult(op, {
    layer_id: layerId, type: hit.layer.type, ...(hit.parent ? { parent: hit.parent } : {}), ...(hit.page_id ? { page_id: hit.page_id } : {}),
    patch_path: hit.path, layer: layerAsWritten(hit.layer),
    progress: [pOk(`Read "${layerId}" as written`, `${hit.layer.type}${kids ? ` · ${kids} child layer(s) listed by id` : ''}`)],
    next_action: { tool: 'patch_design', params: { design_path: designPath, selectors: [{ path: `${hit.path}.<field>`, value: '<new value>' }] }, remaining: -1,
      hint: 'Change one field with patch_design at this path (layers[id=…].<field> reaches it too), or edit_layer {op:"update"} to merge several.' },
  });
}
