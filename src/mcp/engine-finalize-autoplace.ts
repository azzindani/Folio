// Folio MCP engine — finalize pass: strip null layers + place positionless ones.
//
// Two structural faults a weak model emits, neither caught by the geometry/
// legibility passes (which assume every layer has coordinates):
//   1. a stray `- null` (or a non-object) in a layers array → the EDITOR crashes
//      on load (`Cannot read properties of null (reading 'id')`); the renderer
//      skips it but the file is poison. Strip it.
//   2. a layer with NO geometry — `type`+`style`+`content` but no x/y/width (the
//      model expected the engine to flow it). It falls to the origin (0,0); a
//      `align:center` headline then anchors its MIDDLE at x=0 so half overflows
//      the LEFT edge, and every such layer piles up at the corner while the rest
//      of the page is empty (suite-079's 5-page carousel). Flow them into a
//      centered column with real widths so centered text wraps in-canvas.
import type { Layer } from '../schema/types';
import { estTextHeight } from './shorthand-helpers';
import { layerBBox, layerText } from './engine-finalize-geom';

type Rec = Record<string, unknown>;

/** Remove null / non-object entries from a layers array, recursively through
 *  group children. Returns the count removed. */
export function stripNullLayers(layers: unknown): number {
  if (!Array.isArray(layers)) return 0;
  let removed = 0;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l == null || typeof l !== 'object') { layers.splice(i, 1); removed++; continue; }
    const o = l as Rec;
    if (Array.isArray(o['layers'])) removed += stripNullLayers(o['layers']);
    if (Array.isArray(o['children'])) removed += stripNullLayers(o['children']);
  }
  return removed;
}

function num(v: unknown): number | undefined { return typeof v === 'number' && isFinite(v) ? v : undefined; }

const EMBEDDED_LAYER_RE = /"(type|text|content|fill|font|fontSize|font_size|x|y|width|height|style)"\s*:/;

function textOf(o: Rec): string {
  const c = o['content'];
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object' && typeof (c as Rec)['value'] === 'string') return (c as Rec)['value'] as string;
  return typeof o['text'] === 'string' ? (o['text'] as string) : '';
}

// Obvious throwaway placeholder strings a model leaves in an unfinished design
// (suite-031 "Cover line 1".."Cover line 4"). Conservative — only matches text
// that is CLEARLY a placeholder, never real copy.
const PLACEHOLDER_RE = /^(cover\s*line\s*\d*|lorem(\s+ipsum.*)?|(your|add|enter|insert)\s+(text|title|name|headline|subtitle|content|tagline|copy)(\s+here)?|(body|heading|headline|sub-?title|title|caption|paragraph|tagline)(\s*(text|here|goes\s*here))?|text\s*(goes\s*)?here|placeholder(\s*text)?|empty|blank|untitled|todo|tbd|x+|n\/a|\[.*\]|lorem)$/i;

/** Drop text layers whose content is an obvious leftover placeholder so an
 *  unfinished template never ships with "Cover line 1" visible. Recurses groups. */
export function dropPlaceholderText(layers: Layer[]): number {
  if (!Array.isArray(layers)) return 0;
  let dropped = 0;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l || typeof l !== 'object') continue;
    const o = l as unknown as Rec;
    if (Array.isArray(o['layers'])) dropped += dropPlaceholderText(o['layers'] as Layer[]);
    if (o['type'] !== 'text') continue;
    if (PLACEHOLDER_RE.test(textOf(o).trim())) { layers.splice(i, 1); dropped++; }
  }
  return dropped;
}

/** One parsed object (from an embedded-JSON blob) → a valid layer. Maps the flat
 *  aliases the model emitted (text/font/fontSize/fill) onto content+style. */
function coerceLayer(p: unknown, idx: number): Layer | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Rec;
  const type = typeof o['type'] === 'string' ? (o['type'] as string) : 'text';
  const out: Rec = { id: `recovered_${idx}`, type, z: idx };
  for (const k of ['x', 'y', 'width', 'height', 'rotation', 'opacity']) if (typeof o[k] === 'number') out[k] = o[k];
  if (type === 'text') {
    const txt = textOf(o);
    if (!txt.trim()) return null;
    out['content'] = { type: 'plain', value: txt };
    const st: Rec = (o['style'] && typeof o['style'] === 'object') ? { ...(o['style'] as Rec) } : {};
    if (typeof st['font'] === 'string' && st['font_family'] == null) { st['font_family'] = st['font']; delete st['font']; }
    if (typeof o['font'] === 'string' && st['font_family'] == null) st['font_family'] = o['font'];
    if (typeof o['fontSize'] === 'number' && st['font_size'] == null) st['font_size'] = o['fontSize'];
    if (typeof o['fill'] === 'string' && st['color'] == null) st['color'] = o['fill'];
    if (typeof o['color'] === 'string' && st['color'] == null) st['color'] = o['color'];
    out['style'] = st;
  } else {
    if (o['fill'] != null) out['fill'] = o['fill'];
    if (typeof o['color'] === 'string') out['color'] = o['color'];
  }
  return out as unknown as Layer;
}

