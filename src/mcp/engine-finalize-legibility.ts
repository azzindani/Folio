// Folio MCP engine — legibility rescue. Split from engine-finalize-text.ts to stay
// under the 700-line budget. Re-lights text that renders near-invisible on the
// backdrop it actually sits on (the dominant canvas wash OR a local band/card/badge).
import type { Layer, ThemeSpec } from '../schema/types';
import { resolveToken } from '../engine/token-resolver';
import { layerBBox, layerText, isLocked } from './engine-finalize-geom';

// ── Invisible text rescue ───────────────────────────────────
// A vision-less model regularly ships text whose color is near-invisible on its
// background: a nested style.color left at a theme default (#1A1A1A) over a black
// poster bg, or pale labels (#E0E0FF) on cream. design-lint only NOTES this; the
// model can't see the note's effect, so the design ships broken/blank-looking.
// This rescues legibility WITHOUT discarding intent: when the effective color is
// near-invisible we first try the layer's own flat top-level `color` (the value
// the model usually MEANT — a blood-red title, white body — that a nested style
// default overrode); only if that is ALSO invisible do we force a neutral matched
// to the backdrop. 2.5 sits below WCAG AA-large (3.0), so legitimately-styled
// muted text is untouched while dark-on-dark / pale-on-pale (which render
// unreadable) are rescued. (#222 on #0A0A0A ≈ 2.05 → caught; #555 ≈ 4.3 → left.)
const MIN_TEXT_CR = 2.5;

