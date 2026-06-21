// Folio MCP engine — finalization passes — content-preset stacking + duplicate collapse.
// Split from engine-finalize-geom.ts to keep both modules under the 700-line budget; verbatim bodies.
import type { Layer } from '../schema/types';

import { estTextHeight } from './shorthand-parser';
import { fontCharFactor } from './engine-finalize-text';
import { layerBBox, layerText, isMotifLayer } from './engine-finalize-geom';

// A full-canvas OPAQUE content preset group (sections/feature_grid/editorial/…) —
// it paints its own background, so two of them at the origin fully cover each
// other. (decor/marble/backdrop presets and motifs are excluded — those are meant
// to show through.)

export const CONTENT_PRESET_RE = /^(feature_grid|sections|infographic|document|report_poster|editorial|stat|list|steps|event|flyer|hero|split|poster)([_-]|$)/;

export function isFullBleedContentPreset(l: Layer, docW: number, docH: number): boolean {
  const o = l as unknown as Record<string, unknown>;
  if (o['type'] !== 'group') return false;
  if (!CONTENT_PRESET_RE.test(String(o['id'] ?? ''))) return false;
  const x = Number(o['x']) || 0, y = Number(o['y']) || 0, w = Number(o['width']) || 0;
  return x <= docW * 0.02 && y <= docH * 0.04 && w >= docW * 0.9;
}

// All text tokens inside a preset group — used to tell a THRASH rebuild (the same
// poster re-stacked, ~identical content) from N DISTINCT sections a model stacked
// (a 3-section menu: Breakfast / Lunch / Drinks — different items each).

export function presetTokens(g: Layer): Set<string> {
  const out = new Set<string>();
  const walk = (ls: Layer[]): void => { for (const k of ls) { if (k.type === 'text') for (const t of layerText(k).toLowerCase().split(/[^a-z0-9$%]+/)) if (t.length >= 3) out.add(t); const kids = (k as unknown as Record<string, unknown>)['layers']; if (Array.isArray(kids)) walk(kids as Layer[]); } };
  const kids = (g as unknown as Record<string, unknown>)['layers'];
  if (Array.isArray(kids)) walk(kids as Layer[]);
  return out;
}

