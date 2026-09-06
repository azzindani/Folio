// Shared text-measurement heuristic — the ONE place the engine estimates how
// tall a wrapped text layer renders. Used by the layout presets (to stack
// blocks) AND by diagnose_design (to catch a box that's too short, so the text
// spills past it and collides with whatever sits below). A vision-less model
// can't see wrapping; this gives it the number it's missing.
//
// Deliberately font-agnostic and slightly generous: the goal is to reliably
// flag "this box is way too short", not pixel-perfect metrics. Pure — no I/O.

import type { Layer } from '../../schema/types';
import { wrapToWidth } from '../../utils/text-width';

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
export function estTextHeight(text: string, fontSize: number, widthPx: number, lh = 1.3, font?: string): number {
  // Counts the lines the RENDERER will actually produce, by calling the same
  // wrapper it does. This used to be its own arithmetic — `seg.length` charged
  // at a flat advance, divided by chars-per-line — which was wrong twice over:
  // it treated a full-width CJK glyph as half a character, and it assumed
  // perfect packing, so it under-counted whenever a token could not break where
  // the division wanted. An estimator that disagrees with the renderer is how
  // diagnose_design came to report "No problems" about text rendering off the
  // canvas.
  const lines = wrapToWidth(text, Math.max(1, widthPx), fontSize, advanceRatio(font)).length;
  return Math.ceil(Math.max(1, lines) * fontSize * lh);
}

interface TextMetrics { estH: number; declaredH: number; lines: number; fontSize: number; }

/** Per-layer wrapper: reads a text layer's content + style and returns metrics, or null. */
export function measureTextLayer(l: Layer): TextMetrics | null {
  if (l.type !== 'text') return null;
  const value = (l as { content?: { value?: unknown } }).content?.value;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;

  const style = (l as { style?: { font_size?: unknown; line_height?: unknown; font_family?: unknown; text_transform?: unknown } }).style ?? {};
  const fontSize = typeof style.font_size === 'number' ? style.font_size : 16;
  const lh = typeof style.line_height === 'number' && style.line_height > 0 ? style.line_height : 1.3;
  const font = typeof style.font_family === 'string' ? style.font_family : undefined;

  const p = (l as { pos?: unknown }).pos;
  const width = Array.isArray(p) && typeof p[2] === 'number' ? p[2]
    : typeof (l as { width?: unknown }).width === 'number' ? (l as { width: number }).width : 0;
  const declaredH = Array.isArray(p) && typeof p[3] === 'number' ? p[3]
    : typeof (l as { height?: unknown }).height === 'number' ? (l as { height: number }).height : 0;
  if (width <= 0) return null;

  // UPPERCASE renders ~12% wider → fewer chars per line. Widen by shrinking the effective width.
  const transformed = style.text_transform === 'uppercase' ? width / 1.12 : width;
  const estH = estTextHeight(text, fontSize, transformed, lh, font);
  const lines = Math.max(1, Math.round(estH / (fontSize * lh)));
  return { estH, declaredH, lines, fontSize };
}

export interface TextOverflow {
  id: string;
  fontSize: number;
  lines: number;
  estH: number;
  declaredH: number;
  spill: number;        // px the rendered text spills past its declared box
  collides: string[];   // ids of layers sitting in the spill band
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
export function findTextOverflows(layers: Layer[], canvasH: number, tol = 1.3): TextOverflow[] {
  const out: TextOverflow[] = [];
  for (const l of layers) {
    const m = measureTextLayer(l);
    if (!m || m.declaredH <= 0) continue;
    if (m.estH <= m.declaredH * tol) continue;
    const b = geom(l);
    if (!b) continue;
    const bandTop = b.y + b.h;
    const bandBottom = b.y + m.estH;
    const collides: string[] = [];
    for (const o of layers) {
      if (o.id === l.id) continue;
      const ob = geom(o);
      if (!ob) continue;
      const hOverlap = ob.x < b.x + b.w && ob.x + ob.w > b.x;
      const vInBand = ob.y < bandBottom && ob.y + ob.h > bandTop;
      // skip a full-canvas background sitting underneath
      const isBg = ob.w * ob.h >= b.w * canvasH * 0.85 && ob.x <= 2 && ob.y <= 2;
      if (hOverlap && vInBand && !isBg) collides.push(o.id);
    }
    out.push({
      id: l.id, fontSize: m.fontSize, lines: m.lines, estH: m.estH, declaredH: m.declaredH,
      spill: Math.round(m.estH - m.declaredH), collides,
      offBottom: bandBottom > canvasH + 8,
    });
  }
  return out;
}
