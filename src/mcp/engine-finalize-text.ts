// Folio MCP engine — finalization passes — text fit/structure/measurement. Split from engine.ts; verbatim bodies.
import * as fs from 'fs';
import * as path from 'path';
import type { Layer, Page } from '../schema/types';

import { estTextHeight } from './shorthand-parser';
import type { ShorthandLayer } from './shorthand-parser';

import { layerBBox, layerText, isMotifLayer, isLocked } from './engine-finalize-geom';
import { isFullBleedContentPreset, isFullCanvasBackdrop } from './engine-finalize-presets';

export function spreadStackedText(layers: Layer[], docW: number, docH: number): number {
  const fontOf = (l: Layer): number => { const st = (l as unknown as Record<string, unknown>)['style'] as Record<string, unknown> | undefined; return st && typeof st['font_size'] === 'number' ? st['font_size'] as number : 16; };
  const toks = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^a-z0-9$%]+/).filter(t => t.length >= 2));
  const similar = (a: Layer, b: Layer): boolean => { const ta = toks(layerText(a)), tb = [...toks(layerText(b))]; if (!ta.size || !tb.length) return false; return tb.filter(t => ta.has(t)).length / Math.max(ta.size, tb.length) >= 0.5; };
  const texts = layers.filter(l => l.type === 'text' && layerText(l).trim() && !isLocked(l));
  const n = texts.length;
  if (n < 2) return 0;
  const parent = texts.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const A = layerBBox(texts[a]), B = layerBBox(texts[b]);
    const ox = Math.min(A.r, B.r) - Math.max(A.x, B.x), oy = Math.min(A.b, B.b) - Math.max(A.y, B.y);
    if (ox <= 0 || oy <= 0) continue;
    const inter = ox * oy, areaMin = Math.min((A.r - A.x) * (A.b - A.y), (B.r - B.x) * (B.b - B.y));
    if (inter >= areaMin * 0.6 && !similar(texts[a], texts[b])) parent[find(a)] = find(b);
  }
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const r = find(i); clusters.set(r, [...(clusters.get(r) ?? []), i]); }
  let changed = 0;
  const gap = Math.round(docH * 0.012);
  for (const idxs of clusters.values()) {
    if (idxs.length < 2) continue;
    const members = idxs.map(i => texts[i]).sort((p, q) => fontOf(q) - fontOf(p)); // largest font first
    const heights = members.map(m => { const b = layerBBox(m); return Math.max(b.b - b.y, fontOf(m)); });
    const totalH = heights.reduce((s, h) => s + h, 0) + gap * (members.length - 1);
    let cursorY = Math.min(...idxs.map(i => layerBBox(texts[i]).y));
    const maxY = docH - Math.round(docH * 0.02);
    if (cursorY + totalH > maxY) cursorY = Math.max(Math.round(docH * 0.02), maxY - totalH);
    for (let m = 0; m < members.length; m++) {
      const o = members[m] as unknown as Record<string, unknown>;
      const p = o['pos'];
      if (Array.isArray(p) && p.length >= 2) { p[1] = Math.round(cursorY); } else { o['y'] = Math.round(cursorY); }
      cursorY += heights[m] + gap;
    }
    changed += members.length;
  }
  return changed;
}

// Without a content preset to fall back on (a pure typographic poster — a quote,
// a manifesto), a model can still stamp the SAME text two or three times across
// rebuild passes, piling them up as an illegible overlap, and re-lay the full-
// canvas backdrop each pass. Gate on that duplicate-backdrop signal (≥2 identical
// full-canvas solid washes — something no one-pass design produces), then collapse
// the backdrops to one and keep only the LAST copy of each repeated text — the
// model's final pass, which is internally consistent (its attribution sits below
// its own quote). A single-pass poster that legitimately repeats a short word is
// never touched, because there's no duplicate backdrop to trip the gate.

