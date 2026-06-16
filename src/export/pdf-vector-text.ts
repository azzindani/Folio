// Shared SVG → PDF vector-text extraction.
//
// A PDF that embeds a PNG is selectable-text-free and blurs on zoom. To make a
// PDF whose text is real (copy/paste), crisp, and infinitely zoomable, we draw
// the visible TEXT as vector glyphs and let a high-DPI raster carry only the
// backgrounds/gradients/effects behind it. This module is the renderer-agnostic
// half: it walks a rendered SVG and returns the positioned text runs that can
// be drawn losslessly as vector, plus the elements to delete before rasterizing
// (so text isn't painted twice). It uses only generic DOM reads, so it runs in
// the browser AND under jsdom (the MCP server).
//
// Conservative by design: anything that can't be placed exactly as vector
// (gradient-filled text, rotated/flipped text, curved textPath, inline rich
// runs that need glyph-advance measurement) is left OUT — those elements stay
// in the raster, so the PDF is never WORSE than the all-raster baseline.

export interface VectorTextRun {
  text: string;
  /** x in SVG user units; interpreted per `anchor`. */
  x: number;
  /** Baseline y in SVG user units. */
  baseline: number;
  fontSize: number;
  /** First font-family token, unquoted (e.g. "Inter"). */
  family: string;
  weight: number;
  italic: boolean;
  anchor: 'start' | 'middle' | 'end';
  /** Solid fill as [r,g,b], 0–255. */
  color: [number, number, number];
  /** Letter spacing in user units (0 when none). */
  letterSpacing: number;
}

/** One vectorizable `<text>` element resolved to its (1+) line runs. */
export interface VectorTextCandidate {
  el: Element;
  runs: VectorTextRun[];
}

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
  blue: [0, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128],
};

/** Parse a solid CSS color to [r,g,b], or null if it isn't a solid color we can map. */
export function parseSolidColor(raw: string | null): [number, number, number] | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v || v === 'none' || v === 'transparent' || v === 'currentcolor' || v.startsWith('url(')) return null;
  if (v in NAMED) return NAMED[v];
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) {
    const h = m[1];
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) {
    const h = m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/.exec(v);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  return null;
}

function num(v: string | null, dflt: number): number {
  if (v == null) return dflt;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}

function firstFamily(raw: string | null): string {
  if (!raw) return 'sans-serif';
  return raw.split(',')[0].trim().replace(/^['"]|['"]$/g, '') || 'sans-serif';
}

/** True if `el` or any ancestor up to (and including) the svg root carries a
 *  property that would make vector text diverge from the rendered raster —
 *  transform (rotate/flip), sub-1 opacity, a filter (shadow/glow), or a
 *  clip-path. Such text is left in the raster (still crisp at high DPI) so the
 *  PDF never looks worse than what the editor shows. */
function hasUnsupportedAncestry(el: Element): boolean {
  let node: Element | null = el;
  while (node) {
    if (node.getAttribute('transform')) return true;
    if (node.getAttribute('filter')) return true;
    if (node.getAttribute('clip-path')) return true;
    const op = node.getAttribute('opacity');
    if (op != null && parseFloat(op) < 1) return true;
    if (node.getAttribute('display') === 'none') return true;
    if (node.tagName.toLowerCase() === 'svg') break;
    node = node.parentElement;
  }
  return false;
}

function anchorOf(v: string | null): 'start' | 'middle' | 'end' {
  return v === 'middle' || v === 'end' ? v : 'start';
}

/** Resolve a single `<text>` element to line runs, or null if not vectorizable. */
function candidateFor(textEl: Element): VectorTextCandidate | null {
  // Curved text along a path — can't place as straight runs.
  if (textEl.querySelector('textPath')) return null;
  if (hasUnsupportedAncestry(textEl)) return null;

  const color = parseSolidColor(textEl.getAttribute('fill'));
  if (!color) return null; // gradient / pattern / unknown fill → leave to raster

  const x = num(textEl.getAttribute('x'), 0);
  const y = num(textEl.getAttribute('y'), 0);
  const fontSize = num(textEl.getAttribute('font-size'), 16);
  const weight = num(textEl.getAttribute('font-weight'), 400);
  const family = firstFamily(textEl.getAttribute('font-family'));
  const italic = textEl.getAttribute('font-style') === 'italic';
  const anchor = anchorOf(textEl.getAttribute('text-anchor'));
  const letterSpacing = num((textEl.getAttribute('letter-spacing') ?? '').replace('px', ''), 0);
  const base: Omit<VectorTextRun, 'text' | 'x' | 'baseline'> = {
    fontSize, family, weight, italic, anchor, color, letterSpacing,
  };

  const tspans = Array.from(textEl.children).filter(c => c.tagName.toLowerCase() === 'tspan');

  if (tspans.length === 0) {
    const text = textEl.textContent ?? '';
    if (!text.trim()) return null;
    return { el: textEl, runs: [{ ...base, text, x, baseline: y }] };
  }

  // Only the multi-line plain shape is safe: every tspan resets x and steps the
  // baseline via dy. Inline rich runs (tspans without their own x) would need
  // glyph-advance measurement to place — skip them (raster keeps them crisp).
  if (!tspans.every(t => t.getAttribute('x') != null)) return null;

  const runs: VectorTextRun[] = [];
  let baseline = y;
  for (const t of tspans) {
    baseline += num(t.getAttribute('dy'), 0);
    const text = t.textContent ?? '';
    if (!text.trim()) continue;
    runs.push({ ...base, text, x: num(t.getAttribute('x'), x), baseline });
  }
  return runs.length ? { el: textEl, runs } : null;
}

/**
 * Collect every vectorizable `<text>` element in the SVG, resolved to its line
 * runs. The caller draws the runs as PDF text and removes `el` from a clone of
 * the SVG before rasterizing the rest, so nothing is painted twice.
 */
export function extractVectorTextCandidates(svg: Element): VectorTextCandidate[] {
  const out: VectorTextCandidate[] = [];
  for (const textEl of Array.from(svg.querySelectorAll('text'))) {
    const c = candidateFor(textEl);
    if (c) out.push(c);
  }
  return out;
}
