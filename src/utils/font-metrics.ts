// Real per-glyph advance widths, read from the bundled TTFs.
//
// docs/MOTION.md §5: "per-character/word reveal needs the text layer split into
// spans". Splitting means the engine has to place each piece itself, and the
// existing measurement heuristic (one average advance for every glyph) is fine
// for "is this box too short" and useless here: it puts "iii" and "WWW" at the
// same width, so a per-character reveal would visibly drift apart.
//
// The fonts are already on disk for resvg, so read the numbers rather than
// guess them. Four tables is all it takes: head for unitsPerEm, hhea for the
// metric count, hmtx for the advances, cmap for character → glyph.
import * as fs from 'fs';
import * as path from 'path';

export interface FontMetrics {
  unitsPerEm: number;
  /** Advance width in font units for a code point, or undefined if unmapped. */
  advance(cp: number): number | undefined;
}

interface Tables { [tag: string]: { off: number; len: number } }

function readTables(buf: Buffer): Tables | null {
  if (buf.length < 12) return null;
  // A TTC (font collection) points at its first font; everything else is a
  // plain sfnt whose directory starts at byte 0.
  let base = 0;
  if (buf.toString('ascii', 0, 4) === 'ttcf') base = buf.readUInt32BE(12);
  if (base + 12 > buf.length) return null;
  const numTables = buf.readUInt16BE(base + 4);
  const out: Tables = {};
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    if (rec + 16 > buf.length) return null;
    out[buf.toString('ascii', rec, rec + 4)] = { off: buf.readUInt32BE(rec + 8), len: buf.readUInt32BE(rec + 12) };
  }
  return out;
}

/** cmap format 4 — the Basic Multilingual Plane, which covers every character
 *  a design's copy realistically uses. Other formats fall back to undefined. */
function readCmap(buf: Buffer, off: number): Map<number, number> | null {
  const map = new Map<number, number>();
  if (off + 4 > buf.length) return null;
  const n = buf.readUInt16BE(off + 2);
  let sub = -1;
  for (let i = 0; i < n; i++) {
    const rec = off + 4 + i * 8;
    if (rec + 8 > buf.length) return null;
    const platform = buf.readUInt16BE(rec), encoding = buf.readUInt16BE(rec + 2);
    // Windows/BMP first, then Unicode; both are format 4 in practice.
    if ((platform === 3 && (encoding === 1 || encoding === 0)) || platform === 0) sub = off + buf.readUInt32BE(rec + 4);
    if (platform === 3 && encoding === 1) break;
  }
  if (sub < 0 || sub + 14 > buf.length || buf.readUInt16BE(sub) !== 4) return null;

  const segX2 = buf.readUInt16BE(sub + 6);
  const seg = segX2 >> 1;
  const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
  if (ranges + segX2 > buf.length) return null;
  for (let s = 0; s < seg; s++) {
    const end = buf.readUInt16BE(ends + s * 2);
    const start = buf.readUInt16BE(starts + s * 2);
    if (start > end || start === 0xffff) continue;
    const delta = buf.readInt16BE(deltas + s * 2);
    const rangeOff = buf.readUInt16BE(ranges + s * 2);
    for (let cp = start; cp <= end && cp - start < 0x10000; cp++) {
      let gid: number;
      if (rangeOff === 0) gid = (cp + delta) & 0xffff;
      else {
        const gi = ranges + s * 2 + rangeOff + (cp - start) * 2;
        if (gi + 2 > buf.length) continue;
        const g = buf.readUInt16BE(gi);
        gid = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (gid) map.set(cp, gid);
    }
  }
  return map;
}

/** Parse just enough of a font file to answer "how wide is this character". */
export function parseFontMetrics(buf: Buffer): FontMetrics | null {
  const t = readTables(buf);
  if (!t?.['head'] || !t['hhea'] || !t['hmtx'] || !t['cmap']) return null;
  const head = t['head'].off, hhea = t['hhea'].off, hmtx = t['hmtx'].off;
  if (head + 20 > buf.length || hhea + 36 > buf.length) return null;

  const unitsPerEm = buf.readUInt16BE(head + 18) || 1000;
  const numH = buf.readUInt16BE(hhea + 34);
  if (numH === 0) return null;
  const cmap = readCmap(buf, t['cmap'].off);
  if (!cmap) return null;

  const advanceOf = (gid: number): number | undefined => {
    const i = Math.min(gid, numH - 1);
    const at = hmtx + i * 4;
    return at + 2 <= buf.length ? buf.readUInt16BE(at) : undefined;
  };
  return {
    unitsPerEm,
    advance: (cp: number): number | undefined => {
      const gid = cmap.get(cp);
      return gid === undefined ? undefined : advanceOf(gid);
    },
  };
}

const CACHE = new Map<string, FontMetrics | null>();

/** Metrics for a family, searched across the given font directories. */
export function metricsForFamily(family: string, dirs: string[]): FontMetrics | null {
  const key = `${family}::${dirs.join('|')}`;
  const hit = CACHE.get(key);
  if (hit !== undefined) return hit;

  const want = family.toLowerCase().replace(/[^a-z0-9]/g, '');
  let found: FontMetrics | null = null;
  for (const dir of dirs) {
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { continue; }
    // Prefer a Regular/upright face: an Italic or Bold file answers with
    // different advances and would place every glyph slightly wrong.
    const cands = names
      .filter(n => /\.(ttf|otf)$/i.test(n))
      .filter(n => n.toLowerCase().replace(/[^a-z0-9]/g, '').includes(want))
      .sort((a, b) => Number(/italic|oblique/i.test(a)) - Number(/italic|oblique/i.test(b)));
    for (const n of cands) {
      try {
        const m = parseFontMetrics(fs.readFileSync(path.join(dir, n)));
        if (m) { found = m; break; }
      } catch { /* unreadable — try the next candidate */ }
    }
    if (found) break;
  }
  CACHE.set(key, found);
  return found;
}

interface SegmenterLike { segment(s: string): Iterable<{ segment: string }> }

/**
 * Split into GRAPHEME CLUSTERS — what a reader calls a character.
 *
 * `[...text]` iterates code points, which is not the same thing and breaks on
 * everything interesting: a decomposed "é" is e + a combining acute, so the
 * accent became a layer of its own with nothing to sit on; the family emoji
 * 👨‍👩‍👧 is three people joined by two zero-width joiners, so it shattered into
 * three separate figures plus two invisible layers; a 🇬🇧 flag is two regional
 * indicators, so it came out as two letter-blocks. Intl.Segmenter knows the
 * real rules; the code-point fallback only runs where it is unavailable.
 */
export function graphemes(text: string): string[] {
  const S = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => SegmenterLike }).Segmenter;
  if (S) {
    try {
      return [...new S(undefined, { granularity: 'grapheme' }).segment(text)].map(s => s.segment);
    } catch { /* fall through to code points */ }
  }
  return [...text];
}