export function dedupDuplicateText(layers: Layer[], docW: number, docH: number): number {
  const fillKey = (l: Layer): string => {
    const f = (l as unknown as Record<string, unknown>)['fill'] as Record<string, unknown> | undefined;
    if (!f || typeof f !== 'object') return '';
    if (typeof f['color'] === 'string') return f['color'] as string;
    const s = f['stops'];
    return (Array.isArray(s) && s[0] && typeof (s[0] as Record<string, unknown>)['color'] === 'string') ? (s[0] as Record<string, unknown>)['color'] as string : '';
  };
  const groups = new Map<string, number[]>();
  layers.forEach((l, i) => { if (isFullCanvasBackdrop(l, docW, docH)) { const k = fillKey(l); groups.set(k, [...(groups.get(k) ?? []), i]); } });
  // Duplicate identical backdrops are the GATE only — we don't remove them. Each
  // add_layers call re-runs this pass on the merged page; collapsing the backdrops
  // here would erase the rebuild signal before the model's later passes arrive
  // (and they're harmless — identical full-canvas washes that demoteCoveringBackdrops
  // already sinks behind content).
  let dupBackdrop = false;
  for (const arr of groups.values()) if (arr.length >= 2) dupBackdrop = true;
  if (!dupBackdrop) return 0; // no rebuild signal → leave a legit single-pass poster alone
  const norm = (s: string): string => s.replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
  const last = new Map<string, number>();
  layers.forEach((l, i) => { if (l.type === 'text' && norm(layerText(l)).length >= 6) last.set(norm(layerText(l)), i); });
  const dropT = new Set<number>();
  layers.forEach((l, i) => { if (l.type === 'text') { const k = norm(layerText(l)); if (k.length >= 6 && last.get(k) !== i) dropT.add(i); } });
  let removed = 0;
  for (let i = layers.length - 1; i >= 0; i--) { if (dropT.has(i)) { layers.splice(i, 1); removed++; } }
  return removed;
}

// A recurring blind-model failure: the model hand-places the poster's TITLE as a
// top-level text, then builds a full-canvas opaque content preset (feature_grid /
// sections) at a HIGHER z — whose background paints right over the title, so it
// renders invisible. Meanwhile the preset carries no title of its own, leaving its
// header zone empty (dead space up top). Surface the covered title: lift it above
// the preset, and when the preset's header is empty, re-seat it as a centered title
// in the top margin so it fills that dead space instead of hiding under the wash.

