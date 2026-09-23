// Generate src/utils/font-widths.json — how wide each bundled face really is.
//
// The renderer wraps text on the server AND in the browser editor, where the
// TTFs cannot be read, so it guessed: every glyph 0.52 em, capitals 0.58. Real
// faces run from Bebas Neue capitals at 0.39 em to Archivo Black's at 0.77, and
// a space is ~0.2–0.28 em, not 0.52. So "Nori & Broth" in Caveat wrapped in a
// box it fits by 130 px (one-shot benchmark r3).
//
// Per family: five class averages per weight (lowercase by English letter
// frequency, capitals, digits, space, punctuation) and ONE letter shape — each
// of A–Z a–z 0–9 and common punctuation relative to its class average at the base weight — so "DRIFT"
// is measured with its narrow I, not as five average capitals (16% too wide,
// and the word broke mid-token). Packed as base-36 pairs to fit the editor bundle.
//
// Run: npm run gen:widths   (bun; re-run after adding fonts)
import * as fs from 'fs';
import * as path from 'path';
import { parseFontMetrics, type FontMetrics } from '../src/utils/font-metrics';

const dir = path.resolve(import.meta.dir, '../src/mcp/fonts');
const out = path.resolve(import.meta.dir, '../src/utils/font-widths.json');
const LOWER = 'abcdefghijklmnopqrstuvwxyz', UPPER = LOWER.toUpperCase(), DIGITS = '0123456789';
const FREQ = [8.2, 1.5, 2.8, 4.3, 12.7, 2.2, 2.0, 6.1, 7.0, 0.15, 0.77, 4.0, 2.4, 6.7, 7.5, 1.9, 0.095, 6.0, 6.3, 9.1, 2.8, 0.98, 2.4, 0.15, 2.0, 0.074];
const PUNCT = '.,:;!?\'"-()&/’‘“”–—…•·';
// The symbols copy leans on, a class of their own: "40%" measured every % at the
// punctuation average (~0.3 em for a ~0.8 em glyph), so a sale's headline drew
// 30 px past its box into the words beside it (one-shot benchmark r4) — and a
// bold face widens its dots and commas far more than its %, so the two classes
// cannot share one weight scaling.
const SYMS = '%$€£¥@#*+=<>[]~_|×';
/** A glyph's shape is stored as its width relative to its class average, times this (src/utils/font-widths.ts reads it back). */
const SHAPE_SCALE = 400;
/** Two base-36 digits: 0 … 1295. */
const pack = (v: number): string => Math.max(0, Math.min(1295, Math.round(v))).toString(36).padStart(2, '0');

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { files?: Record<string, string[]> };
const familyOf = (file: string): string | undefined =>
  Object.entries(manifest.files ?? {}).find(([, files]) => files.includes(file))?.[0];

function classes(m: FontMetrics): number[] {
  const em = (c: string): number => (m.advance(c.codePointAt(0) ?? 0) ?? 0) / m.unitsPerEm;
  // Averaged over the glyphs the face HAS — a missing one would pull the class toward zero.
  const mean = (s: string): number => { const e = [...s].map(em).filter(v => v > 0); return e.length ? e.reduce((a, v) => a + v, 0) / e.length : 0; };
  let lower = 0, sum = 0;
  LOWER.split('').forEach((c, i) => { lower += em(c) * (FREQ[i] ?? 0); sum += FREQ[i] ?? 0; });
  return [lower / sum, mean(UPPER), mean(DIGITS), em(' '), mean(PUNCT), mean(SYMS)];
}

const faces = new Map<string, Array<{ weight: number; m: FontMetrics }>>();
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.ttf') && !/italic/i.test(f)).sort()) {
  const family = familyOf(file), m = parseFontMetrics(fs.readFileSync(path.join(dir, file)));
  if (!family || !m) continue;
  const key = family.toLowerCase().replace(/\s+/g, '');
  faces.set(key, [...(faces.get(key) ?? []), { weight: m.weight, m }]);
}

const table: Record<string, { s: string; w: Record<string, string> }> = {};
for (const [key, list] of faces) {
  // The shape comes from the face nearest Regular — the weights scale it by class.
  const base = [...list].sort((a, b) => Math.abs(a.weight - 400) - Math.abs(b.weight - 400))[0];
  if (!base) continue;
  const c = classes(base.m);
  const em = (ch: string): number => (base.m.advance(ch.codePointAt(0) ?? 0) ?? 0) / base.m.unitsPerEm;
  // A glyph the face lacks is drawn by a fallback face; the class average stands in for it.
  // ×SHAPE_SCALE: up to 3.24× the class average — Anton's % and Oswald's em dash passed 2.59 (×500).
  const rel = (s: string, avg: number): string => [...s].map(ch => pack(avg > 0 && em(ch) > 0 ? (em(ch) / avg) * SHAPE_SCALE : SHAPE_SCALE)).join('');
  const w: Record<string, string> = {};
  for (const f of list) w[String(f.weight)] = classes(f.m).map(v => pack(v * 1000)).join('');
  table[key] = { s: rel(UPPER, c[1] ?? 0) + rel(LOWER, c[0] ?? 0) + rel(DIGITS, c[2] ?? 0) + rel(PUNCT, c[4] ?? 0) + rel(SYMS, c[5] ?? 0), w };
}
fs.writeFileSync(out, JSON.stringify(table) + '\n');
process.stdout.write(`font-widths: ${Object.keys(table).length} families, ${fs.statSync(out).size} bytes\n`);