function hexLum(hex: string): number | null {
  const h = (hex || '').replace('#', '');
  if (h.length < 6 || /[^0-9a-fA-F]/.test(h.slice(0, 6))) return null;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function crRatio(a: string, b: string): number | null {
  const la = hexLum(a), lb = hexLum(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
// All layers + descendants, flattened (references preserved so in-place edits stick).
function flattenLayers(layers: Layer[]): Layer[] {
  const out: Layer[] = [];
  const walk = (ls: Layer[]): void => {
    for (const l of ls) {
      if (isLocked(l)) continue;   // authored subtree — exempt from re-lighting
      out.push(l);
      const kids = (l as unknown as Record<string, unknown>)['layers'];
      if (Array.isArray(kids)) walk(kids as Layer[]);
    }
  };
  walk(layers);
  return out;
}
// Resolve a color that may be a theme token ($text/$accent/…) to a concrete hex,
// so the contrast math can see what actually renders. Returns null when it can't
// be evaluated (a token with no theme, or a non-hex value) → caller leaves it be.
function resolveCol(c: string | undefined, theme: ThemeSpec | undefined): string | null {
  if (!c) return null;
  const hex = c.startsWith('$') ? (theme ? resolveToken(c, { theme }) : null) : c;
  if (!hex || hexLum(hex) === null) return null;
  return hex;
}
// Average a set of hexes channel-wise → one representative hex (for a gradient
// backdrop, whose effective tone for contrast is the blend of its stops).
function avgHex(hexes: string[]): string | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (const h of hexes) {
    const s = h.replace('#', '');
    if (s.length < 6 || /[^0-9a-fA-F]/.test(s.slice(0, 6))) continue;
    r += parseInt(s.slice(0, 2), 16); g += parseInt(s.slice(2, 4), 16); b += parseInt(s.slice(4, 6), 16); n++;
  }
  if (!n) return null;
  const hx = (v: number): string => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}
// A rect's effective backdrop hex: a solid `fill.color`, a `color`-only fill, a
// theme token, OR — crucially — the averaged stops of a GRADIENT fill (linear/
// radial/conic). Without the gradient case, a full-canvas gradient bg reads as
// "no backdrop" → the pass falls back to the (often light) theme bg and wrongly
// darkens pale text that actually sits on a dark gradient (the HALON canvas bug).
function rectFillHex(o: Record<string, unknown>, theme: ThemeSpec | undefined): string | null {
  const f = o['fill'];
  if (f && typeof f === 'object' && !Array.isArray(f)) {
    const fo = f as Record<string, unknown>;
    if (typeof fo['color'] === 'string') return resolveCol(fo['color'], theme);
    const stops = fo['stops'];
    if (Array.isArray(stops) && stops.length) {
      const hexes = stops
        .map(s => (s && typeof s === 'object' ? resolveCol((s as Record<string, unknown>)['color'] as string | undefined, theme) : null))
        .filter((h): h is string => !!h);
      if (hexes.length) return avgHex(hexes);
    }
  }
  if (typeof o['color'] === 'string') return resolveCol(o['color'] as string, theme);
  return null;
}
// Dominant full-canvas background color — tolerates a rect that carries its fill
// under `color` (the same shorthand the renderer now honors) or a theme token,
// picking the lowest-z near-full-canvas rect so a foreground panel can't be
// mistaken for the backdrop. Falls back to the theme's own background/surface so a
// theme-only canvas (no bg rect) can still be checked.
function backdropColor(flat: Layer[], docW: number, docH: number, theme: ThemeSpec | undefined): string | null {
  let best: { z: number; color: string } | null = null;
  for (const l of flat) {
    if (l.type !== 'rect') continue;
    const b = layerBBox(l);
    if (!(b.x <= docW * 0.03 && b.y <= docH * 0.03 && (b.r - b.x) >= docW * 0.94 && (b.b - b.y) >= docH * 0.94)) continue;
    const o = l as unknown as Record<string, unknown>;
    const c = rectFillHex(o, theme);
    if (!c) continue;
    const z = typeof o['z'] === 'number' ? o['z'] as number : 0;
    if (!best || z < best.z) best = { z, color: c };
  }
  if (best) return best.color;
  const themeBg = theme?.colors?.background ?? theme?.colors?.surface;
  return typeof themeBg === 'string' && hexLum(themeBg) !== null ? themeBg : null;
}

// Paint-order rank — higher paints later (on top). z dominates; document order
// breaks ties (matches the renderer's stable z-then-order paint).
function paintRank(o: Record<string, unknown>, idx: number): number {
  const z = typeof o['z'] === 'number' ? (o['z'] as number) : 0;
  return z * 1e6 + idx;
}
const BACKDROP_SHAPES = new Set(['rect', 'ellipse', 'circle', 'polygon', 'path']);
// The LOCAL backdrop a text actually sits on: the opaque shape painted directly
// behind it (highest paint-rank below the text) whose box substantially covers it —
// a hero band, a card, a badge — NOT the dominant canvas wash. Without this, a
// legible white knockout on a dark band over a LIGHT page reads as "white on light
// → invisible" and gets wrongly darkened (and dark-on-light-card over a dark page
// the reverse). Returns null when nothing local covers the text → caller uses the
// dominant backdrop. ≥60% area coverage so a text mostly off its panel still falls
// back to the dominant wash.
function localBackdropHex(
  textRank: number,
  tb: { x: number; y: number; r: number; b: number },
  shapes: { rank: number; box: { x: number; y: number; r: number; b: number }; hex: string }[],
): string | null {
  const tArea = Math.max(1, (tb.r - tb.x) * (tb.b - tb.y));
  let best: { rank: number; hex: string } | null = null;
  for (const s of shapes) {
    if (s.rank >= textRank) continue;                          // not behind the text
    const ox = Math.min(tb.r, s.box.r) - Math.max(tb.x, s.box.x);
    const oy = Math.min(tb.b, s.box.b) - Math.max(tb.y, s.box.y);
    if (ox <= 0 || oy <= 0 || ox * oy < tArea * 0.6) continue; // doesn't substantially cover it
    if (!best || s.rank > best.rank) best = { rank: s.rank, hex: s.hex };
  }
  return best ? best.hex : null;
}

// Re-light an invisible color WITHOUT discarding its hue: darken it (light backdrop)
// or lighten it (dark backdrop) until it clears a comfortable contrast margin, so a
// deliberately muted palette (terracotta eyebrow, sage label) stays terracotta/sage
// instead of being nuked to black. A near-neutral (greyscale) color has no hue worth
// keeping — and a saturated one that can't reach the target even at full black/white
// — fall back to a backdrop-matched neutral. 3.0 = WCAG AA-large.
const RELIGHT_TARGET_CR = 3.0;
function relight(hex: string, bgHex: string, bgLum: number): string {
  const neutral = bgLum < 0.5 ? '#FAFAFA' : '#141414';
  const h = hex.replace('#', '');
  if (h.length < 6) return neutral;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 40) return neutral;   // greyscale → no hue to keep
  const darken = bgLum >= 0.5;                                      // light bg → darken the hue
  for (let t = 0.15; t <= 1.0001; t += 0.15) {
    const nr = darken ? Math.round(r * (1 - t)) : Math.round(r + (255 - r) * t);
    const ng = darken ? Math.round(g * (1 - t)) : Math.round(g + (255 - g) * t);
    const nb = darken ? Math.round(b * (1 - t)) : Math.round(b + (255 - b) * t);
    const cand = `#${[nr, ng, nb].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    const cr = crRatio(cand, bgHex);
    if (cr !== null && cr >= RELIGHT_TARGET_CR) return cand;
  }
  return neutral;
}

export function fixInvisibleText(layers: Layer[], docW: number, docH: number, theme?: ThemeSpec): number {
  const flat = flattenLayers(layers);
  const bg = backdropColor(flat, docW, docH, theme);
  if (!bg) return 0;               // unknown (theme-only) backdrop → don't guess
  const bgLum = hexLum(bg);
  if (bgLum === null) return 0;
  // Opaque shape backdrops (≥0.85 opacity, resolvable fill) ranked by paint order,
  // so each text is judged against the panel/band/badge it actually sits on — not
  // just the dominant wash. A translucent panel isn't a solid ground, so it's left
  // out and the text falls through to whatever opaque layer shows behind it.
  const shapes: { rank: number; box: { x: number; y: number; r: number; b: number }; hex: string }[] = [];
  flat.forEach((l, i) => {
    if (!BACKDROP_SHAPES.has(l.type as string)) return;
    const o = l as unknown as Record<string, unknown>;
    const op = typeof o['opacity'] === 'number' ? (o['opacity'] as number) : 1;
    if (op < 0.85) return;
    const hex = rectFillHex(o, theme);
    if (!hex) return;
    shapes.push({ rank: paintRank(o, i), box: layerBBox(l), hex });
  });
  let fixed = 0;
  flat.forEach((l, ti) => {
    if (l.type !== 'text' || !layerText(l).trim()) return;
    const o = l as unknown as Record<string, unknown>;
    const st = (o['style'] as Record<string, unknown>) ?? {};
    const flatCol = typeof o['color'] === 'string' ? o['color'] as string : undefined;
    const eff = typeof st['color'] === 'string' ? st['color'] as string : flatCol;
    const effHex = resolveCol(eff, theme);
    if (!effHex) return;            // unevaluable (unknown token) → leave it
    // Judge against the LOCAL backdrop the text sits on, else the dominant wash.
    const local = localBackdropHex(paintRank(o, ti), layerBBox(l), shapes);
    const bd = local ?? bg;
    const bdLum = local ? hexLum(local) : bgLum;
    if (bdLum === null) return;
    const cr = crRatio(effHex, bd);
    if (cr === null || cr >= MIN_TEXT_CR) return;   // already legible on its real backdrop
    // 1. Prefer the model's own flat color when IT is legible (recovers intent).
    let next: string | null = null;
    if (flatCol && flatCol !== eff) {
      const flatHex = resolveCol(flatCol, theme);
      const fcr = flatHex ? crRatio(flatHex, bd) : null;
      if (fcr !== null && fcr >= MIN_TEXT_CR) next = flatCol;  // keep original (may be a token)
    }
    // 2. Else re-light the model's OWN color — keep its hue, push the lightness
    //    until legible (a backdrop-matched neutral only when it's greyscale).
    if (!next) next = relight(effHex, bd, bdLum);
    o['style'] = { ...st, color: next };
    fixed++;
  });
  return fixed;
}
