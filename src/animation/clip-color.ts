// A clip's grade — exposure, contrast, saturation, temperature, tint — as one
// piece of arithmetic every renderer applies the same way.
//
// The grade is a 3×3 colour matrix (white balance and exposure as channel
// gains, saturation about Rec. 709 luma) followed by a straight line about mid
// grey (contrast), all on sRGB values. ffmpeg runs it as colorchannelmixer +
// lutrgb in the decode graph, so graded footage stays on the pixel path; the
// editor runs the same numbers as an SVG feColorMatrix + feComponentTransfer in
// sRGB. A LUT (.cube) is applied after, by ffmpeg only.

import type { Layer } from '../schema/types';

export interface ClipColor { exposure?: number; contrast?: number; saturation?: number; temperature?: number; tint?: number; lut?: string }
const RANGES: Record<Exclude<keyof ClipColor, 'lut'>, [number, number]> = {
  exposure: [-3, 3], contrast: [-1, 1], saturation: [-1, 1], temperature: [-1, 1], tint: [-1, 1],
};
const LUMA = [0.2126, 0.7152, 0.0722];

/** The clip's grade, or null when it has none. */
export function colorOf(l: Layer): ClipColor | null {
  const raw = (l as Layer & { video?: { color?: unknown } }).video?.color;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>, out: ClipColor = {};
  for (const k of Object.keys(RANGES) as Array<keyof typeof RANGES>) {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) out[k] = Math.max(RANGES[k][0], Math.min(RANGES[k][1], v));
  }
  if (typeof r['lut'] === 'string' && r['lut'].trim()) out.lut = r['lut'].trim();
  return Object.keys(out).length ? out : null;
}

/** The grade's colour matrix, rows = output R, G, B: gains (exposure, temperature, tint) after saturation. */
export function colorMatrix(c: ClipColor): number[][] {
  const s = 1 + (c.saturation ?? 0), t = c.temperature ?? 0, tint = c.tint ?? 0, e = 2 ** (c.exposure ?? 0);
  const gain = [e * (1 + 0.25 * t), e * (1 - 0.2 * tint), e * (1 - 0.25 * t)];
  return [0, 1, 2].map(row => [0, 1, 2].map(col => (gain[row] ?? 1) * ((1 - s) * (LUMA[col] ?? 0) + (row === col ? s : 0))));
}

/** Contrast as a line on 0–1 values: out = slope · in + intercept, pivoting on mid grey. */
export function contrastLine(c: ClipColor): { slope: number; intercept: number } {
  const k = 1 + (c.contrast ?? 0);
  return { slope: k, intercept: 0.5 * (1 - k) };
}

const n = (v: number): string => (+v.toFixed(5)).toString();

/** The grade as ffmpeg filters (before the frame is turned to RGBA); `lutFile` is the resolved .cube when there is one. */
export function colorFilter(c: ClipColor, lutFile?: string | null): string {
  const m = colorMatrix(c), { slope, intercept } = contrastLine(c);
  const names = ['r', 'g', 'b'];
  const mix = m.flatMap((row, i) => row.map((v, j) => `${names[i]}${names[j]}=${n(v)}`)).join(':');
  const parts = [`colorchannelmixer=${mix}`];
  // lutrgb clips each result to 0–255 itself.
  const off = intercept * 255, line = `val*${n(slope)}${off < 0 ? '-' : '+'}${n(Math.abs(off))}`;
  if (slope !== 1) parts.push(`lutrgb=r='${line}':g='${line}':b='${line}'`);
  if (lutFile) parts.push(`lut3d=file='${lutFile.replace(/'/g, "\\'")}'`);
  return parts.join(',');
}

/** The grade as an SVG <filter> (sRGB) for the editor's <video>, after `first` (a key's primitive, animation/clip-key.ts). The LUT is not shown there. */
export function colorSvgFilter(id: string, c: ClipColor | null, first = ''): string {
  let grade = '';
  if (c && (c.exposure || c.contrast || c.saturation || c.temperature || c.tint)) {
    const m = colorMatrix(c), { slope, intercept } = contrastLine(c);
    const values = m.map(row => `${row.map(n).join(' ')} 0 0`).join(' ') + ' 0 0 0 1 0';
    const line = `type="linear" slope="${n(slope)}" intercept="${n(intercept)}"`;
    grade = `<feColorMatrix type="matrix" values="${values}"/><feComponentTransfer><feFuncR ${line}/><feFuncG ${line}/><feFuncB ${line}/></feComponentTransfer>`;
  }
  return first || grade ? `<filter id="${id}" color-interpolation-filters="sRGB">${first}${grade}</filter>` : '';
}

/** A grade as asked for through op:video, checked. The reason as a string when unusable; null clears. */
export function readColor(raw: unknown): ClipColor | null | string {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return 'color must be {exposure?, contrast?, saturation?, temperature?, tint?, lut?}.';
  const r = raw as Record<string, unknown>;
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const v = r[k];
    if (v !== undefined && !(typeof v === 'number' && v >= lo && v <= hi)) return `color.${k} must be ${lo}–${hi}.`;
  }
  if (r['lut'] !== undefined && (typeof r['lut'] !== 'string' || !/\.cube$/i.test(r['lut']))) return 'color.lut must be a stored .cube file ("assets/docs/look.cube").';
  const unknown = Object.keys(r).filter(k => !(k in RANGES) && k !== 'lut');
  if (unknown.length) return `color has no ${unknown.join(', ')} — use exposure, contrast, saturation, temperature, tint, lut.`;
  return colorOf({ id: 'x', type: 'video', video: { color: r } } as unknown as Layer) ?? {};
}
