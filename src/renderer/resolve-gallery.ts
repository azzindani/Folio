/**
 * Galleries (phase 3, S3) — a group that stores ONE template cell and the rows
 * it repeats over, instead of N copied cards. The shorthand `repeat` wrote the
 * copies out and the rule was gone: changing one card meant editing twelve.
 *
 * The cells are laid out on the group's box (columns, gap, cell size) and each
 * becomes an ordinary group `<id>_<n>` whose layers are `<id>_<n>_<layer id>`,
 * so every consumer after this step sees plain layers. A template layer sits
 * relative to its cell. Its strings take `{{key}}` from the row ({{i}} counts
 * from 1 unless the row has an `i` of its own), and its formulas read the design's names plus Item (the row), Index
 * (from 0), Row, Col, N, CellW and CellH.
 */

import type { Layer, GallerySpec } from '../schema/types';
import { isFormula } from '../scripting/formula';
import { evalSource, resolveSourceFormulas, type SourceScope, type SourceProblem } from '../scripting/formula-source';
import { resolveMotionRules } from './resolve-motion';
import { withOverrides, applyOverride, type Overrides } from './gallery-overrides';

export const GALLERY_CAP = 200;

export type Row = Record<string, unknown>;
type Node = Layer & { layers?: Layer[]; gallery?: GallerySpec };
export interface Cell { x: number; y: number; width: number; height: number; row: number; col: number }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The rows a gallery repeats over: its own list, a count, or a list its formula reads from names. */
export function rowsOf(g: GallerySpec, scope: SourceScope, id: string, problems?: SourceProblem[]): Row[] {
  let items: unknown = g.items;
  if (isFormula(items)) {
    const r = evalSource(items, scope);
    if (!r.ok) { problems?.push({ layer_id: id, prop: 'gallery.items', formula: items, error: r.error }); return []; }
    items = r.value;
  }
  if (typeof items === 'number') return Array.from({ length: Math.max(0, Math.min(GALLERY_CAP, Math.floor(items))) }, () => ({}));
  if (!Array.isArray(items)) {
    problems?.push({ layer_id: id, prop: 'gallery.items', formula: String(g.items), error: 'it is not a list or a count' });
    return [];
  }
  return items.slice(0, GALLERY_CAP).map(r => (r && typeof r === 'object' && !Array.isArray(r) ? r as Row : { value: r }));
}

/** Where each of `n` cells sits on the box. */
export function galleryCells(g: GallerySpec, box: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }, n: number): Cell[] {
  const [gx, gy] = Array.isArray(g.gap) ? [num(g.gap[0]), num(g.gap[1])] : [num(g.gap), num(g.gap)];
  const bw = num(box.width), bh = num(box.height);
  const cols = Math.max(1, Math.floor(g.columns ?? (bw >= bh ? n : 1)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cw = g.cell?.width ?? Math.max(0, (bw - gx * (cols - 1)) / cols);
  const ch = g.cell?.height ?? Math.max(0, (bh - gy * (rows - 1)) / rows);
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    return { x: num(box.x) + col * (cw + gx), y: num(box.y) + row * (ch + gy), width: cw, height: ch, row, col };
  });
}

/**
 * Every string in `v` with {{key}} filled from the row — except a nested
 * gallery's template, which its own rows fill: filled here, its {{i}} read the
 * outer cell's number and its row keys came out blank (close-out C3, live).
 */
function fill(v: unknown, row: Row): unknown {
  if (typeof v === 'string') return v.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => (row[k] === undefined || row[k] === null ? '' : String(row[k])));
  if (Array.isArray(v)) return v.map(x => fill(x, row));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Row).map(([k, x]) => [k, k === 'gallery' && x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Row).map(([gk, gx]) => [gk, gk === 'template' ? gx : fill(gx, row)]))
      : fill(x, row)]));
  }
  return v;
}

/** A template layer's id, and every descendant's, under the cell's. */
function rename(l: Layer, cellId: string): Layer {
  const o: Row = { ...(l as unknown as Row), id: `${cellId}_${l.id}` };
  const kids = o['layers'];
  if (Array.isArray(kids)) o['layers'] = (kids as Layer[]).map(k => rename(k, cellId));
  return o as unknown as Layer;
}