export function presetsSimilar(a: Layer, b: Layer): boolean {
  const ta = presetTokens(a), tb = presetTokens(b);
  if (ta.size < 2 || tb.size < 2) return true; // no real content to tell apart → treat as dup (old behavior)
  let shared = 0; for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

// A thrashing model rebuilds a poster several times → many full-canvas content
// presets STACKED at the origin (e.g. 8 feature_grids, de-duped to unique ids by
// the page-id/layer-id pass but still overlapping into an illegible mess). They're
// opaque and fully cover one another, so keep the LAST and drop the earlier ones —
// BUT only the ones whose content DUPLICATES a later preset (a true rebuild). A
// model that stacked N DISTINCT full-canvas sections (a 3-section menu) must NOT
// have 2 silently deleted as "dupes" — that loses whole sections of content.

export function dropStackedPresets(layers: Layer[], docW: number, docH: number): number {
  const idxs: number[] = [];
  layers.forEach((l, i) => { if (isFullBleedContentPreset(l, docW, docH)) idxs.push(i); });
  if (idxs.length < 2) return 0;
  const drop = new Set<number>();
  // Drop a preset only when a LATER stacked preset repeats its content (keep the
  // last of each duplicate group); distinct sections are all preserved.
  for (let a = 0; a < idxs.length; a++) {
    for (let b = a + 1; b < idxs.length; b++) {
      if (presetsSimilar(layers[idxs[a]], layers[idxs[b]])) { drop.add(idxs[a]); break; }
    }
  }
  let removed = 0;
  for (let i = layers.length - 1; i >= 0; i--) { if (drop.has(i)) { layers.splice(i, 1); removed++; } }
  return removed;
}

// A blind model handed a multi-section brief (intro + schedule + pricing) often
// emits 2+ DISTINCT full-bleed content presets — one per section — all pinned to
// the SAME full-canvas box, so they z-STACK and only the topmost renders: every
// earlier section (and any title beneath them) is silently invisible. By this
// point dropStackedPresets has removed true rebuild DUPLICATES, so the presets
// left here are distinct sections that must all be SEEN — re-seat each into its
// own vertical BAND down the page. A group applies NO render transform (renderGroup
// emits a bare <g>; its children carry ABSOLUTE doc coords), so banding means
// TRANSLATING the whole subtree, not just moving the group box — moving the box
// alone leaves every child where it was. Single posters only (carousels page these).

export function stackDistinctFullBleedPresets(layers: Layer[], doc: { width: number; height: number }, docW: number, docH: number): number {
  // Detect by full WIDTH only (NOT y): once a section has been re-seated into a
  // lower band, a y-gated check would stop seeing it, so a later add_layers call
  // would re-band fresh sections ON TOP of the stuck ones. Width-only detection
  // makes every pass re-derive the whole band layout from scratch — idempotent.
  const isSection = (l: Layer): boolean => {
    const o = l as unknown as Record<string, unknown>;
    if (o['type'] !== 'group' || !CONTENT_PRESET_RE.test(String(o['id'] ?? ''))) return false;
    const x = Number(o['x']) || 0, w = Number(o['width']) || 0;
    return x <= docW * 0.02 && w >= docW * 0.9;
  };
  const presets = layers.filter(isSection);
  if (presets.length < 2) return 0;
  const zOf = (l: Layer): number => { const z = (l as unknown as Record<string, unknown>)['z']; return typeof z === 'number' ? z : 0; };
  // Reading order = render order: stack the earliest-drawn (lowest z) section on top.
  presets.sort((a, b) => zOf(a) - zOf(b));
  const yOf = (l: Layer): number => { const o = l as unknown as Record<string, unknown>; const p = o['pos']; return (Array.isArray(p) && p.length >= 2) ? (Number(p[1]) || 0) : (Number(o['y']) || 0); };
  const setY = (l: Layer, y: number): void => { const o = l as unknown as Record<string, unknown>; const p = o['pos']; if (Array.isArray(p) && p.length >= 2) p[1] = y; else o['y'] = y; };
  // The preset's full-bleed background rect anchors the band top — decorations and
  // cards keep their offset relative to it, and reading it (not the unreliable group
  // box) keeps the pass idempotent across incremental re-bands.
  const bgTop = (g: Layer): number => {
    const kids = (g as unknown as Record<string, unknown>)['layers'];
    if (!Array.isArray(kids)) return yOf(g);
    const gw = Number((g as unknown as Record<string, unknown>)['width']) || docW, gh = Number((g as unknown as Record<string, unknown>)['height']) || docH;
    for (const k of kids as Layer[]) {
      if (k.type !== 'rect') continue;
      const b = layerBBox(k);
      if ((b.r - b.x) >= gw * 0.9 && (b.b - b.y) >= gh * 0.9) return b.y; // the full-canvas wash
    }
    return yOf(g);
  };
  // Translate a subtree's absolute y by delta. An auto_layout lays its children out
  // from its OWN y (their coords are recomputed at render), so shift the container
  // and STOP; every other node carries an absolute y to shift, recursing into groups.
  const shiftY = (l: Layer, d: number): void => {
    setY(l, yOf(l) + d);
    if ((l as unknown as Record<string, unknown>)['type'] === 'auto_layout') return;
    const kids = (l as unknown as Record<string, unknown>)['layers'];
    if (Array.isArray(kids)) for (const k of kids as Layer[]) shiftY(k, d);
  };
  // A full-canvas grid is built to fill a 1080 SQUARE, but a section often holds
  // only a heading + one short row of cards, so ~two thirds of each band is dead
  // space (the menu: Starters/Mains/Desserts each ~60% empty). Trim every band to
  // its real CONTENT extent — the heading text + the card auto_layout, NOT the
  // full-bleed wash/grain or the oversized corner motif — so the stacked brochure
  // reads tight instead of airy. Content-type children measure their own absolute
  // box; decorations are excluded from the extent and dropped if the trim leaves
  // them overflowing the smaller band.
  const CONTENT_TYPES = new Set(['text', 'rich_text', 'auto_layout', 'chart', 'kpi_card', 'mermaid', 'group', 'icon']);
  const contentExtent = (g: Layer): { top: number; bot: number } | null => {
    const kids = (g as unknown as Record<string, unknown>)['layers'];
    if (!Array.isArray(kids)) return null;
    let top = Infinity, bot = -Infinity;
    for (const k of kids as Layer[]) {
      if (!CONTENT_TYPES.has(k.type)) continue;
      const b = layerBBox(k);
      if (b.b <= b.y) continue;
      top = Math.min(top, b.y); bot = Math.max(bot, b.b);
    }
    return Number.isFinite(top) && bot > top ? { top, bot } : null;
  };
  const pad = Math.round(docW * 0.055);
  const gap = Math.round(docW * 0.018);
  const fontOf = (l: Layer): number => { const st = (l as unknown as Record<string, unknown>)['style'] as Record<string, unknown> | undefined; return st && typeof st['font_size'] === 'number' ? st['font_size'] as number : 16; };
  const textH = (l: Layer): number => {
    const o = l as unknown as Record<string, unknown>; const st = (o['style'] as Record<string, unknown>) ?? {};
    const fs = Number(st['font_size']) || Math.round(docW * 0.04), lh = Number(st['line_height']) || 1.3;
    const p = o['pos']; const w = Number(o['width']) || (Array.isArray(p) && p.length >= 3 ? Number(p[2]) : 0) || Math.round(docW * 0.84);
    const font = typeof st['font_family'] === 'string' ? st['font_family'] as string : '';
    return estTextHeight(layerText(l), fs, w, lh, fontCharFactor(font));
  };
  // Place a loose text centered at y; return its measured height.
  const seatCentered = (t: Layer, ty: number): number => {
    const o = t as unknown as Record<string, unknown>; const h = textH(t);
    const w = Number(o['width']) || Math.round(docW * 0.84);
    const nx = Math.max(0, Math.round((docW - w) / 2));
    const p = o['pos'];
    if (Array.isArray(p) && p.length >= 2) { p[0] = nx; p[1] = ty; if (p.length >= 4) p[3] = h; } else { o['x'] = nx; o['y'] = ty; o['height'] = h; }
    const st = (o['style'] && typeof o['style'] === 'object') ? o['style'] as Record<string, unknown> : (o['style'] = {} as Record<string, unknown>);
    if (st['align'] == null) st['align'] = 'center';
    return h;
  };
  const bandBgHex = (g: Layer): string | null => {
    const kids = (g as unknown as Record<string, unknown>)['layers']; if (!Array.isArray(kids)) return null;
    for (const k of kids as Layer[]) { if (k.type !== 'rect') continue; const f = (k as unknown as Record<string, unknown>)['fill'] as Record<string, unknown> | undefined; if (f && typeof f['color'] === 'string') return f['color'] as string; }
    return null;
  };
  const lumOf = (hex: string): number => { const h = (hex || '').replace('#', ''); if (h.length < 6) return 1; return (0.2126 * parseInt(h.slice(0, 2), 16) + 0.7152 * parseInt(h.slice(2, 4), 16) + 0.0722 * parseInt(h.slice(4, 6), 16)) / 255; };
  // Loose top-level text the model placed OUTSIDE the bands. SHORT lines (≤3 words)
  // are section HEADINGS the model stranded (wellness: "Daily Schedule"/"Pricing"
  // piled at the top, their bands left unlabelled); when exactly one such heading
  // exists per band, seat each ABOVE its band in reading order. Everything else (the
  // doc title, an intro) goes in a zone above the first band. The menu's lone "The
  // Olive Branch" has 0 short headings ≠ 2 bands → it simply tops the brochure.
  const looseText = layers.filter(l => l && l.type === 'text' && layerText(l).trim() && !presets.includes(l));
  const headings = looseText.filter(l => layerText(l).trim().split(/\s+/).filter(Boolean).length <= 3).sort((a, b) => yOf(a) - yOf(b));
  const assignHeads = headings.length === presets.length && headings.length >= 1;
  const bandHead: Layer[] = assignHeads ? headings : [];
  const topZone = assignHeads ? looseText.filter(l => !headings.includes(l)) : looseText;
  let cursorY = 0;
  if (topZone.length) {
    topZone.sort((a, b) => fontOf(b) - fontOf(a));     // title on top, tagline/intro below
    let ty = pad;
    for (const t of topZone) ty += seatCentered(t, ty) + gap;
    cursorY = ty + Math.round(docW * 0.02);
  }
  presets.forEach((g, gi) => {
    const o = g as unknown as Record<string, unknown>;
    const gW = Number(o['width']) || docW, gH = Number(o['height']) || docH;
    const head = bandHead[gi];
    const headH = head ? textH(head) : 0;
    const topReserve = pad + (head ? headH + gap : 0);  // band-top space (+ room for a heading)
    const ext = contentExtent(g);
    let bandH: number, delta: number;
    if (ext) {                                          // trim the band to heading + content + margins
      bandH = Math.round((ext.bot - ext.top) + topReserve + pad);
      delta = (cursorY + topReserve) - ext.top;
    } else {                                            // no measurable content → keep full band
      bandH = gH + (head ? headH + gap : 0);
      delta = cursorY + (head ? headH + gap : 0) - bgTop(g);
    }
    if (delta) shiftY(g, delta);                        // move the whole section into its band
    if (head) {                                         // seat the heading over the band, contrasting its wash
      seatCentered(head, cursorY + pad);
      const ho = head as unknown as Record<string, unknown>;
      ho['z'] = zOf(g) + 1;
      const bgHex = bandBgHex(g);
      if (bgHex) { const st = (ho['style'] as Record<string, unknown>) ?? (ho['style'] = {}); st['color'] = lumOf(bgHex) < 0.5 ? '#FAFAFA' : '#141414'; }
    }
    const kids = o['layers'];
    if (Array.isArray(kids)) {
      const kept: Layer[] = [];
      for (const k of kids as Layer[]) {
        const ko = k as unknown as Record<string, unknown>;
        if (k.type === 'rect' && (Number(ko['width']) || 0) >= gW * 0.9) {  // bg / grain wash → span the band
          const p = ko['pos'];
          if (Array.isArray(p) && p.length >= 4) { p[1] = cursorY; p[3] = bandH; } else { ko['y'] = cursorY; ko['height'] = bandH; }
          kept.push(k); continue;
        }
        if (!CONTENT_TYPES.has(k.type)) {               // decoration sized for the old full band
          const b = layerBBox(k);
          if (b.b > cursorY + bandH + 2 || b.y < cursorY - 2) continue;     // overflows the trim → drop
        }
        kept.push(k);
      }
      o['layers'] = kept;
    }
    setY(g, cursorY);                                   // group box top = band top (bbox/inspect)
    if (Array.isArray(o['pos']) && (o['pos'] as unknown[]).length >= 4) (o['pos'] as unknown[])[3] = bandH; else o['height'] = bandH;
    cursorY += bandH;
  });
  // The page is now exactly the stacked bands — but never crop a top-level layer
  // (a hand-placed title sitting beside the first band) that reaches further down.
  let floor = cursorY;
  for (const l of layers) { if (presets.includes(l) || isFullCanvasBackdrop(l, docW, docH)) continue; floor = Math.max(floor, layerBBox(l).b); }
  doc.height = floor;
  const bg = layers.find(l => isFullCanvasBackdrop(l, docW, docH));
  if (bg) (bg as unknown as Record<string, unknown>)['height'] = floor; // base wash spans the whole page
  return presets.length;
}

// A full-canvas OPAQUE solid backdrop rect at the origin — the base wash a model
// lays down first. A clean page has exactly one; a thrashing rebuild re-adds it
// on every pass (8 stacked here). Gradient/noise overlays aren't counted (a legit
// layered background is base + gradient + grain → different fills, not dupes).

export function isFullCanvasBackdrop(l: Layer, docW: number, docH: number): boolean {
  if (l.type !== 'rect') return false;
  const fill = (l as unknown as Record<string, unknown>)['fill'] as Record<string, unknown> | undefined;
  if (!fill || fill['type'] !== 'solid') return false;
  const b = layerBBox(l);
  return b.x <= docW * 0.02 && b.y <= docH * 0.02 && (b.r - b.x) >= docW * 0.95 && (b.b - b.y) >= docH * 0.95;
}

// A thrashing model can rebuild a HAND-PLACED poster many times across add_layers
// calls — each pass re-adds the WHOLE composition (a full-canvas backdrop + every
// text/rect) without clearing, so the page piles up dozens of overlapping
// duplicates (here: 8 backdrops, 5 copies of each pricing tier). dropStackedPresets
// only sees preset GROUPS, not these loose layers. When several full-canvas
// backdrops AND a complete full-bleed content preset coexist — an unambiguous
// rebuild signal no clean design produces — the preset already holds the clean
// composition: keep it + one backdrop and drop the loose hand-placed duplicates.
// EXCEPT a hand-placed poster TITLE: it isn't redundant with the preset (whose
// header is usually empty), so dropping it would lose the title. Loose text is
// only dropped when it's REDUNDANT with the preset's own content (the pricing tier
// labels the grid already shows); unique loose text is kept for promoteCoveredTitle
// to surface. Loose shapes/rects are always structural junk the preset replaces.

export function dropThrashDuplicates(layers: Layer[], docW: number, docH: number): number {
  const backdropIdx = layers.map((l, i) => isFullCanvasBackdrop(l, docW, docH) ? i : -1).filter(i => i >= 0);
  const presetIdx = layers.map((l, i) => isFullBleedContentPreset(l, docW, docH) ? i : -1).filter(i => i >= 0);
  // Need the rebuild signal (≥3 stacked backdrops) AND a preset to fall back on.
  if (backdropIdx.length < 3 || presetIdx.length < 1) return 0;
  // Tokenize the preset's own text so we can tell redundant loose copies (tier
  // labels) from a unique title.
  const tokens = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9$%]+/).filter(t => t.length >= 3);
  const presetWords = new Set<string>();
  const collectText = (ls: Layer[]): void => { for (const k of ls) { if (k.type === 'text') tokens(layerText(k)).forEach(t => presetWords.add(t)); const kids = (k as unknown as Record<string, unknown>)['layers']; if (Array.isArray(kids)) collectText(kids as Layer[]); } };
  presetIdx.forEach(i => collectText([layers[i]]));
  const redundant = (l: Layer): boolean => { const t = tokens(layerText(l)); if (!t.length) return true; return t.filter(w => presetWords.has(w)).length / t.length >= 0.7; };
  const keep = new Set<number>([backdropIdx[backdropIdx.length - 1], ...presetIdx]);
  const SHAPE = new Set(['rect', 'line', 'ellipse', 'icon', 'path']);
  const drop = new Set<number>();
  layers.forEach((l, i) => {
    if (keep.has(i) || isMotifLayer(l)) return;
    if (SHAPE.has(l.type)) drop.add(i);                       // structural junk the preset replaces
    else if (l.type === 'text' && redundant(l)) drop.add(i);  // a duplicate of preset content (not the title)
  });
  let removed = 0;
  for (let i = layers.length - 1; i >= 0; i--) { if (drop.has(i)) { layers.splice(i, 1); removed++; } }
  return removed;
}