/** A weak model sometimes serializes an ARRAY of layer specs into ONE text
 *  layer's content — the engine then renders the raw JSON blob as literal text
 *  (suite-033 "BAD WEATHER" code, suite-084 baby-garcia). Detect a text layer
 *  whose value is embedded layer-JSON, parse it, and splice the real layers in
 *  its place; if it won't parse, DROP it (never ship rendered code). Recurses
 *  into group children. Returns {recovered, dropped}. */
export function recoverEmbeddedLayers(layers: Layer[]): { recovered: number; dropped: number } {
  if (!Array.isArray(layers)) return { recovered: 0, dropped: 0 };
  let recovered = 0, dropped = 0;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l || typeof l !== 'object') continue;
    const o = l as unknown as Rec;
    if (Array.isArray(o['layers'])) { const r = recoverEmbeddedLayers(o['layers'] as Layer[]); recovered += r.recovered; dropped += r.dropped; }
    if (o['type'] !== 'text') continue;
    const s = textOf(o).trim();
    if (!(s.startsWith('[') || s.startsWith('{')) || !EMBEDDED_LAYER_RE.test(s)) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(s); } catch { layers.splice(i, 1); dropped++; continue; }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const built = arr.map((p, j) => coerceLayer(p, i + j)).filter((x): x is Layer => x != null);
    if (!built.length) { layers.splice(i, 1); dropped++; continue; }
    layers.splice(i, 1, ...built);
    recovered += built.length;
  }
  return { recovered, dropped };
}

function isPositionless(o: Rec): boolean {
  const pos = o['pos'];
  if (Array.isArray(pos) && pos.length >= 2 && typeof pos[0] === 'number' && typeof pos[1] === 'number') return false;
  return num(o['x']) === undefined || num(o['y']) === undefined;
}

// Data-bound layers carry STRING x/y (field names like x:"ticker") and are laid
// out by the report binder, not the poster flow — `x` here is an alias for
// x_field, not a pixel. Never flow these; placing them would clobber the binding
// before normalizeReportAliases folds x→x_field.
const REPORT_TYPES = new Set(['interactive_chart', 'interactive_table', 'chart', 'table', 'filter_bar', 'kpi', 'metric']);
function isFlowEligible(o: Rec): boolean {
  if (typeof o['x'] === 'string' || typeof o['y'] === 'string') return false;
  return !(typeof o['type'] === 'string' && REPORT_TYPES.has(o['type'] as string));
}

function fontSizeOf(o: Rec): number {
  const st = o['style'] as Rec | undefined;
  return (st && num(st['font_size'])) ?? num(o['font_size']) ?? num(o['size']) ?? 32;
}

