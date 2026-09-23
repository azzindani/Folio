// How wide a run of text is in a BUNDLED face, from what
// scripts/gen-font-widths.ts reads out of the TTFs (font-widths.json).
//
// The renderer wraps text in the browser editor too, where the font files
// cannot be read — so it guessed one width for every face. Per family the table
// carries five class averages per weight (lowercase, capitals, digits, space,
// punctuation) and one letter shape (A–Z a–z 0–9 relative to their class), so
// a line lands within a few percent of the real face and a single word keeps
// its narrow I. A family not in the table keeps the old guess.
import { isWideChar, WIDE_EM } from './text-width';

/** A face's widths: [lower, upper, digit, space, punctuation] in em, and each letter's shape. */
export interface WidthClasses { classes: readonly number[]; shape: ReadonlyMap<string, number> }

// Loaded as its own chunk and awaited at module load: the editor's main entry
// stays under its size gate while every caller still measures synchronously.
const TABLE = (await import('./font-widths.json')).default as Record<string, { s: string; w: Record<string, string> }>;
/** The glyphs the shape covers, in the generator's order (PUNCT last). */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' + '.,:;!?\'"-()&/';
const unpack = (s: string): number[] => (s.match(/.{2}/g) ?? []).map(p => parseInt(p, 36));
const shapes = new Map<string, ReadonlyMap<string, number>>();

function shapeOf(key: string, packed: string): ReadonlyMap<string, number> {
  let m = shapes.get(key);
  if (!m) {
    const v = unpack(packed);
    m = new Map([...LETTERS].map((ch, i) => [ch, (v[i] ?? 500) / 500]));
    shapes.set(key, m);
  }
  return m;
}

/** The face's widths for a CSS-ish family (first of a list, any case/spacing) at the nearest bundled weight. */
export function widthClasses(family: unknown, weight?: unknown): WidthClasses | null {
  if (typeof family !== 'string') return null;
  const key = (family.split(',')[0] ?? '').replace(/["']/g, '').replace(/\s+/g, '').toLowerCase();
  const row = TABLE[key];
  if (!row) return null;
  const want = typeof weight === 'number' ? weight : weight === 'bold' ? 700 : Number(weight) || 400;
  let best: string | null = null, gap = Infinity;
  for (const [w, packed] of Object.entries(row.w)) {
    const d = Math.abs(Number(w) - want);
    if (d < gap) { gap = d; best = packed; }
  }
  return best ? { classes: unpack(best).map(v => v / 1000), shape: shapeOf(key, row.s) } : null;
}

/** Width of `text` in em for a face: letters and digits by their shape, the rest by class, full-width glyphs at WIDE_EM. */
export function classEms(c: WidthClasses, text: string): number {
  const [lower = 0.5, upper = 0.6, digit = 0.55, space = 0.25, other = 0.3] = c.classes;
  let em = 0;
  for (const ch of text) {
    const rel = c.shape.get(ch);
    if (isWideChar(ch)) em += WIDE_EM;
    else if (ch === ' ') em += space;
    else if (ch >= '0' && ch <= '9') em += digit * (rel ?? 1);
    else if (ch.toLowerCase() !== ch.toUpperCase()) em += (ch === ch.toUpperCase() ? upper : lower) * (rel ?? 1);
    else em += other * (rel ?? 1);
  }
  return em;
}

/** A string → em measure for a bundled face (letter-spacing in px included), or null for an unknown one. */
export function emMeasure(family: unknown, weight: unknown, fontSize: number, letterSpacingPx = 0): ((s: string) => number) | null {
  const c = widthClasses(family, weight);
  if (!c) return null;
  const track = fontSize > 0 ? Math.max(0, letterSpacingPx) / fontSize : 0;
  return (s: string): number => classEms(c, s) + track * [...s].length;
}
