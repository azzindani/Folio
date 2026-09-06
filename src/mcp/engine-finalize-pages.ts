// Folio MCP engine — per-page finalize sweep. A design's geometry/legibility
// passes historically ran only on TOP-LEVEL poster layers; a multi-page design
// written in one shot (inline pages[]) had its page layers finalized nowhere, so
// a carousel kept positionless / overlapping / dark-on-dark page content
// (suite-009/074/079). This sweep runs the same rescue chain over every page +
// the root layers, so ANY build path (incremental, bulk, or a re-seal of an old
// file) converges on the same legible result. Every pass is idempotent — a clean
// design is a no-op.
import type { DesignSpec, Layer, ThemeSpec } from '../schema/types';
import { ALL_THEMES } from '../themes/all-themes';
import { stripNullLayers, placePositionlessLayers, ensureBackgroundFill, recoverEmbeddedLayers, dropPlaceholderText } from './engine-finalize-autoplace';
import { decollideHandPlaced } from './engine-finalize-text';
import { snapOffCanvasContent } from './engine-finalize-geom';
import { fixInvisibleText } from './engine-finalize-legibility';

export interface PageFinalizeTotals { nulls: number; recovered: number; placed: number; bgFilled: number; reflowed: number; relit: number; snapped: number; }

export function themeSpecOf(spec: DesignSpec): ThemeSpec | undefined {
  const th = spec.theme as { ref?: string; colors?: unknown } | undefined;
  if (th?.ref) return ALL_THEMES[th.ref];
  return th?.colors ? (spec.theme as unknown as ThemeSpec) : undefined;
}

/** The rescue chain over ONE layers array: strip nulls → flow positionless →
 *  de-collide → snap back anything pushed off → re-light. Idempotent. Mutates in
 *  place; returns the counts. */
export function finalizePageLayers(layers: Layer[], w: number, h: number, theme?: ThemeSpec): PageFinalizeTotals {
  const t: PageFinalizeTotals = { nulls: 0, recovered: 0, placed: 0, bgFilled: 0, reflowed: 0, relit: 0, snapped: 0 };
  if (!Array.isArray(layers) || !layers.length) return t;
  t.nulls = stripNullLayers(layers);
  const rec = recoverEmbeddedLayers(layers);
  t.recovered = rec.recovered + rec.dropped + dropPlaceholderText(layers);
  t.placed = placePositionlessLayers(layers, w, h);
  const themeBg = (theme?.colors as Record<string, unknown> | undefined)?.['background'];
  t.bgFilled = ensureBackgroundFill(layers, w, h, typeof themeBg === 'string' ? themeBg : undefined) ? 1 : 0;   // before the re-light, so it judges the real bg
  t.reflowed = decollideHandPlaced(layers, w, h);
  // De-collide pushes overlapping layers DOWN, and on a full page it can push
  // one clean off the bottom — at which point the rescue has deleted the content
  // it was rescuing. add_layers has always snapped such a layer back; this chain,
  // which seal_design runs, never did, so seal could move a layer off the canvas
  // and report a clean seal. (Live: an icon the model placed at y=180 sat at
  // y=898 after add_layers and at y=1095 — wholly outside a 1080px canvas —
  // after seal.) Only fires on a layer with NO overlap at all, so a deliberate
  // bleed is untouched.
  t.snapped = snapOffCanvasContent(layers, w, h);
  t.relit = fixInvisibleText(layers, w, h, theme);
  return t;
}

/** Run the rescue chain over root layers + every page. Mutates spec in place. */
export function finalizeSpecPages(spec: DesignSpec): PageFinalizeTotals {
  const totals: PageFinalizeTotals = { nulls: 0, recovered: 0, placed: 0, bgFilled: 0, reflowed: 0, relit: 0, snapped: 0 };
  const w = spec.document.width, h = spec.document.height, theme = themeSpecOf(spec);
  const arrays: Layer[][] = [];
  if (Array.isArray(spec.layers)) arrays.push(spec.layers);
  for (const p of spec.pages ?? []) if (Array.isArray(p.layers)) arrays.push(p.layers);
  for (const ls of arrays) {
    const t = finalizePageLayers(ls, w, h, theme);
    totals.nulls += t.nulls; totals.recovered += t.recovered; totals.placed += t.placed;
    totals.bgFilled += t.bgFilled; totals.reflowed += t.reflowed; totals.relit += t.relit;
    totals.snapped += t.snapped;
  }
  return totals;
}