function relLum(hex: unknown): number {
  if (typeof hex !== 'string') return -1;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return -1;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function colorOf(o: Rec): string | undefined {
  const st = o['style'] as Rec | undefined;
  const c = (st && st['color']) ?? o['color'];
  return typeof c === 'string' ? c : undefined;
}

/** Pick a legible backdrop color from the TEXT polarity: mostly-light text ⇒
 *  near-black bg, mostly-dark text ⇒ cream. Returns undefined when there is no
 *  text to judge. */
function polarityBg(layers: Layer[]): string | undefined {
  const lums = layers
    .filter(l => (l as unknown as Rec)['type'] === 'text')
    .map(l => relLum(colorOf(l as unknown as Rec)))
    .filter(v => v >= 0);
  if (!lums.length) return undefined;
  const lightText = lums.filter(v => v > 0.5).length >= lums.length / 2;
  return lightText ? '#0A0A0A' : '#FAF5EC';
}

/** True if ANY backdrop ELEMENT exists in the tree (full-bleed rect/image or a
 *  background/backdrop type), filled OR not, including nested inside a group. The
 *  inject only fires when a page has NO background element whatsoever (suite-080:
 *  bare text on the canvas) — never a second bg on a design that already has a
 *  background slot (even an as-yet-unfilled one in a wrapping group). */
function hasBackdrop(layers: Layer[], docW: number, docH: number): boolean {
  for (const l of layers) {
    const o = l as unknown as Rec;
    const t = o['type'];
    if (t === 'background' || t === 'backdrop') return true;
    if (t === 'rect' || t === 'image') {
      const w = num(o['width']), h = num(o['height']);
      if (w !== undefined && h !== undefined && w >= docW * 0.9 && h >= docH * 0.9) return true;
    }
    const kids = o['layers'] ?? o['children'];
    if (Array.isArray(kids) && hasBackdrop(kids as Layer[], docW, docH)) return true;
  }
  return false;
}

/** A page/poster needs an opaque backdrop or it renders TRANSPARENT — dark text
 *  then vanishes against a dark viewer and light text against a white export.
 *  Two faults, both fixed here:
 *   1. a fill-less `type:background` (suite-079) → concretize from text polarity.
 *   2. NO backdrop layer at all, just text on the bare canvas (suite-080's
 *      carousel: dark Playfair on transparent pages → illegible) → inject a
 *      full-bleed background so the page is self-contained on every renderer.
 *  `themeBg` (the doc theme's canvas color) is preferred for the injected bg so
 *  pages match the design's intent; the later re-light pass fixes any contrast.
 *  Returns true if it changed the layers. Idempotent — an opaque bg is a no-op. */
export function ensureBackgroundFill(layers: Layer[], docW: number, docH: number, themeBg?: string): boolean {
  // 1. an existing fill-less backdrop → concretize from text polarity.
  const empty = layers.find(l => {
    const o = l as unknown as Rec;
    return isBackdrop(o, docW, docH) && o['fill'] == null && o['color'] == null;
  });
  if (empty) {
    const c = polarityBg(layers);
    if (!c) return false;
    (empty as unknown as Rec)['fill'] = { type: 'solid', color: c };
    return true;
  }
  // 2. a backdrop element already present (incl. nested in a group) → leave it.
  if (hasBackdrop(layers, docW, docH)) return false;
  // 3. no backdrop at all but real content present → inject one.
  const hasContent = layers.some(l => {
    const t = (l as unknown as Rec)['type'];
    return t === 'text' || t === 'shape' || t === 'rect' || t === 'image' || t === 'icon' || t === 'group';
  });
  if (!hasContent) return false;
  const color = themeBg ?? polarityBg(layers) ?? '#FAF5EC';
  layers.unshift({ id: '_bg_auto', type: 'background', x: 0, y: 0, width: docW, height: docH, z: -1, fill: { type: 'solid', color } } as unknown as Layer);
  return true;
}

/** A positionless layer that wants the whole canvas (a backdrop) — full-bleed it
 *  rather than flowing it into the column. */
function isBackdrop(o: Rec, docW: number, docH: number): boolean {
  if (o['type'] === 'background') return true;
  if (o['type'] === 'rect') {
    const w = num(o['width']), h = num(o['height']);
    return (w === undefined || w >= docW * 0.9) && (h === undefined || h >= docH * 0.9);
  }
  return false;
}

/** Assign coordinates to layers that have none. Positioned layers are left
 *  untouched; if any exist, the flow appends below them (never clobbers a
 *  deliberate layout) — otherwise it centers a full-page column. */
export function placePositionlessLayers(layers: Layer[], docW: number, docH: number): number {
  if (!Array.isArray(layers) || !layers.length) return 0;
  let placed = 0;
  const sideM = Math.round(docW * 0.08);
  const contentW = docW - sideM * 2;

  // 1. Positionless backdrops → full bleed.
  for (const l of layers) {
    const o = l as unknown as Rec;
    if (isPositionless(o) && isFlowEligible(o) && isBackdrop(o, docW, docH)) {
      o['x'] = 0; o['y'] = 0; o['width'] = docW; o['height'] = docH; delete o['pos'];
      placed++;
    }
  }

  // 2. Remaining positionless CONTENT layers, in document order.
  const flow = layers.filter(l => { const o = l as unknown as Rec; return isPositionless(o) && isFlowEligible(o) && !isBackdrop(o, docW, docH); });
  if (!flow.length) return placed;

  const items = flow.map(l => {
    const o = l as unknown as Rec;
    const isIcon = o['type'] === 'icon';
    const isText = !isIcon && (o['type'] === 'text' || o['content'] != null || o['text'] != null);
    let h: number;
    if (isIcon) h = num(o['size']) ?? Math.round(docW * 0.08);
    else if (isText) h = estTextHeight(layerText(l) || String(o['text'] ?? ''), fontSizeOf(o), contentW);
    else h = num(o['height']) ?? Math.round(docH * 0.1);
    return { o, h, isIcon, isText };
  });

  const gap = Math.round(docH * 0.03);
  const totalH = items.reduce((s, it) => s + it.h, 0) + gap * (items.length - 1);

  // Append below any already-placed content, else center the column.
  let positionedBottom = 0;
  for (const l of layers) {
    const o = l as unknown as Rec;
    if (isPositionless(o) || isBackdrop(o, docW, docH)) continue;
    positionedBottom = Math.max(positionedBottom, layerBBox(l).b);
  }
  const topM = Math.round(docH * 0.08);
  let cursorY = positionedBottom > topM
    ? positionedBottom + gap
    : Math.max(topM, Math.round((docH - totalH) / 2));

  for (const it of items) {
    const o = it.o;
    if (it.isIcon) {
      const sz = num(o['size']) ?? Math.round(docW * 0.08);
      o['x'] = Math.round((docW - sz) / 2);
      o['y'] = Math.round(cursorY);
    } else {
      o['x'] = sideM; o['y'] = Math.round(cursorY); o['width'] = contentW;
      if (it.isText) {
        const st = (o['style'] as Rec) ?? (o['style'] = {} as Rec);
        if (st['align'] == null) st['align'] = 'center';
        o['height'] = Math.round(it.h);
      }
    }
    delete o['pos'];
    cursorY += it.h + gap;
    placed++;
  }
  return placed;
}