/**
 * Cumulative x offsets for each grapheme, in px, plus the total width.
 *
 * A cluster's advance is the sum of its code points' advances — exact for the
 * ordinary one-code-point case, and the right approximation for a cluster the
 * font draws as one glyph.
 *
 * Falls back to a uniform ratio when the family has no readable metrics — the
 * caller is told which happened, because "the reveal drifts" and "the font is
 * not bundled" are the same symptom and only one is a bug.
 */
export function charOffsets(
  text: string, fontSize: number, m: FontMetrics | null, fallbackRatio = 0.54,
  letterSpacing = 0,
): { offsets: number[]; total: number; exact: boolean; units: string[] } {
  const units = graphemes(text);
  const offsets: number[] = [];
  let x = 0;
  let exact = m !== null;
  for (const g of units) {
    offsets.push(x);
    for (const ch of g) {
      const cp = ch.codePointAt(0);
      const adv = m && cp !== undefined ? m.advance(cp) : undefined;
      if (adv === undefined) { exact = false; x += fontSize * fallbackRatio; }
      else x += (adv / (m as FontMetrics).unitsPerEm) * fontSize;
    }
    // Tracking advances the pen after every glyph, exactly as the renderer does.
    // Leaving it out made a split headline land progressively LEFT of where the
    // unsplit one drew — and the engine adds ~0.06em to every ALL-CAPS text by
    // itself, so the drift hit the commonest thing anyone splits. Measured on a
    // 96px "MEASURE TWICE": the run came out 71px short over 634px.
    x += letterSpacing;
  }
  return { offsets, total: x, exact, units };
}

/**
 * Tracking in px. Accepts the number the schema stores, and the `em`/`px`
 * strings a model reaches for.
 */
export function letterSpacingPx(v: unknown, fontSize: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const s = v.trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  if (s.endsWith('em')) return n * fontSize;
  if (s.endsWith('%')) return (n / 100) * fontSize;
  return n;                                     // bare number or "…px"
}
