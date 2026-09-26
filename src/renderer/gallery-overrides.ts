/**
 * Gallery overrides (phase 3, S6) — an edit to ONE generated item, stored
 * beside the rule that makes it and replayed on every resolve.
 *
 * A gallery's cells are not in the file, so an edit to "the fourth card's
 * label" had nowhere to go: patch_design could not find people_4_role, and a
 * diagnose call naming it failed at the door. The edit now lands in
 * `gallery.overrides`, keyed by the generated id, in the TEMPLATE's frame
 * (x/y relative to the item's cell) — so it is a one-item template edit and
 * moves with the gallery. A prop set here replaces the template's formula for
 * it; `null` removes the item. Never written into an expansion: detach bakes
 * the overrides along with the rest.
 */

import type { Layer, GallerySpec } from '../schema/types';

export type Overrides = NonNullable<GallerySpec['overrides']>;
type Rec = Record<string, unknown>;

const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** `base` with `patch` merged in: objects key by key, anything else replaced, null removes the key. */
export function deepMerge(base: Rec, patch: Rec): Rec {
  const out: Rec = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (isObj(v)) out[k] = deepMerge(isObj(out[k]) ? out[k] as Rec : {}, v);
    else out[k] = v;
  }
  return out;
}

/** Every dot path an override sets ("style.color", "x"). */
function pathsOf(o: Rec, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k;
    return isObj(v) ? [p, ...pathsOf(v, p)] : [p];
  });
}

/** A layer with one override applied: its props win, and the template's formulas for them give way. */
export function applyOverride(l: Layer, o: Rec): Layer {
  const merged = deepMerge(l as unknown as Rec, o);
  const formulas = (l as { formulas?: Record<string, string> }).formulas;
  if (formulas) {
    const set = pathsOf(o);
    const left = Object.fromEntries(Object.entries(formulas).filter(([k]) => !set.some(p => k === p || k.startsWith(`${p}.`) || p.startsWith(`${k}.`))));
    if (Object.keys(left).length) merged['formulas'] = left; else delete merged['formulas'];
  }
  return merged as unknown as Layer;
}

/** One cell's template with its items' overrides applied (ids are `<cellId>_<template id>`); removed ones left out. */
export function withOverrides(template: Layer[], cellId: string, overrides: Overrides | undefined): Layer[] {
  if (!overrides) return template;
  const walk = (ls: Layer[]): Layer[] => ls.flatMap(t => {
    const o = overrides[`${cellId}_${t.id}`];
    if (o === null) return [];
    const next = isObj(o) ? applyOverride(t, o) : t;
    const kids = (next as Layer & { layers?: Layer[] }).layers;
    return [Array.isArray(kids) ? ({ ...next, layers: walk(kids) } as Layer) : next];
  });
  return walk(template);
}

/** Where a generated id sits in a gallery: its item index and the template layer it came from (none for the cell itself). */
export function locateItem(galleryId: string, template: Layer[], count: number, id: string): { index: number; cellId: string; templateId?: string } | null {
  const m = new RegExp(`^${galleryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)(?:_(.+))?$`).exec(id);
  if (!m) return null;
  const index = Number(m[1]) - 1;
  if (index < 0 || index >= count) return null;
  const cellId = `${galleryId}_${index + 1}`;
  if (m[2] === undefined) return { index, cellId };
  const has = (ls: Layer[]): boolean => ls.some(l => l.id === m[2] || has((l as Layer & { layers?: Layer[] }).layers ?? []));
  return has(template) ? { index, cellId, templateId: m[2] } : null;
}
