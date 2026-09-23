/**
 * Where a layer's transforms pivot, measured the way the CSS route measures it.
 *
 * The animated SVG plays rotate/scale/skew as CSS with `transform-box: fill-box`
 * and a transform-origin from the track's anchor, so they pivot on the box of
 * what the layer actually DRAWS — a headline's glyphs, not its 920px text box.
 * A sampled frame has no CSS: it applies the same transform as an SVG transform
 * attribute, and needs the same box to pivot on, or a pop on a left-aligned
 * title swells from the middle of empty space in the GIF and from the words in
 * the SVG.
 */

import type { Layer } from '../schema/types';
import type { AnchorPoint } from '../animation/types';
import { plainTextLayout, drawnLetterSpacing } from '../renderer/layer-renderers-shared';
import { flattenPath } from '../animation/motion-path';
import { metricsForFamily, charOffsets, numericWeight } from '../utils/font-metrics';
import { bundledFontsDir } from '../utils/bundled-fonts-dir';

export interface Box { x: number; y: number; width: number; height: number }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function boundsOf(points: Array<{ x: number; y: number }>): Box | null {
  if (points.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function union(boxes: Array<Box | null>): Box | null {
  const real = boxes.filter((b): b is Box => b !== null);
  return boundsOf(real.flatMap(b => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height }]));
}

/**
 * Width of one drawn line: real advances from the bundled font when there is
 * one, the layout estimate otherwise. The flat estimate put "Wipe it in."
 * (Archivo 800, 120px) at 686px against ~530px of ink, so a wipe had uncovered
 * the whole word by its halfway frame. The advances are the asked weight's own
 * (one static file per weight), so an ExtraBold line measures as wide as it draws.
 */
function lineInk(line: string, estimate: number, style: Record<string, unknown>, fontSize: number): number {
  const family = String(style['font_family'] ?? 'Inter').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const dir = bundledFontsDir();
  const m = dir ? metricsForFamily(family, [dir], numericWeight(style['font_weight'])) : null;
  if (!m) return estimate;
  const spacing = typeof style['letter_spacing'] === 'number' ? style['letter_spacing'] : 0;
  const run = charOffsets(line, fontSize, m, 0.54, spacing);
  // Spacing follows the last glyph too, but that gap draws no ink.
  return run.exact ? Math.max(0, run.total - spacing) : estimate;
}

