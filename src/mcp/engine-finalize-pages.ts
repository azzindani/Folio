// Folio MCP engine — per-page finalize sweep. A design's geometry/legibility
// passes historically ran only on TOP-LEVEL poster layers; a multi-page design
// written in one shot (inline pages[]) had its page layers finalized nowhere, so
// a carousel kept positionless / overlapping / dark-on-dark page content
// (suite-009/074/079). This sweep runs the same rescue chain over every page +
// the root layers, so ANY build path (incremental, bulk, or a re-seal of an old
// file) converges on the same legible result. Every pass is idempotent — a clean
// design is a no-op.
import type { DesignSpec, Layer, Page, ThemeSpec } from '../schema/types';
import type { WorldBox } from '../animation/types';
import { ALL_THEMES } from '../themes/all-themes';
import { stripNullLayers, placePositionlessLayers, ensureBackgroundFill, recoverEmbeddedLayers, dropPlaceholderText } from './engine-finalize-autoplace';
import { decollideHandPlaced } from './engine-finalize-text';
import { snapOffCanvasContent, ensureLayerZ, coerceLayerScalars } from './engine-finalize-geom';
import { fixInvisibleText } from './engine-finalize-legibility';

export interface PageFinalizeTotals {
  nulls: number; recovered: number; placed: number; bgFilled: number; reflowed: number; relit: number; snapped: number;
  /** Placeholder text layers deleted, and which (`id "text"`) — replies name them. */
  placeholders: number; placeholderText: string[];
}

const zeroTotals = (): PageFinalizeTotals =>
  ({ nulls: 0, recovered: 0, placed: 0, bgFilled: 0, reflowed: 0, relit: 0, snapped: 0, placeholders: 0, placeholderText: [] });

/**
 * What a page carries besides its content: how it enters, its time on screen,
 * its notes and sound cues. append_page(replace:true) rebuilds the content and
 * must keep these — found live, a rebuilt scene of the promo lost its 3800ms
 * length and played at motion + hold instead.
 */
export function pageSceneFields(page: Page): Pick<Page, 'transition' | 'auto_advance' | 'notes' | 'audio_cues' | 'markers' | 'world'> {
  const { transition, auto_advance, notes, audio_cues, markers, world } = page;
  return {
    ...(transition ? { transition } : {}),
    ...(auto_advance !== undefined ? { auto_advance } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(audio_cues ? { audio_cues } : {}),
    // A continuous scene's time names and camera world belong to the page, not its layers.
    ...(markers ? { markers } : {}),
    ...(world ? { world } : {}),
  };
}

export function themeSpecOf(spec: DesignSpec): ThemeSpec | undefined {
  const th = spec.theme as { ref?: string; colors?: unknown } | undefined;
  if (th?.ref) return ALL_THEMES[th.ref];
  return th?.colors ? (spec.theme as unknown as ThemeSpec) : undefined;
}

/** The rescue chain over ONE layers array: strip nulls → flow positionless →
 *  de-collide → snap back anything pushed off → re-light. Idempotent. Mutates in
 *  place; returns the counts. */
export function finalizePageLayers(layers: Layer[], w: number, h: number, theme?: ThemeSpec, world?: WorldBox): PageFinalizeTotals {
  const t = zeroTotals();
  if (!Array.isArray(layers) || !layers.length) return t;
  t.nulls = stripNullLayers(layers);
  // A layer with no numeric z passes every other check and then fails
  // export_design's validator ("Layer z-index is required"). Repair here so a
  // re-seal fixes a file already on disk, not just newly added layers.
  ensureLayerZ(layers);
  coerceLayerScalars(layers);
  const rec = recoverEmbeddedLayers(layers);
  t.recovered = rec.recovered + rec.dropped;
  // Counted apart from the JSON recovery and named: it DELETES copy, and folded
  // into "JSON-in-text recovered" a lost row label read as a harmless repair.
  t.placeholders = dropPlaceholderText(layers, t.placeholderText);
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
  t.snapped = snapOffCanvasContent(layers, w, h, world);
  t.relit = fixInvisibleText(layers, w, h, theme);
  return t;
}

/** Run the rescue chain over root layers + every page. Mutates spec in place. */
export function finalizeSpecPages(spec: DesignSpec): PageFinalizeTotals {
  const totals = zeroTotals();
  const w = spec.document.width, h = spec.document.height, theme = themeSpecOf(spec);
  const arrays: Array<{ ls: Layer[]; world?: WorldBox }> = [];
  if (Array.isArray(spec.layers)) arrays.push({ ls: spec.layers, world: spec.world });
  for (const p of spec.pages ?? []) if (Array.isArray(p.layers)) arrays.push({ ls: p.layers, world: p.world });
  for (const { ls, world } of arrays) {
    const t = finalizePageLayers(ls, w, h, theme, world);
    totals.nulls += t.nulls; totals.recovered += t.recovered; totals.placed += t.placed;
    totals.bgFilled += t.bgFilled; totals.reflowed += t.reflowed; totals.relit += t.relit;
    totals.snapped += t.snapped; totals.placeholders += t.placeholders;
    totals.placeholderText.push(...t.placeholderText);
  }
  return totals;
}
