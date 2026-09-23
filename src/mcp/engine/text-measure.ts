// Shared text-measurement heuristic — the ONE place the engine estimates how
// tall a wrapped text layer renders. Used by the layout presets (to stack
// blocks) AND by diagnose_design (to catch a box that's too short, so the text
// spills past it and collides with whatever sits below). A vision-less model
// can't see wrapping; this gives it the number it's missing.
//
// Deliberately font-agnostic and slightly generous: the goal is to reliably
// flag "this box is way too short", not pixel-perfect metrics. Pure — no I/O.

import type { Layer } from '../../schema/types';
import { layerText } from '../../schema/layer-text';
import { wrapToWidth } from '../../utils/text-width';
import { emMeasure } from '../../utils/font-widths';

/** Average glyph advance as a fraction of font size, by font family category. */
function advanceRatio(font?: string): number {
  if (!font) return 0.54;
  const f = font.toLowerCase();
  if (/mono|courier|consolas/.test(f)) return 0.6;            // monospace runs wide
  if (/bebas|anton|oswald|archivo narrow|condensed/.test(f)) return 0.4; // condensed display
  return 0.54;                                                 // serif / sans default
}

/**
 * Estimate the rendered height (px) of wrapped text.
 * cpl = chars that fit per line; lines respects explicit "\n"; height = lines·fontSize·lh.
 */
export function estTextHeight(text: string, fontSize: number, widthPx: number, lh = 1.3, font?: string, weight?: unknown, letterSpacingPx = 0): number {
  // Counts the lines the RENDERER will actually produce, by calling the same
  // wrapper it does. This used to be its own arithmetic — `seg.length` charged
  // at a flat advance, divided by chars-per-line — which was wrong twice over:
  // it treated a full-width CJK glyph as half a character, and it assumed
  // perfect packing, so it under-counted whenever a token could not break where
  // the division wanted. An estimator that disagrees with the renderer is how
  // diagnose_design came to report "No problems" about text rendering off the
  // canvas.
  // A bundled face measures by its real widths — the renderer's own measure (utils/font-widths).
  const lines = wrapToWidth(text, Math.max(1, widthPx), fontSize, emMeasure(font, weight, fontSize, letterSpacingPx) ?? advanceRatio(font)).length;
  return Math.ceil(Math.max(1, lines) * fontSize * lh);
}


interface TextMetrics { estH: number; declaredH: number; lines: number; fontSize: number; lineH: number; }

/** Per-layer wrapper: reads a text layer's content + style and returns metrics, or null. */
export function measureTextLayer(l: Layer): TextMetrics | null {
  if (l.type !== 'text') return null;
  const text = layerText(l).trim();
  if (!text) return null;

  const style = (l as { style?: { font_size?: unknown; line_height?: unknown; font_family?: unknown; font_weight?: unknown; letter_spacing?: unknown; text_transform?: unknown } }).style ?? {};
  const fontSize = typeof style.font_size === 'number' ? style.font_size : 16;
  const lh = typeof style.line_height === 'number' && style.line_height > 0 ? style.line_height : 1.3;
  const font = typeof style.font_family === 'string' ? style.font_family : undefined;

  const p = (l as { pos?: unknown }).pos;
  const width = Array.isArray(p) && typeof p[2] === 'number' ? p[2]
    : typeof (l as { width?: unknown }).width === 'number' ? (l as { width: number }).width : 0;
  const declaredH = Array.isArray(p) && typeof p[3] === 'number' ? p[3]
    : typeof (l as { height?: unknown }).height === 'number' ? (l as { height: number }).height : 0;
  if (width <= 0) return null;

  // A bundled face measures the capitals it will draw; otherwise UPPERCASE
  // renders ~12% wider → fewer chars per line, so the effective width shrinks.
  const known = emMeasure(font, style.font_weight, fontSize) !== null;
  const upper = style.text_transform === 'uppercase';
  const measured = known && upper ? text.toUpperCase() : text;
  const transformed = upper && !known ? width / 1.12 : width;
  const tracking = typeof style.letter_spacing === 'number' ? style.letter_spacing : 0;
  // Counted exactly as the renderer wraps — a word too wide for its box IS
  // broken there ("40%" drew as "40" over "%" into the line below; benchmark r4).
  // A word within the measure's error of its box stays whole in both (text-width.ts).
  const estH = estTextHeight(measured, fontSize, transformed, lh, font, style.font_weight, tracking);
  const lines = Math.max(1, Math.round(estH / (fontSize * lh)));
  return { estH, declaredH, lines, fontSize, lineH: fontSize * lh };
}

