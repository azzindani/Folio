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

/** A fill-less `type:background` renders TRANSPARENT — light text then vanishes on
 *  export (white page) and only looks dark in the editor because the chrome shows
 *  through (suite-079: white text + orange accent + empty bg). When a backdrop has
 *  no fill, concretize one from the TEXT polarity (mostly-light text ⇒ near-black
 *  bg, mostly-dark text ⇒ cream) so every renderer agrees and the re-light pass
 *  judges the true backdrop. Returns true if a fill was assigned. */
export function ensureBackgroundFill(layers: Layer[], docW: number, docH: number): boolean {
  const bg = layers.find(l => {
    const o = l as unknown as Rec;
    return isBackdrop(o, docW, docH) && o['fill'] == null && o['color'] == null;
  });
  if (!bg) return false;
  const lums = layers
    .filter(l => (l as unknown as Rec)['type'] === 'text')
    .map(l => relLum(colorOf(l as unknown as Rec)))
    .filter(v => v >= 0);
  if (!lums.length) return false;
  const lightText = lums.filter(v => v > 0.5).length >= lums.length / 2;
  (bg as unknown as Rec)['fill'] = { type: 'solid', color: lightText ? '#0A0A0A' : '#FAF5EC' };
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