// A rebuild thrash that does NOT re-lay the backdrop (so the dup-backdrop gates
// miss it): the model re-adds the CHART/diagram group and a reworded CAPTION each
// pass, stacking three identical chart groups + two overlapping captions ("Chrome
// leads…" / "Chrome dominates…") that render as garbled overprint. Collapse two
// kinds of stacked duplicate: (1) groups sharing an id-base and box (the suffixed
// chart_3 / chart_3-2 / chart_3-3 rebuilds) → keep the last; (2) heavily
// overlapping NEAR-DUPLICATE text (same spot, ≥50% shared tokens — so two distinct
// labels that merely abut are never merged) → keep the last.

export function dedupOverlappingDuplicates(layers: Layer[], docW: number, docH: number): number {
  const drop = new Set<number>();
  const baseId = (l: Layer): string => String((l as unknown as Record<string, unknown>)['id'] ?? '').replace(/-\d+$/, '');
  const tol = Math.max(docW, docH) * 0.02;
  const sameBox = (a: Layer, b: Layer): boolean => {
    const A = layerBBox(a), B = layerBBox(b);
    return Math.abs(A.x - B.x) < tol && Math.abs(A.y - B.y) < tol && Math.abs((A.r - A.x) - (B.r - B.x)) < tol && Math.abs((A.b - A.y) - (B.b - B.y)) < tol;
  };
  // (1) stacked duplicate groups (same id-base + same box) — keep the last
  const groups = layers.map((l, i) => ({ l, i })).filter(x => x.l.type === 'group' && !isFullBleedContentPreset(x.l, docW, docH) && baseId(x.l));
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      if (baseId(groups[a].l) === baseId(groups[b].l) && sameBox(groups[a].l, groups[b].l)) drop.add(groups[a].i);
    }
  }
  // (2) heavily-overlapping near-duplicate text — keep the last
  const toks = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9$%]+/).filter(t => t.length >= 2);
  const similar = (a: Layer, b: Layer): boolean => {
    const ta = new Set(toks(layerText(a))), tb = toks(layerText(b));
    if (!ta.size || !tb.length) return false;
    return tb.filter(t => ta.has(t)).length / Math.max(ta.size, tb.length) >= 0.5;
  };
  const idOf = (l: Layer): string => String((l as unknown as Record<string, unknown>)['id'] ?? '');
  const norm = (l: Layer): string => layerText(l).toLowerCase().replace(/\s+/g, ' ').trim();
  const texts = layers.map((l, i) => ({ l, i })).filter(x => x.l.type === 'text' && layerText(x.l).trim());
  for (let a = 0; a < texts.length; a++) {
    if (drop.has(texts[a].i)) continue;
    for (let b = a + 1; b < texts.length; b++) {
      if (drop.has(texts[b].i)) continue;
      // Rename-twins: an id collision produced `X` + `X-2` (distinct ids, same
      // base). When the SAME line is re-placed across two add_layers calls the two
      // copies land at DIFFERENT y (a menu split into two offset ladders), so the
      // overlap test below misses them. If the base-id matches and the text is an
      // EXACT duplicate, drop the earlier — the `-2` suffix only exists because the
      // model reused the id, so one copy is always redundant. Keeps the last (the
      // model's most recent placement).
      const ba = baseId(texts[a].l);
      if (ba && ba === baseId(texts[b].l) && idOf(texts[a].l) !== idOf(texts[b].l)) {
        const na = norm(texts[a].l);
        if (na.length >= 3 && na === norm(texts[b].l)) { drop.add(texts[a].i); break; }
      }
      const A = layerBBox(texts[a].l), B = layerBBox(texts[b].l);
      const ox = Math.min(A.r, B.r) - Math.max(A.x, B.x), oy = Math.min(A.b, B.b) - Math.max(A.y, B.y);
      if (ox <= 0 || oy <= 0) continue;
      const inter = ox * oy, areaA = (A.r - A.x) * (A.b - A.y), areaB = (B.r - B.x) * (B.b - B.y);
      if (inter >= Math.min(areaA, areaB) * 0.6 && similar(texts[a].l, texts[b].l)) drop.add(texts[a].i);
    }
  }
  let removed = 0;
  for (let i = layers.length - 1; i >= 0; i--) { if (drop.has(i)) { layers.splice(i, 1); removed++; } }
  return removed;
}
