/**
 * `repeat` kept as a rule (phase 3 close-out, C2). A plain repeat writes N
 * copies (<id>_1..N) and the rule is gone — changing one card means editing
 * every copy. keep:"rule" writes ONE group with a gallery instead
 * (renderer/resolve-gallery.ts): the layer is stored once as the template, its
 * rows (or count) as the items, and every consumer still sees the cells.
 *
 * The cell is the layer's own box; `repeat_columns` (default: all on one row)
 * and `repeat_gap` lay the cells out. The layer's own `gap` stays its own —
 * a repeated column keeps the gap between its children.
 */

import type { ShorthandLayer } from './shorthand-helpers';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Every string with {{n}} written as the gallery's {{i}} (both count from 1). */
function renumber(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(/\{\{\s*n\s*\}\}/g, '{{i}}');
  if (Array.isArray(v)) return v.map(renumber);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, renumber(x)]));
  return v;
}

/** Whether a shorthand layer asks for its repeat to be kept as a rule. */
export const keepsRule = (sh: ShorthandLayer): boolean => sh.keep === 'rule' && sh.repeat !== undefined;

/** A repeated shorthand layer as one gallery group (still shorthand — the group expands its template). */
export function repeatAsGallery(sh: ShorthandLayer, cap: number): ShorthandLayer {
  const { repeat, keep: _keep, repeat_columns: cols0, repeat_gap: gap0, pos, x, y, id, z, ...rest } = sh;
  void _keep;
  const items = Array.isArray(repeat) ? repeat.slice(0, cap) : Math.max(0, Math.min(cap, Math.floor(Number(repeat) || 0)));
  const n = Array.isArray(items) ? items.length : items;
  const box = Array.isArray(pos) ? pos : [x, y, sh.width, sh.height];
  const w = num(box[2]), h = num(box[3]), gap = Math.max(0, num(gap0));
  const columns = Math.max(1, Math.min(Math.max(1, n), Math.floor(num(cols0)) || n));
  const rows = Math.max(1, Math.ceil(n / columns));
  const template = renumber({ ...rest, id: 'item', x: 0, y: 0, width: w, height: h }) as ShorthandLayer;
  return {
    id, z, type: 'group',
    // No x/y (a child a flow container places) stays without them.
    ...(typeof box[0] === 'number' ? { x: box[0] } : {}), ...(typeof box[1] === 'number' ? { y: box[1] } : {}),
    width: columns * w + (columns - 1) * gap, height: rows * h + (rows - 1) * gap,
    gallery: { items, template: [template], columns, gap, cell: { width: w, height: h } },
  };
}

/** A shorthand group's gallery with its template expanded by `expand` — `{}` when it has none. */
export function galleryOf(sh: ShorthandLayer, expand: (template: unknown) => unknown[]): { gallery?: Record<string, unknown> } {
  const g = sh.gallery;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return {};
  const spec = g as Record<string, unknown>;
  return Array.isArray(spec['template']) ? { gallery: { ...spec, template: expand(spec['template']) } } : {};
}
