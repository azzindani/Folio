/**
 * Editing one generated item of a gallery (phase 3, S6) — shared by the MCP
 * doors (mcp/engine/override-op.ts) and the editor's state, which both name a
 * cell by the id every consumer sees (people_4_role). Finds the gallery that
 * makes it and writes the edit as that item's override, in the template's
 * frame (renderer/gallery-overrides.ts replays it).
 */

import type { DesignSpec, GallerySpec, Layer, Page } from '../schema/types';
import { galleryCells, rowsOf, type Cell } from './resolve-gallery';
import { locateItem, deepMerge } from './gallery-overrides';
import { sourceOptions, scopeOf } from './resolve-source';
import { resolveSourceFormulas } from '../scripting/formula-source';

type Gallery = Layer & { gallery: GallerySpec; layers?: Layer[] };
export interface GeneratedHit { gallery: Gallery; key: string; cell: Cell; template?: Layer }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The object without empty objects left behind by cleared keys. */
const prune = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => {
    if (!isObj(v)) return [[k, v]];
    const inner = prune(v);
    return Object.keys(inner).length ? [[k, inner]] : [];
  }));

export const findIn = (ls: Layer[], id: string): Layer | undefined => {
  for (const l of ls) {
    if (l.id === id) return l;
    const hit = findIn((l as Layer & { layers?: Layer[] }).layers ?? [], id);
    if (hit) return hit;
  }
  return undefined;
};

/** The gallery that generates `id`, with the item's cell and template layer — null when `id` is no generated item. */
export function findGenerated(spec: DesignSpec, id: string, pageId?: string): GeneratedHit | null {
  const surfaces: { page?: Page; layers: Layer[] }[] = pageId
    ? (spec.pages ?? []).filter(p => p.id === pageId).map(p => ({ page: p, layers: p.layers ?? [] }))
    : [{ layers: spec.layers ?? [] }, ...(spec.pages ?? []).map(p => ({ page: p, layers: p.layers ?? [] }))];
  for (const s of surfaces) {
    const o = sourceOptions(spec, s.page);
    const scope = scopeOf(o);
    const walk = (ls: Layer[]): GeneratedHit | null => {
      for (const l of ls) {
        const g = (l as Gallery).gallery;
        if (l.type === 'group' && g && Array.isArray(g.template)) {
          const n = rowsOf(g, scope, l.id).length;
          const at = locateItem(l.id, g.template, n, id);
          if (at) {
            // The box as drawn: the gallery's own formulas (x, width…) applied first.
            const box = resolveSourceFormulas([l], scope)[0] ?? l;
            const cell = galleryCells(g, box, n)[at.index];
            if (cell) return { gallery: l as Gallery, key: at.templateId ? `${at.cellId}_${at.templateId}` : at.cellId, cell, ...(at.templateId ? { template: findIn(g.template, at.templateId) } : {}) };
          }
        }
        const hit = walk((l as Layer & { layers?: Layer[] }).layers ?? []);
        if (hit) return hit;
      }
      return null;
    };
    const hit = walk(s.layers);
    if (hit) return hit;
  }
  return null;
}

/** The gallery's spec with `props` (null: take the item out) as the item's override, x/y in the template's frame — or why not. */
export function withItemOverride(hit: GeneratedHit, props: Record<string, unknown> | null): GallerySpec | string {
  const g = hit.gallery.gallery;
  const overrides = { ...(g.overrides ?? {}) };
  if (props === null) overrides[hit.key] = null;
  else {
    const p = { ...props };
    if (!hit.template && ['x', 'y', 'width', 'height'].some(k => k in p)) {
      return `"${hit.key}" is a cell of "${hit.gallery.id}" — its box is the gallery's layout. Move its layers (${hit.key}_…), or change the gallery's columns, gap or cell`;
    }
    // Only what differs from the template: a style merged whole would pin every other key of it.
    const tpl = (hit.template ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(p)) {
      const t = tpl[k];
      if (!isObj(v) || !isObj(t)) continue;
      // A key set back to the template's value clears the item's own (null, in deepMerge).
      p[k] = Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, JSON.stringify(vv) === JSON.stringify(t[kk]) ? null : vv]));
    }
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    if (typeof p['x'] === 'number') p['x'] = r2((p['x'] as number) - hit.cell.x);
    if (typeof p['y'] === 'number') p['y'] = r2((p['y'] as number) - hit.cell.y);
    // A plain value equal to the template's is the template's: it clears the item's own.
    for (const [k, v] of Object.entries(p)) if (!isObj(v) && JSON.stringify(v) === JSON.stringify(tpl[k])) p[k] = null;
    const was = overrides[hit.key];
    const next = prune(deepMerge(was && typeof was === 'object' ? was : {}, p));
    if (Object.keys(next).length) overrides[hit.key] = next; else delete overrides[hit.key];
  }
  return { ...g, overrides };
}