export function promoteCoveredTitle(layers: Layer[], docW: number, docH: number): number {
  const zOf = (l: Layer): number => { const z = (l as unknown as Record<string, unknown>)['z']; return typeof z === 'number' ? z : 0; };
  const textVal = (l: Layer): string => { const c = (l as unknown as Record<string, unknown>)['content']; return typeof c === 'string' ? c : (c && typeof c === 'object' ? String((c as Record<string, unknown>)['value'] ?? '') : ''); };
  // The preset's background color (first solid/gradient rect child) — the title,
  // once lifted on top, sits on THIS, not the original canvas, so it must contrast.
  const presetBg = (g: Layer): string | null => {
    const kids = (g as unknown as Record<string, unknown>)['layers'];
    if (!Array.isArray(kids)) return null;
    for (const k of kids as Layer[]) {
      if (k.type !== 'rect') continue;
      const f = (k as unknown as Record<string, unknown>)['fill'] as Record<string, unknown> | undefined;
      if (!f || typeof f !== 'object') continue;
      if (typeof f['color'] === 'string') return f['color'] as string;
      const stops = f['stops'];
      if (Array.isArray(stops) && stops[0] && typeof (stops[0] as Record<string, unknown>)['color'] === 'string') return (stops[0] as Record<string, unknown>)['color'] as string;
    }
    return null;
  };
  const lum = (hex: string): number => {
    const h = (hex || '').replace('#', '');
    if (h.length < 6) return 1;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  // A preset's header is "empty" when no DIRECT text child sits in its top third.
  // Only direct children: a preset's header (_title/_subtitle) is absolutely
  // positioned, while card text lives in a nested auto_layout whose children carry
  // relative y:0 — recursing would misread those as "text at the top".
  const presetHasTopText = (g: Layer): boolean => {
    const gb = layerBBox(g); const top = gb.y + (gb.b - gb.y) * 0.34;
    const kids = (g as unknown as Record<string, unknown>)['layers'];
    if (!Array.isArray(kids)) return false;
    return (kids as Layer[]).some(k => k.type === 'text' && textVal(k).trim() && layerBBox(k).y < top);
  };
  const fontOf = (l: Layer): number => { const st = (l as unknown as Record<string, unknown>)['style'] as Record<string, unknown> | undefined; return st && typeof st['font_size'] === 'number' ? st['font_size'] as number : 16; };
  let promoted = 0;
  const toReseat: Layer[] = []; // covered texts whose preset header is empty → re-seat up top
  for (let i = 0; i < layers.length; i++) {
    const t = layers[i];
    if (t.type !== 'text' || !textVal(t).trim() || isLocked(t)) continue;
    const tb = layerBBox(t), tz = zOf(t);
    const coverer = layers.find((p, j) => j !== i && isFullBleedContentPreset(p, docW, docH) && zOf(p) > tz
      && layerBBox(p).x <= tb.x + 1 && layerBBox(p).y <= tb.y + 1 && layerBBox(p).r >= tb.r - 1 && layerBBox(p).b >= tb.b - 1);
    if (!coverer) continue;
    const o = t as unknown as Record<string, unknown>;
    o['z'] = zOf(coverer) + 1;                                  // lift above the wash → visible
    const st = (o['style'] && typeof o['style'] === 'object') ? o['style'] as Record<string, unknown> : (o['style'] = {} as Record<string, unknown>);
    // The title now sits on the preset's background — recolor it to contrast that,
    // not the original canvas (a dark-canvas preset would hide the model's dark title).
    const bg = presetBg(coverer);
    if (bg) st['color'] = lum(bg) < 0.5 ? '#FAFAFA' : '#141414';
    if (!presetHasTopText(coverer)) toReseat.push(t);          // empty header → re-seat below
    promoted++;
  }
  // Re-seat the surfaced titles as a centered STACK in the top margin — largest
  // font first (the title), smaller below (the tagline) — so a title + tagline pair
  // doesn't pile up at the same y (the Lumen poster: both landed at y=65, overlapping).
  toReseat.sort((a, b) => fontOf(b) - fontOf(a));
  let cursorY = Math.round(docH * 0.06);
  for (const t of toReseat) {
    const o = t as unknown as Record<string, unknown>;
    const tb = layerBBox(t), w = tb.r - tb.x, h = Math.max(tb.b - tb.y, fontOf(t));
    const nx = Math.max(Math.round(docW * 0.04), Math.round((docW - w) / 2));
    const p = o['pos'];
    if (Array.isArray(p) && p.length >= 2) { p[0] = nx; p[1] = cursorY; } else { o['x'] = nx; o['y'] = cursorY; }
    const st = o['style'] as Record<string, unknown>;
    if (st['align'] == null) st['align'] = 'center';
    cursorY += h + Math.round(docH * 0.015);
  }
  return promoted;
}

// A blind model reliably mis-centers a hand-placed title: it sets the text's x to
// the canvas MID-LINE (docW/2) — using the center coordinate as the LEFT edge — so
// the box runs from the middle to the right edge and the whole title lands in the
// right half with empty space on the left (seen on a quote, a roadmap, an
// infographic). When a top-level text starts right at docW/2, reaches the right
// region, and nothing else occupies the left half at its height, re-center the box
// and center-align the text so it reads as a real centered title.

export function recenterHalfAnchoredText(layers: Layer[], docW: number, docH: number): number {
  const half = docW / 2, tol = docW * 0.03;
  let moved = 0;
  for (const t of layers) {
    if (t.type !== 'text' || !layerText(t).trim() || isLocked(t)) continue;
    const b = layerBBox(t), w = b.r - b.x;
    if (Math.abs(b.x - half) > tol) continue;     // left edge isn't on the mid-line
    if (b.r < docW * 0.8 || w > docW * 0.55) continue; // not the middle→right-edge signature
    // Anything meaningful in the left half at this vertical band means it's a real
    // right-column placement, not a centering slip — leave it.
    const leftOccupied = layers.some(o => {
      if (o === t || (o.type === 'rect' && isFullCanvasBackdrop(o, docW, docH)) || isMotifLayer(o)) return false;
      const ob = layerBBox(o);
      const vOverlap = Math.min(b.b, ob.b) - Math.max(b.y, ob.y);
      return vOverlap > 0 && ob.x < half - tol;
    });
    if (leftOccupied) continue;
    const o = t as unknown as Record<string, unknown>;
    const nx = Math.round((docW - w) / 2);
    const p = o['pos'];
    if (Array.isArray(p) && p.length >= 2) { p[0] = nx; } else { o['x'] = nx; }
    const st = (o['style'] && typeof o['style'] === 'object') ? o['style'] as Record<string, unknown> : (o['style'] = {} as Record<string, unknown>);
    if (st['align'] == null) st['align'] = 'center';
    moved++;
  }
  return moved;
}

// A deck's COVER slide breaks cohesion when the model hand-places it as a couple
// of loose texts with no background: it renders pure white while every content
// slide carries the deck's cream/dark wash (the productivity-tips carousel). A
// page's background may be a top-level full-canvas rect OR a full-bleed preset
// group that paints its own — sample whichever a sibling has.

export function pageBgColor(page: { layers?: Layer[] }, docW: number, docH: number): string | null {
  const anyFill = (l: Layer): string | null => {
    const f = (l as unknown as Record<string, unknown>)['fill'] as Record<string, unknown> | undefined;
    if (!f || typeof f !== 'object') return null;
    if (typeof f['color'] === 'string') return f['color'] as string;
    const s = f['stops'];
    return (Array.isArray(s) && s[0] && typeof (s[0] as Record<string, unknown>)['color'] === 'string') ? (s[0] as Record<string, unknown>)['color'] as string : null;
  };
  for (const l of page.layers ?? []) {
    if (isFullCanvasBackdrop(l, docW, docH)) { const c = anyFill(l); if (c) return c; }
    if (isFullBleedContentPreset(l, docW, docH)) {
      const kids = (l as unknown as Record<string, unknown>)['layers'];
      if (Array.isArray(kids)) for (const k of kids as Layer[]) { if (k.type === 'rect') { const c = anyFill(k); if (c) return c; } }
    }
  }
  return null;
}

// Give every deck page a background in the deck's shared color so a bg-less cover
// doesn't render white against cream/dark content slides. Idempotent and order-
// independent: it samples the reference color from whichever sibling already has
// one, so it eventually fills the cover once a content slide exists.

export function ensureDeckPageBackgrounds(pages: Page[], docW: number, docH: number): number {
  if (!pages || pages.length < 2) return 0;
  let ref: string | null = null;
  for (const p of pages) { const c = pageBgColor(p, docW, docH); if (c) { ref = c; break; } }
  if (!ref) return 0;
  let added = 0;
  for (const p of pages) {
    if (pageBgColor(p, docW, docH)) continue;
    if (!p.layers) p.layers = [];
    const minZ = p.layers.reduce((m, l) => Math.min(m, typeof (l as unknown as Record<string, unknown>)['z'] === 'number' ? (l as unknown as Record<string, unknown>)['z'] as number : 0), 0);
    p.layers.unshift({ id: `${p.id}_deckbg`, type: 'rect', z: minZ - 1, x: 0, y: 0, width: docW, height: docH, fill: { type: 'solid', color: ref } } as unknown as Layer);
    added++;
  }
  return added;
}

// Snap a top-level shorthand layer's declared box into the page canvas. Reads
// the two shapes the engine accepts — `pos:[x,y,w,h]` or `x/y/width/height` —
// and shrinks only the dimension(s) that spill past the right/bottom edge. A
// model that mistypes a portrait height (1350) onto a square doc (1080) gets a
// canvas-fitting preset instead of a clipped, un-fixable one.
// A weak model (e.g. a 3B-active nano) sometimes hand-places a whole poster as
// loose TEXT layers with NO font_size — every line then renders at the tiny
// renderer default, scattered, with no hierarchy (the recurring nano-30B miss).
// When the batch is clearly hand-placed (no preset group) and most text is
// unsized, give it an editorial hierarchy: the first line is the title, the
// second a subtitle, the rest body — sized to the canvas and re-stacked top-down
// with margins so it reads as a clean text poster instead of micro-print. Never
// touches a preset group or a deliberately-sized composition.

export function structureHandPlacedText(layers: Layer[], W: number, H: number): number {
  const textVal = (l: Layer): string => {
    const c = (l as unknown as Record<string, unknown>)['content'];
    return typeof c === 'string' ? c : (c && typeof c === 'object' ? String((c as Record<string, unknown>)['value'] ?? '') : '');
  };
  const styleOf = (l: Layer): Record<string, unknown> => {
    const o = l as unknown as Record<string, unknown>;
    if (!o['style'] || typeof o['style'] !== 'object') o['style'] = {};
    return o['style'] as Record<string, unknown>;
  };
  const texts = layers.filter(l => l?.type === 'text' && !isLocked(l));
  const hasContainer = layers.some(l => l?.type === 'group' || l?.type === 'auto_layout');
  const unsized = texts.filter(l => styleOf(l)['font_size'] == null);
  // Only restructure a clearly hand-placed, mostly-unsized text poster.
  if (hasContainer || unsized.length < 2 || unsized.length < texts.length * 0.6) return 0;
  // Read the canvas background color (a full-bleed solid rect, if any) so the
  // rescued text gets a READABLE color — a model that drops font_size usually
  // drops color too, defaulting to dark text that vanishes on a dark canvas.
  const lum = (hex: string): number => {
    const h = (hex || '').replace('#', '');
    if (h.length < 6) return 1;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const bgRect = layers.find(l => {
    const o = l as unknown as Record<string, unknown>;
    const fill = o['fill'] as Record<string, unknown> | undefined;
    return l?.type === 'rect' && (o['width'] as number) >= W * 0.9 && fill?.['type'] === 'solid' && typeof fill['color'] === 'string';
  });
  const bgHex = bgRect ? ((bgRect as unknown as Record<string, unknown>)['fill'] as Record<string, string>)['color'] : '#FFFFFF';
  const dark = lum(bgHex) < 0.5;
  const headColor = dark ? '#FAFAFA' : '#1A1A1A';
  const bodyColor = dark ? '#C9C6BF' : '#4A4640';
  const M = Math.round(W * 0.075), colW = W - 2 * M;
  let cy = Math.round(H * 0.09);
  unsized.forEach((l, i) => {
    const o = l as unknown as Record<string, unknown>;
    const style = styleOf(l);
    const len = textVal(l).trim().length;
    let size: number, weight = 400, lh = 1.45;
    if (i === 0) { size = Math.round(W * (len > 48 ? 0.05 : 0.066)); weight = 800; lh = 1.05; }
    else if (i === 1 && len <= 130) { size = Math.round(W * 0.03); weight = 500; lh = 1.35; }
    else { size = Math.round(W * 0.023); lh = 1.5; }
    style['font_size'] = size;
    if (style['font_weight'] == null) style['font_weight'] = weight;
    if (style['line_height'] == null) style['line_height'] = lh;
    if (style['color'] == null) style['color'] = i <= 1 ? headColor : bodyColor;
    const h = estTextHeight(textVal(l), size, colW, lh);
    o['x'] = M; o['y'] = cy; o['width'] = colW; o['height'] = h;
    cy += h + Math.round(W * (i === 0 ? 0.028 : 0.02));
  });
  return unsized.length;
}

// Push apart hand-placed layers that OVERPRINT. A blind model gives each text
// layer an explicit height it can't verify; the text wraps past it and collides
// with whatever is below (the fitness-infographic case). Re-measure every text
// layer's TRUE height, then sweep top→bottom: any layer whose top sits inside a
// higher layer it horizontally overlaps is pushed down to clear it. Side-by-side
// items (a row of stat cards) don't overlap horizontally, so they stay aligned;
// a full-width heading above a row pushes the whole row down. A preset (one group)
// or an already-clean layout → no moves. Returns the number of layers shifted.

export function decollideHandPlaced(layers: Layer[], W: number, H: number): number {
  const o = (l: Layer): Record<string, unknown> => l as unknown as Record<string, unknown>;
  const isFullBleed = (l: Layer): boolean => {
    const r = o(l); const w = Number(r['width']) || 0; const h = Number(r['height']) || 0;
    return (l.type === 'rect' || l.type === 'image') && w >= W * 0.9 && h >= H * 0.9;
  };
  const textVal = (l: Layer): string => {
    const c = o(l)['content'];
    return typeof c === 'string' ? c : (c && typeof c === 'object' ? String((c as Record<string, unknown>)['value'] ?? '') : '');
  };
  // A text box's collision height is what it RENDERS — its measured wrapped height,
  // NOT a generous layout-reservation the model declared. The old Math.max(given,…)
  // floor honored a too-tall reservation: a deliberate two-column spread where each
  // paragraph reserved 360px but wrapped to 148px got its second row pushed down by
  // the full 360, then setMeasuredTextHeights shrank the box to 148 and never
  // reclaimed the gap — a dead band mid-column. Measure to truth (matching
  // setMeasuredTextHeights, which snaps both ways), passing the font char factor so a
  // condensed display face isn't over-measured. A too-SHORT box for long text still
  // grows (measured > given), so the blind-model overprint rescue is intact.
  const measuredH = (l: Layer): number => {
    const r = o(l); const given = Number(r['height']) || 0;
    if (l.type !== 'text') return given;
    const style = (r['style'] as Record<string, unknown>) ?? {};
    const fs = Number(style['font_size']) || Math.round(W * 0.025);
    const lh = Number(style['line_height']) || 1.4;
    const font = typeof style['font_family'] === 'string' ? style['font_family'] as string : '';
    const w = Number(r['width']) || W;
    return estTextHeight(textVal(l), fs, w, lh, fontCharFactor(font));
  };
  // A motif is a behind-content decoration, not a flow row — never stack it (that
  // would shove it off-canvas). dropCollidingMotifs is the sole authority on it.
  // A connector/line is STRUCTURAL — its geometry is its endpoints (it joins two
  // anchors the model placed deliberately); moving it orphans the join, so it's
  // never a flow row nor a collision floor.
  const isWire = (l: Layer): boolean => { const t = (l as { type?: string }).type; return t === 'connector' || t === 'line'; };
  // A text whose box sits inside a non-text BACKING shape is a label/caption ON that
  // shape (a node caption, a button/pill text, a card stat, a panel heading) — a
  // deliberate composite, not a flow row. decollide used to eject such content out
  // the bottom of its box (node captions, then card labels/deltas when the card was
  // bigger than ~8× the text but smaller than a panel — the size-threshold middle
  // gap). The fix is geometric, not size-based: ANY non-text shape larger than the
  // text and holding ≥80% of it is its container. The content rides with the
  // container and is never pushed on its own; the container itself is scenery.
  const boxOf = (l: Layer): { x: number; y: number; w: number; h: number } => {
    const r = o(l); return { x: Number(r['x']) || 0, y: Number(r['y']) || 0, w: Number(r['width']) || 0, h: Number(r['height']) || 0 };
  };
  const isShape = (l: Layer): boolean => {
    const t = (l as { type?: string }).type;
    return t === 'rect' || t === 'circle' || t === 'ellipse' || t === 'path' || t === 'polygon';
  };
  const containerOf = (t: Layer): Layer | null => {
    if (t.type !== 'text') return null;
    const b = boxOf(t); const ta = b.w * b.h;
    if (ta <= 0) return null;
    let best: Layer | null = null; let bestArea = Infinity;
    for (const s of layers) {
      if (s === t || !isShape(s) || isFullBleed(s) || isLocked(s)) continue;  // not the full-canvas bg
      const sb = boxOf(s); const sa = sb.w * sb.h;
      if (sa < ta) continue;                          // a backing shape is larger than its content
      const ox = Math.max(0, Math.min(b.x + b.w, sb.x + sb.w) - Math.max(b.x, sb.x));
      const oy = Math.max(0, Math.min(b.y + b.h, sb.y + sb.h) - Math.max(b.y, sb.y));
      if (ox * oy >= 0.8 * ta && sa < bestArea) { best = s; bestArea = sa; }  // smallest holder
    }
    return best;
  };
  // Every backing shape that holds content (a card, pill, node, panel) is scenery:
  // never moved, never a collision floor for what sits on it. The CONTENT stays
  // movable, so two genuinely overlapping captions inside the same card still
  // de-collide against each other (the overprint rescue survives inside a card).
  const containerShapes = new Set<Layer>();
  for (const l of layers) { const c = containerOf(l); if (c) containerShapes.add(c); }
  // A layer the model deliberately bled off-canvas (a corner blob, an oversized
  // accent circle, a half-bleed band) is intentional SCENERY, not a flow row —
  // flow content is placed inside the canvas. Treating a bleeding decorative circle
  // as a collision floor shoved the magazine-cover masthead 325px down the page.
  // Exempt anything whose box runs meaningfully past an edge: never moved, never a
  // floor. (Fully-off-canvas mistakes are still rescued by snapOffCanvasContent.)
  const bleedsOffCanvas = (l: Layer): boolean => {
    const b = boxOf(l);
    return b.w > 0 && b.h > 0 && (b.x < -8 || b.y < -8 || b.x + b.w > W + 8 || b.y + b.h > H + 8);
  };
  // A large NON-TEXT shape is a background PANEL that BACKS content — a split-screen
  // half, a full-height sidebar, a masthead band, a full-height seam/divider — not a
  // flow row. Like a full-canvas backdrop it must never be moved nor be a collision
  // floor: otherwise a thin full-height divider overlapping two half-panels cascades
  // them clean off the canvas (the split-screen "Before/After" wreck). Detected by
  // covering ≥⅓ of the canvas OR spanning a full dimension (full-width / full-height).
  const isBackdropPanel = (l: Layer): boolean => {
    const t = (l as { type?: string }).type;
    if (!(isShape(l) || t === 'image')) return false;
    const b = boxOf(l);
    return b.w > 0 && b.h > 0 && (b.w * b.h >= 0.33 * W * H || b.w >= 0.9 * W || b.h >= 0.9 * H);
  };
  const movable = layers.filter(l => l && !isFullBleed(l) && !isMotifLayer(l) && !isWire(l) && !bleedsOffCanvas(l) && !isBackdropPanel(l) && !containerShapes.has(l) && !isLocked(l) && typeof o(l)['x'] === 'number' && typeof o(l)['y'] === 'number');
  if (movable.length < 2) return 0;
  const ordered = [...movable].sort((a, b) => (Number(o(a)['y']) - Number(o(b)['y'])) || (Number(o(a)['x']) - Number(o(b)['x'])));
  const placed: { x: number; w: number; bot: number }[] = [];
  const gap = Math.round(W * 0.014);
  let moved = 0;
  for (const l of ordered) {
    const r = o(l);
    const x = Number(r['x']); const w = Number(r['width']) || 1;
    const mh = measuredH(l);
    if (l.type === 'text' && mh > (Number(r['height']) || 0)) r['height'] = mh;
    let top = Number(r['y']);
    let floor = -Infinity;
    for (const p of placed) if (x < p.x + p.w && p.x < x + w) floor = Math.max(floor, p.bot + gap);
    if (floor > top + 1) { top = Math.round(floor); r['y'] = top; moved++; }
    placed.push({ x, w, bot: top + mh });
  }
  return moved;
}

// A blind model stores hand-placed text with height:0 — it can't see how many
// lines its words will wrap to, so it leaves the box height unset (or guesses a
// single line). EVERY geometry safety pass that runs on the merged set —
// spreadStackedText, snapOffCanvasContent, promoteCoveredTitle — reads that 0 as
// a zero-height box and never fires, so a quote that wraps to five lines silently
// overprints its attribution and spills off the canvas (decollideHandPlaced would
// catch it, but it only runs on THIS call's `incoming`, missing text split across
// add_layers calls). Measure each TOP-LEVEL sized text's true wrapped height and
// set it, so the downstream passes see the box that will actually render. Only
// top-level (auto_layout card text keeps relative coords); only grows a too-short
// box, never shrinks a real one; unsized text is left to structureHandPlacedText.
// Average glyph advance as a fraction of font size — condensed display faces
// (Anton/Bebas/Oswald) pack ~35% more characters per line than a default serif/
// sans, monospace fewer. Feeding the right factor to estTextHeight keeps a
// headline in a condensed font from being over-measured (and needlessly shrunk).

export function fontCharFactor(font: string): number {
  const f = (font || '').toLowerCase();
  if (/mono|courier|consolas/.test(f)) return 0.6;
  if (/bebas|anton|oswald|archivo narrow|condensed|teko|fjalla/.test(f)) return 0.4;
  // Wide display faces fit fewer chars/line → under-reserve height without this.
  if (/audiowide|bungee|wallpoet|monoton|syncopate|black ops/.test(f)) return 0.82;
  if (/orbitron|michroma|chakra petch|aldrich|electrolize/.test(f)) return 0.70;
  return 0.54;
}

// A blind model routinely sizes a hand-placed hero line (a quote, a big headline)
// far too large — it can't see that the words wrap to five lines and fill the
// whole canvas, leaving no room for the attribution/footer it also placed (which
// then gets shoved off the bottom by the de-collide). When a MULTI-LINE top-level
// text overflows the space left after its sibling texts + margins, shrink its font
// until it fits. Multi-line gate (lines>=3) so a deliberately giant one-word poster
// ("SALE") is never shrunk. Hand-placed posters only — a preset owns its own sizing.

export function fitOverflowingHeroText(layers: Layer[], _W: number, H: number): number {
  const measure = (l: Layer): { h: number; lines: number; fs: number } | null => {
    if (!l || l.type !== 'text') return null;
    const o = l as unknown as Record<string, unknown>;
    const text = layerText(l).trim(); if (!text) return null;
    const style = (o['style'] as Record<string, unknown>) ?? {};
    const fs = Number(style['font_size']); if (!(fs > 0)) return null;
    const lh = Number(style['line_height']) || 1.4;
    const font = typeof style['font_family'] === 'string' ? style['font_family'] as string : '';
    const p = o['pos'];
    const w = Number(o['width']) || (Array.isArray(p) && p.length >= 3 ? Number(p[2]) : 0);
    if (!(w > 0)) return null;
    const h = estTextHeight(text, fs, w, lh, fontCharFactor(font));
    return { h, lines: Math.max(1, Math.round(h / (fs * lh))), fs };
  };
  const texts = layers.filter(l => !isLocked(l) && measure(l));
  if (texts.length < 2) return 0;                               // nothing to make room for
  const margin = Math.round(H * 0.14), gap = Math.round(H * 0.02);
  let fixed = 0;
  for (const l of texts) {
    const m = measure(l); if (!m || m.lines < 3) continue;       // only a wrapped block can overflow
    let sib = 0;
    for (const s of texts) { if (s === l) continue; const sm = measure(s); if (sm) sib += sm.h; }
    const avail = H - margin - gap * (texts.length - 1) - sib;
    if (m.h <= avail || avail < H * 0.2) continue;               // already fits / no sane room
    const o = l as unknown as Record<string, unknown>;
    const style = o['style'] as Record<string, unknown>;
    let fs = m.fs;
    while (fs > 24) {                                            // shrink until the block fits the room left
      fs = Math.round(fs * 0.9);
      style['font_size'] = fs;
      const mm = measure(l);
      if (mm && mm.h <= avail) break;
    }
    fixed++;
  }
  return fixed;
}

export function setMeasuredTextHeights(layers: Layer[], _W: number): number {
  let set = 0;
  for (const l of layers) {
    if (!l || l.type !== 'text' || isLocked(l)) continue;
    const o = l as unknown as Record<string, unknown>;
    const text = layerText(l).trim();
    if (!text) continue;
    const style = (o['style'] as Record<string, unknown>) ?? {};
    const fs = Number(style['font_size']);
    if (!(fs > 0)) continue;                                     // unsized → structureHandPlacedText owns it
    const lh = Number(style['line_height']) || 1.4;
    const font = typeof style['font_family'] === 'string' ? style['font_family'] as string : '';
    const p = o['pos'];
    const w = Number(o['width']) || (Array.isArray(p) && p.length >= 3 ? Number(p[2]) : 0);
    if (!(w > 0)) continue;
    const measured = estTextHeight(text, fs, w, lh, fontCharFactor(font));
    const given = Number(o['height']) || (Array.isArray(p) && p.length >= 4 ? Number(p[3]) : 0) || 0;
    // Track the measured height in BOTH directions: a height:0 box must grow, but a
    // box left STALE-tall after fitOverflowingHeroText shrank the font must shrink
    // too — otherwise the inflated box shoves the layers below it off the canvas.
    if (Math.abs(measured - given) > 2) {
      if (Array.isArray(p) && p.length >= 4) p[3] = measured; else o['height'] = measured;
      set++;
    }
  }
  return set;
}

export function clampShorthandToCanvas(layers: ShorthandLayer[], W: number, H: number): void {
  if (!(W > 0) || !(H > 0)) return;
  for (const sh of layers) {
    const r = sh as Record<string, unknown>;
    // A circle/ellipse the model bled off an edge is intentional decoration —
    // clamping ONE axis distorts it into a squashed egg (the magazine-cover accent
    // blob became an ellipse). Leave it; decollide's bleed-exemption handles it.
    if (r['type'] === 'circle' || r['type'] === 'ellipse') continue;
    const p = r['pos'];
    if (Array.isArray(p) && p.length >= 4 && p.slice(0, 4).every(n => typeof n === 'number')) {
      const [x, y, w, h] = p as number[];
      r['pos'] = [x, y, x + w > W ? Math.max(1, W - x) : w, y + h > H ? Math.max(1, H - y) : h];
      continue;
    }
    const x = typeof r['x'] === 'number' ? (r['x'] as number) : 0;
    const y = typeof r['y'] === 'number' ? (r['y'] as number) : 0;
    if (typeof r['width'] === 'number' && x + (r['width'] as number) > W) r['width'] = Math.max(1, W - x);
    if (typeof r['height'] === 'number' && y + (r['height'] as number) > H) r['height'] = Math.max(1, H - y);
    // A HAND-PLACED text layer with NO width renders at natural width, so a long
    // headline runs clean off both canvas edges (the feature_grid title-overflow
    // the user hit: the model hand-placed a 64px headline beside a preset instead
    // of using the preset's title slot, with no x/width → pinned at 0,0, clipped).
    // Give a width-less text layer a canvas-fit wrapping width (and nudge it off
    // the hard left edge) so it wraps inside the canvas instead of overflowing.
    if (isTextLayer(r) && r['width'] === undefined && !Array.isArray(p)) {
      const margin = Math.round(W * 0.06);
      const xx = typeof r['x'] === 'number' ? Math.max(0, r['x'] as number) : margin;
      if (typeof r['x'] !== 'number') r['x'] = margin;
      r['width'] = Math.max(1, W - xx - margin);
    }
  }
}

// A text-bearing shorthand layer: an explicit type:"text", or (type omitted) a
// layer carrying text content — content:{value}/text/value — and no shape/preset
// signal. Used to width-fit hand-placed headlines so they wrap, not overflow.

export function isTextLayer(r: Record<string, unknown>): boolean {
  if (r['type'] === 'text') return true;
  if (r['type'] !== undefined) return false;
  const c = r['content'];
  if (c && typeof c === 'object' && typeof (c as Record<string, unknown>)['value'] === 'string') return true;
  return typeof r['text'] === 'string' || typeof r['value'] === 'string';
}

// Index of a design within its sibling VARIANT SET — designs in the same folder
// whose filename differs ONLY by a trailing integer (the "give me N options of one
// topic" pattern: folio-poster-1, folio-poster-2, …). A weak model passes `variant`
// to enrich_brief but then DROPS the returned bg/accent/font on add_layers, so all N
// same-topic designs fall to ONE content-seeded mood and render IDENTICALLY (the
// "failed to generate N distinct designs" report). The index lets seededDefaults pick
// the Nth curated art-direction even with no style passed. A lone design (no
// integer-only sibling sharing its stem) → 0 → byte-identical to before.

export function variantIndexForDesign(designPath: string): number {
  const base = path.basename(designPath).replace(/\.design\.yaml$/i, '');
  const m = /^(.*?)[-_ ]?(\d+)$/.exec(base);
  if (!m || !m[1]) return 0; // no trailing number, or an all-digit name → not a set
  const stem = m[1];
  const num = Number(m[2]);
  let nums: number[];
  try {
    nums = fs.readdirSync(path.dirname(designPath))
      .map(f => /^(.*?)[-_ ]?(\d+)\.design\.yaml$/i.exec(f))
      .filter((x): x is RegExpExecArray => x !== null && x[1] === stem)
      .map(x => Number(x[2]));
  } catch { return 0; }
  const sorted = Array.from(new Set(nums)).sort((a, b) => a - b);
  const idx = sorted.indexOf(num);
  return idx < 0 ? 0 : idx;
}