export interface TextOverflow {
  id: string;
  fontSize: number;
  lines: number;
  estH: number;
  declaredH: number;
  spill: number;        // px the rendered text spills past its declared box
  collides: string[];   // ids of layers sitting in the spill band
  outOf?: string;       // the shape the text sits on, when the spill runs past its edge
  offBottom: boolean;   // spill runs past the canvas bottom
}

interface XYWH { x: number; y: number; w: number; h: number }
function geom(l: Layer): XYWH | null {
  const p = (l as { pos?: unknown }).pos;
  let x: unknown, y: unknown, w: unknown, h: unknown;
  if (Array.isArray(p) && p.length >= 4) { [x, y, w, h] = p; }
  else { x = l.x; y = l.y; w = l.width; h = l.height; }
  if ([x, y, w, h].some(v => typeof v !== 'number')) return null;
  return { x: x as number, y: y as number, w: w as number, h: h as number };
}

/**
 * Find text layers whose rendered height materially exceeds their declared box
 * (so the text wraps and spills past it). For each, list the layers sitting in
 * the spill band — the ones it visually collides with. The keystone check a
 * vision-less model needs: declared boxes don't overlap, but the WRAPPED text
 * does. `tol` = how much overflow to tolerate before flagging (1.3 = 30%).
 */
/** True when `outer` covers ≥80% of `inner` and is the larger of the two. */
function holds(outer: XYWH, inner: XYWH): boolean {
  const ox = Math.max(0, Math.min(outer.x + outer.w, inner.x + inner.w) - Math.max(outer.x, inner.x));
  const oy = Math.max(0, Math.min(outer.y + outer.h, inner.y + inner.h) - Math.max(outer.y, inner.y));
  return outer.w * outer.h > inner.w * inner.h && ox * oy >= 0.8 * inner.w * inner.h;
}

export function findTextOverflows(layers: Layer[], canvasH: number, tol = 1.3): TextOverflow[] {
  const out: TextOverflow[] = [];
  for (const l of layers) {
    const m = measureTextLayer(l);
    if (!m || m.declaredH <= 0) continue;
    if (m.estH <= m.declaredH * tol) continue;
    // Spilling means wrapping to MORE LINES than the box holds. A one-line label
    // in a box trimmed to its cap height draws exactly where it was put; judged
    // by height alone, every preset kicker read as overflowing once group
    // children were measured (a sweep of 323 designs: 227 findings, most of them
    // one-line). A box ¾ of a line tall still holds that line.
    if (m.lines <= Math.max(1, Math.floor(m.declaredH / m.lineH + 0.25))) continue;
    const b = geom(l);
    if (!b) continue;
    const bandTop = b.y + b.h;
    const bandBottom = b.y + m.estH;
    const collides: string[] = [];
    let outOf: { id: string; area: number } | undefined;
    for (const o of layers) {
      if (o.id === l.id) continue;
      const ob = geom(o);
      if (!ob) continue;
      const hOverlap = ob.x < b.x + b.w && ob.x + ob.w > b.x;
      const vInBand = ob.y < bandBottom && ob.y + ob.h > bandTop;
      // skip a full-canvas background sitting underneath
      const isBg = ob.w * ob.h >= b.w * canvasH * 0.85 && ob.x <= 2 && ob.y <= 2;
      if (isBg) continue;
      // A shape holding the text's box is its GROUND (a card, a panel, a band) —
      // not something below it. What matters there is the spill leaving it.
      if (holds(ob, b)) {
        const area = ob.w * ob.h;
        if (bandBottom > ob.y + ob.h + 2 && (!outOf || area < outOf.area)) outOf = { id: o.id, area };
        continue;
      }
      if (hOverlap && vInBand) collides.push(o.id);
    }
    out.push({
      id: l.id, fontSize: m.fontSize, lines: m.lines, estH: m.estH, declaredH: m.declaredH,
      spill: Math.round(m.estH - m.declaredH), collides, ...(outOf ? { outOf: outOf.id } : {}),
      offBottom: bandBottom > canvasH + 8,
    });
  }
  return out;
}
