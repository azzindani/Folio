// Folio editor — pure page operations on a DesignSpec.
//
// A design is either single-page (root `layers`) or multi-page (`pages[]`).
// ensurePages() lifts the former into the latter so add/duplicate/delete/move
// all work uniformly. Every helper returns a NEW design + the page index to
// land on; `seq` makes generated ids unique (the caller passes a monotonic
// counter) so this stays pure and deterministic — no Date/random in here.
import type { DesignSpec, Page, Layer } from '../schema/types';

/** Deep-clone a layer tree, assigning fresh ids so a duplicated page never
 *  shares ids with its source (recurses into group/auto_layout children). */
export function cloneLayersWithNewIds(layers: Layer[], prefix: string): Layer[] {
  let n = 0;
  const walk = (ls: Layer[]): Layer[] =>
    ls.map((l) => {
      const kids = (l as Layer & { layers?: Layer[] }).layers;
      const copy = { ...l, id: `${prefix}-${n++}` } as Layer & { layers?: Layer[] };
      if (Array.isArray(kids)) copy.layers = walk(kids);
      return copy as Layer;
    });
  return walk(layers);
}

/** Return a design guaranteed to use `pages[]`. A single-page design's root
 *  layers become page 1; root `layers` is dropped so there's one source. */
export function ensurePages(design: DesignSpec): DesignSpec {
  if (design.pages && design.pages.length > 0) return design;
  const page: Page = { id: 'page-1', label: 'Page 1', layers: design.layers ?? [] };
  const next = { ...design, pages: [page] } as DesignSpec & { layers?: Layer[] };
  delete next.layers;
  return next;
}

function clampIndex(i: number, len: number): number {
  return Math.max(0, Math.min(i, len - 1));
}

/** Insert a blank page right after `afterIndex`. Returns the new page's index. */
export function addBlankPage(design: DesignSpec, afterIndex: number, seq: number): { design: DesignSpec; index: number } {
  const d = ensurePages(design);
  const pages = [...(d.pages ?? [])];
  const at = clampIndex(afterIndex, pages.length) + 1;
  const page: Page = { id: `page-${seq}`, label: `Page ${pages.length + 1}`, layers: [] };
  pages.splice(at, 0, page);
  return { design: { ...d, pages }, index: at };
}

/** Duplicate the page at `index` (fresh layer ids); land on the copy. */
export function duplicatePage(design: DesignSpec, index: number, seq: number): { design: DesignSpec; index: number } {
  const d = ensurePages(design);
  const pages = [...(d.pages ?? [])];
  const src = pages[clampIndex(index, pages.length)];
  if (!src) return { design: d, index: clampIndex(index, pages.length) };
  const copy: Page = {
    ...src,
    id: `page-${seq}`,
    label: `${src.label ?? `Page ${index + 1}`} copy`,
    layers: cloneLayersWithNewIds(src.layers ?? [], `page-${seq}`),
  };
  const at = clampIndex(index, pages.length) + 1;
  pages.splice(at, 0, copy);
  return { design: { ...d, pages }, index: at };
}

/** Delete the page at `index`. Never removes the last page (returns unchanged). */
export function deletePage(design: DesignSpec, index: number): { design: DesignSpec; index: number } {
  const d = ensurePages(design);
  const pages = [...(d.pages ?? [])];
  if (pages.length <= 1) return { design: d, index: 0 };
  const at = clampIndex(index, pages.length);
  pages.splice(at, 1);
  return { design: { ...d, pages }, index: clampIndex(at, pages.length) };
}

/** Move the page from `from` to `to`. Returns the moved page's new index. */
export function movePage(design: DesignSpec, from: number, to: number): { design: DesignSpec; index: number } {
  const d = ensurePages(design);
  const pages = [...(d.pages ?? [])];
  const f = clampIndex(from, pages.length);
  const t = clampIndex(to, pages.length);
  if (f === t) return { design: d, index: f };
  const [moved] = pages.splice(f, 1);
  pages.splice(t, 0, moved);
  return { design: { ...d, pages }, index: t };
}
