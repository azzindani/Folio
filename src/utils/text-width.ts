// How wide is a run of text, in multiples of the font size?
//
// Two places need this answer and they must agree: the RENDERER wraps lines
// with it (layer-renderers-shared.wrapPlainText) and the ENGINE estimates how
// tall a wrapped block will be with it (engine/text-measure.estTextHeight,
// which is also what diagnose_design uses to flag a box that is too short).
// When they disagree the engine cheerfully reports "No problems" about text
// that renders off the canvas.
//
// Both used to count `string.length` — UTF-16 code units — and assume every one
// of them is ~0.52 em wide. That is roughly true for Latin and wrong in two
// directions everywhere else:
//
//   CJK    a Han glyph is FULL width (~1 em), so 66 of them were measured as
//          if they were 34. Live on an 800px canvas: the engine shrank the
//          model's declared 120px box to 84px, the text rendered as ONE
//          unwrapped line clipped at the canvas edge, and diagnose_design
//          reported zero errors and zero warnings.
//   emoji  one glyph is 2+ code units, so an emoji counted double.
//
// Iterating code POINTS (for…of) fixes the second; a width class fixes the
// first. This stays a heuristic — the goal is "reliably flag a box that is way
// too short", not pixel metrics — but a heuristic that is 2x wrong on an entire
// writing system is not a heuristic, it is a blind spot.

/** Default advance for narrow (Latin/Cyrillic/Greek) glyphs, in em. */
export const NARROW_EM = 0.52;

/** Advance for full-width glyphs, in em. */
export const WIDE_EM = 1;

// Ranges that render full-width in every font that carries them: CJK ideographs
// and radicals, Hiragana/Katakana, Hangul, CJK punctuation, and the fullwidth
// forms block. Deliberately does NOT include Arabic/Hebrew/Devanagari — those
// are narrow-to-normal and the Latin default is a fair estimate for them.
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/;

/** Does this character render at full width? */
export function isWideChar(ch: string): boolean {
  return WIDE.test(ch);
}

/**
 * Width of `text` in multiples of the font size.
 *
 * `narrowEm` lets a caller widen the default for runs it already knows are
 * wider than plain sans — monospace, ALL-CAPS, letter-spaced text.
 */
export function textEms(text: string, narrowEm: number = NARROW_EM): number {
  let ems = 0;
  // for…of iterates code POINTS, so an astral emoji counts once, not twice.
  for (const ch of text) ems += isWideChar(ch) ? WIDE_EM : narrowEm;
  return ems;
}

/** Width of `text` in px at `fontSize`. */
export function textWidthPx(text: string, fontSize: number, narrowEm: number = NARROW_EM): number {
  return textEms(text, narrowEm) * fontSize;
}

/** True when a run contains anything the narrow default would misjudge — used
 *  to keep the pure-Latin path byte-identical to what it produced before. */
export function hasWideChars(text: string): boolean {
  for (const ch of text) if (isWideChar(ch)) return true;
  return false;
}

/**
 * Break `text` into lines that fit `maxWidthPx`.
 *
 * THE one implementation. The renderer used to wrap with one rule and the
 * engine's height estimator approximated it with another (total width divided
 * by line width, which assumes perfect packing and therefore under-counts every
 * time a token cannot be split where the arithmetic wants). Two rules that
 * merely agree on average is how the engine came to bless a design whose text
 * ran off the canvas — so they share this instead of resembling each other.
 *
 * Breaking mid-token is a last resort, for a run that cannot fit on any line:
 * a CJK paragraph (no spaces at all) or a long URL.
 */
export function wrapToWidth(text: string, maxWidthPx: number, fontSize: number, narrowEm: number = NARROW_EM): string[] {
  const lines: string[] = [];
  const width = (s: string): number => textWidthPx(s, fontSize, narrowEm);

  const breakToken = (token: string): string => {
    let chunk = '';
    for (const ch of token) {
      if (chunk && width(chunk + ch) > maxWidthPx) { lines.push(chunk); chunk = ch; }
      else chunk += ch;
    }
    return chunk;
  };

  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(' ')) {
      const candidate = cur ? cur + ' ' + word : word;
      if (width(candidate) <= maxWidthPx) { cur = candidate; continue; }
      if (cur) { lines.push(cur); cur = ''; }
      cur = width(word) <= maxWidthPx ? word : breakToken(word);
    }
    lines.push(cur);
  }
  return lines;
}