/** A template layer (in the cell's frame) moved onto its cell. */
function place(l: Layer, cell: Cell, placedByParent: boolean): Layer {
  const o = { ...(l as unknown as Row) };
  if (!placedByParent) {
    o['x'] = num(o['x']) + cell.x;
    o['y'] = num(o['y']) + cell.y;
    for (const k of ['from', 'to']) {
      const p = o[k];
      if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number') o[k] = [p[0] + cell.x, p[1] + cell.y];
    }
  }
  const kids = o['layers'];
  // An auto-layout places its own children; a group's children are absolute like any layer.
  if (Array.isArray(kids)) o['layers'] = (kids as Layer[]).map(k => place(k, cell, l.type === 'auto_layout'));
  return o as unknown as Layer;
}

/** What a cell's formulas read: the design's names plus Item (its row), Index, Row, Col, N, CellW and CellH. */
export function cellScope(scope: SourceScope, row: Row, i: number, cell: Cell, n: number): SourceScope {
  return { ...scope, names: { ...scope.names, Item: row, Index: i, Row: cell.row, Col: cell.col, N: n, CellW: cell.width, CellH: cell.height } };
}

/** One cell's template layers as they are drawn: overrides, {{key}}, ids and formulas in the template's frame, then onto the cell. */
export function frameCell(template: Layer[], cellId: string, row: Row, i: number, cell: Cell, scope: SourceScope, overrides: Overrides | undefined, problems?: SourceProblem[]): Layer[] {
  // Formulas work in the template's frame, like the template itself ("=Item.col * 444" is inside the
  // gallery): evaluated before the cell's offset, never after it (b31 rebuild, S8 live).
  // A row's own key wins over the count: Places {p, i:"cloud"} drew "1", "2"… as its icons (Opus 5.5 promo).
  const framed = resolveSourceFormulas(withOverrides(template, cellId, overrides).map(t => rename(fill(t, { i: i + 1, ...row }) as Layer, cellId)), scope, problems);
  return framed.map(t => place(t, cell, false));
}

/**
 * The overrides a gallery replays: its own, and those of the galleries around
 * it (close-out C3). Keys are generated ids, unique at every depth, so an edit
 * to an item of a nested gallery is stored on the outermost one — the gallery
 * in the file — and wins over the template's own.
 */
export const mergeOverrides = (own: Overrides | undefined, outer: Overrides | undefined): Overrides | undefined =>
  own || outer ? { ...own, ...outer } : undefined;

/** The tree with every gallery laid out as ordinary groups; the same array when there is none. */
export function resolveGalleries(layers: Layer[], scope: SourceScope, problems?: SourceProblem[], outer?: Overrides): Layer[] {
  const out = layers.map((l): Layer => {
    const node = l as Node;
    const kids = Array.isArray(node.layers) ? resolveGalleries(node.layers, scope, problems, outer) : undefined;
    const g = l.type === 'group' ? node.gallery : undefined;
    if (!g || !Array.isArray(g.template)) return kids && kids !== node.layers ? ({ ...node, layers: kids } as Layer) : l;
    const rows = rowsOf(g, scope, l.id, problems);
    const cells = galleryCells(g, node, rows.length);
    const overrides = mergeOverrides(g.overrides, outer);
    const items = rows.flatMap((row, i): Layer[] => {
      const cell = cells[i] ?? { x: 0, y: 0, width: 0, height: 0, row: 0, col: 0 };
      const cellId = `${l.id}_${i + 1}`;
      // One item's own edits (gallery-overrides.ts); null takes the item out.
      const own = overrides?.[cellId];
      if (own === null) return [];
      const cs = cellScope(scope, row, i, cell, rows.length);
      // A cell's rules read its row: "=Index * 120" staggers the cells.
      const inner = resolveGalleries(resolveMotionRules(frameCell(g.template, cellId, row, i, cell, cs, overrides, problems), cs, problems), cs, problems, overrides);
      const group = { id: cellId, type: 'group', z: i, x: cell.x, y: cell.y, width: cell.width, height: cell.height, layers: inner } as unknown as Layer;
      // The cell's box is the layout's: an item moves by its layers' overrides.
      const { x: _x, y: _y, width: _w, height: _h, layers: _l, ...props } = own ?? {};
      void _x; void _y; void _w; void _h; void _l;
      return [Object.keys(props).length ? applyOverride(group, props) : group];
    });
    const rest = { ...(node as unknown as Row) };
    delete rest['gallery'];
    return { ...rest, layers: [...(kids ?? []), ...items] } as unknown as Layer;
  });
  return out.every((l, i) => l === layers[i]) ? layers : out;
}