/** A text of nothing but quote marks, whose ink sits high in the line. */
const HIGH_MARKS = /^["'“”‘’«»‹›„‟]+$/;

/** Glyphs that fall below the baseline in most faces. */
const DESCENDS = /[gjpqyQJ,;()[\]{}|/@$§µ]/;

/** The box of what a text layer draws: widest wrapped line × its lines. */
function textBox(o: Record<string, unknown>): Box | null {
  const content = o['content'] as { type?: unknown; value?: unknown } | undefined;
  if (!content || (content.type !== undefined && content.type !== 'plain') || typeof content.value !== 'string') return null;
  const style = (o['style'] ?? {}) as Record<string, unknown>;
  const layout = plainTextLayout(content.value, style as never, o as never);
  // The wrap is the renderer's own; only each line's width is measured — at the
  // spacing it DRAWS with, animated tracking included. Measured without it, a
  // reveal wipe sized to this box let a tracked-out title's first letter show
  // before the wipe began (benchmark r6, b21).
  const extra = drawnLetterSpacing(style as never, o as { tracking_offset?: number }) - (typeof style['letter_spacing'] === 'number' ? style['letter_spacing'] : 0);
  const spaced = extra ? { ...style, letter_spacing: drawnLetterSpacing(style as never, o as { tracking_offset?: number }) } : style;
  const widest = Math.max(0, ...layout.lines.map((l, i) =>
    lineInk(l, (layout.lineWidths[i] ?? 0) + extra * Math.max(0, [...l].length - 1), spaced, layout.fontSize)));
  const left = layout.anchor === 'middle' ? layout.textX - widest / 2 : layout.anchor === 'end' ? layout.textX - widest : layout.textX;
  // First baseline sits at textY; glyphs rise ~0.8em above it. Below the last
  // baseline they fall ~0.2em only when that line HAS a descender — caps and
  // digits stop at the baseline. Counting the band anyway made a 400px "24"
  // reach 80px into the "HOURS" set tight under it, and the motion lint called
  // two lines that never touch an overlap (one-shot benchmark r1).
  // Quote marks alone — an oversized hanging “ — ink only the top of the line:
  // measured as a full letter, a 260 px mark floored the quote under it and the
  // rescue pushed the quote 113 px off its layout (benchmark r6, b24).
  if (layout.lines.length === 1 && HIGH_MARKS.test(content.value.trim())) {
    return { x: left, y: layout.textY - layout.fontSize * 0.78, width: widest, height: layout.fontSize * 0.42 };
  }
  const top = layout.textY - layout.fontSize * 0.8;
  const last = layout.lines[layout.lines.length - 1] ?? '';
  const below = DESCENDS.test(last) ? 0.2 : 0.02;
  return { x: left, y: top, width: widest, height: (layout.lines.length - 1) * layout.lineH + layout.fontSize * (0.8 + below) };
}

/**
 * Where a left-set text's letters start, in canvas px: its text origin plus the
 * smallest left side bearing among its lines' first letters. A 300 px numeral
 * starts its ink ~12 px inside its box and a 32 px kicker ~2 px, so boxes set
 * on one x do not line up to the eye — the edge lines are aligned on is the
 * ink's (benchmark r6, b22). Null when it cannot be known: not plain text, not
 * set left, or no metrics for the face.
 */
export function inkLeft(layer: Layer): number | null {
  const o = layer as unknown as Record<string, unknown>;
  const content = o['content'] as { type?: unknown; value?: unknown } | undefined;
  if (o['type'] !== 'text' || !content || (content.type !== undefined && content.type !== 'plain') || typeof content.value !== 'string') return null;
  const style = (o['style'] ?? {}) as Record<string, unknown>;
  const layout = plainTextLayout(content.value, style as never, o as never);
  if (layout.anchor !== 'start') return null;
  const family = String(style['font_family'] ?? 'Inter').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const dir = bundledFontsDir();
  const m = dir ? metricsForFamily(family, [dir], numericWeight(style['font_weight'])) : null;
  if (!m?.lsb) return null;
  const bearings = layout.lines.map(line => {
    const first = line.codePointAt(0);
    const b = first === undefined ? undefined : m.lsb?.(first);
    return b === undefined ? Infinity : (b / m.unitsPerEm) * layout.fontSize;
  });
  const least = Math.min(...bearings);
  return Number.isFinite(least) ? layout.textX + least : null;
}

/** The box a layer draws, in canvas coordinates, or null when it cannot be known. */
export function drawnBox(layer: Layer): Box | null {
  const o = layer as unknown as Record<string, unknown>;
  const declared = (): Box | null => {
    const w = num(o['width']), h = num(o['height']);
    return w !== undefined && h !== undefined ? { x: num(o['x']) ?? 0, y: num(o['y']) ?? 0, width: w, height: h } : null;
  };
  switch (o['type']) {
    case 'line':
      return boundsOf([{ x: num(o['x1']) ?? 0, y: num(o['y1']) ?? 0 }, { x: num(o['x2']) ?? 0, y: num(o['y2']) ?? 0 }]);
    case 'circle':
    case 'ellipse': {
      const d = declared();
      const rx = num(o['rx']) ?? (d ? d.width / 2 : undefined), ry = num(o['ry']) ?? (d ? d.height / 2 : undefined);
      const cx = num(o['cx']) ?? (d ? d.x + d.width / 2 : undefined), cy = num(o['cy']) ?? (d ? d.y + d.height / 2 : undefined);
      return rx !== undefined && ry !== undefined && cx !== undefined && cy !== undefined
        ? { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 } : null;
    }
    case 'path':
    case 'polyline':
      return (typeof o['d'] === 'string' ? boundsOf(flattenPath(o['d']) ?? []) : null) ?? declared();
    case 'polygon': {
      const n = typeof o['points'] === 'string' ? (o['points'].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number) : [];
      const pts = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
      return boundsOf(pts) ?? declared();
    }
    case 'text':
      return textBox(o) ?? declared();
    case 'group':
      return declared() ?? union(((o['layers'] as Layer[] | undefined) ?? []).map(drawnBox));
    default:
      return declared();
  }
}

/** The pivot for an anchor, on a box — the same fractions as keyframe-css's transform-origin. */
export function anchorPoint(b: Box, anchor?: AnchorPoint): { x: number; y: number } {
  const a = anchor ?? 'center';
  const fx = a.includes('left') ? 0 : a.includes('right') ? 1 : 0.5;
  const fy = a.includes('top') ? 0 : a.includes('bottom') ? 1 : 0.5;
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}
