// Green screen — a key colour taken out of a clip, as one line of arithmetic
// both renderers run.
//
// How strongly a pixel leans toward the key colour, away from grey, is a dot
// product with the key's own direction (grey scores 0, the key itself 1). The
// alpha falls along a straight line over that score: opaque below the soft
// edge, clear above `similarity`. Being linear in R, G and B it is an alpha row
// of ffmpeg's colorchannelmixer and of the editor's SVG feColorMatrix —
// the same line, so what the editor shows is what the export cuts out.

import type { Layer } from '../schema/types';

export interface ClipKey { color: string; similarity: number; blend: number }
export const DEFAULT_KEY: Omit<ClipKey, 'color'> = { similarity: 0.4, blend: 0.1 };

const hexRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1] ?? '0', 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
};

/** The clip's key, or null when it has none (or its colour is grey — nothing to lean toward). */
export function keyOf(l: Layer): ClipKey | null {
  const raw = (l as Layer & { video?: { key?: unknown } }).video?.key;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['color'] !== 'string' || !hexRgb(r['color'])) return null;
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
  const k = { color: r['color'], similarity: num(r['similarity'], DEFAULT_KEY.similarity), blend: num(r['blend'], DEFAULT_KEY.blend) };
  return keyAlphaRow(k) ? k : null;
}

/** The key's score line: score = w·RGB (the key colour 1, grey 0); alpha = (hi − score) / span, clipped to 0–1. */
function keyLine(k: ClipKey): { w: number[]; hi: number; span: number } | null {
  const c = hexRgb(k.color);
  if (!c) return null;
  const mean = (c[0] + c[1] + c[2]) / 3;
  const d = c.map(v => v - mean);
  const len2 = d.reduce((s, v) => s + v * v, 0);
  if (len2 < 1e-4) return null;
  const hi = 1 - k.similarity;
  return { w: d.map(v => v / len2), hi, span: Math.max(0.01, k.blend) };
}

/** The alpha row [r, g, b, a]: alpha = r·R + g·G + b·B + a·A on 0–1 values (A, the frame's own alpha, is 1 for footage and carries the constant). */
export function keyAlphaRow(k: ClipKey): [number, number, number, number] | null {
  const line = keyLine(k);
  if (!line) return null;
  const { w, hi, span } = line;
  return [-(w[0] ?? 0) / span, -(w[1] ?? 0) / span, -(w[2] ?? 0) / span, hi / span];
}

const n = (v: number): string => (+v.toFixed(5)).toString();
/** Where swscale puts 8-bit white in 16 bits (255·256 + 3, not 65535); the key's weights undo it. */
const WHITE16 = 65283;

/**
 * The key as ffmpeg filters, run on the source before any grade. colorchannelmixer's
 * gains stop at ±2, so the score goes into a 16-bit alpha first, squeezed to 0–1
 * (its range is ±P, P the sum of the positive weights), and a lookup on alpha then
 * stretches it to the soft edge — the same line, without 8-bit banding in the edge.
 */
export function keyFilter(k: ClipKey): string {
  const line = keyLine(k);
  if (!line) return '';
  const { w, hi, span } = line;
  const p = w.reduce((s, v) => s + Math.max(0, v), 0);
  const [r, g, b] = w.map(v => n((v / (2 * p)) * (65535 / WHITE16)));
  const slope = (-2 * p) / span, off = (65535 * (hi + p)) / span;
  return `format=rgba64le,colorchannelmixer=ar=${r}:ag=${g}:ab=${b}:aa=0.5,lut=a='val*${n(slope)}+${n(off)}',format=rgba`;
}

/** The key as an SVG feColorMatrix (sRGB): colours untouched, alpha from the row. */
export function keySvgPrimitive(k: ClipKey): string {
  const row = keyAlphaRow(k);
  if (!row) return '';
  return `<feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 ${row.map(n).join(' ')} 0"/>`;
}

/** A key as asked for through op:video, checked. The reason as a string when unusable; null clears. */
export function readKey(raw: unknown): ClipKey | null | string {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return 'key must be {color: "#00ff00", similarity?: 0–1, blend?: 0–1}.';
  const r = raw as Record<string, unknown>;
  if (typeof r['color'] !== 'string' || !hexRgb(r['color'])) return 'key.color must be a #rrggbb hex — the screen colour to take out.';
  for (const f of ['similarity', 'blend'] as const) {
    const v = r[f];
    if (v !== undefined && !(typeof v === 'number' && v >= 0 && v <= 1)) return `key.${f} must be 0–1.`;
  }
  const k = keyOf({ id: 'x', type: 'video', video: { key: r } } as unknown as Layer);
  return k ?? 'key.color is grey — a key needs a colour that leans away from grey (a green or blue screen).';
}
