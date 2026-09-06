import type { PatternFill, PatternName } from '../schema/types';
import { createSVGElement, defIdFor, appendDefOnce } from './svg-utils';

// Generative tiled patterns. Each builder appends its tile content (in fg) to a
// <g>; the dispatcher wraps it in a seamless <pattern> (userSpaceOnUse) so the
// field tiles across the whole canvas and rasterizes in resvg (pure SVG, no JS).

interface TileCtx {
  /** Tile edge length, px (already scaled). */
  t: number;
  /** Foreground / mark color. */
  fg: string;
  /** Mark-weight multiplier. */
  w: number;
}

// Per-preset default tile size (px) before the user `scale` multiplier.
const BASE_TILE: Record<PatternName, number> = {
  dots: 30, dot_grid: 18, grid: 28, graph_paper: 88, isometric: 36,
  stripes: 16, diagonal_stripes: 22, crosshatch: 22, checkerboard: 32,
  chevron: 26, zigzag: 26, triangles: 28, waves: 32, scallop: 26,
  plus: 30, cross: 26, scatter: 72, confetti: 80, halftone: 18, blueprint: 80,
  carbon: 16, houndstooth: 32, brick: 36,
  newsprint: 9, riso: 40, engraving: 14, mezzotint: 26,
};

type Builder = (g: SVGElement, c: TileCtx) => void;

// ── per-element helpers (bake fg) ───────────────────────────
function path(g: SVGElement, d: string, fg: string, w: number, filled: boolean): void {
  g.appendChild(createSVGElement('path', {
    d, fill: filled ? fg : 'none', stroke: filled ? 'none' : fg,
    'stroke-width': filled ? undefined : Math.max(0.5, w),
    'stroke-linecap': 'square', 'stroke-linejoin': 'miter',
  }));
}
function circle(g: SVGElement, cx: number, cy: number, r: number, fg: string): void {
  g.appendChild(createSVGElement('circle', { cx, cy, r: Math.max(0.4, r), fill: fg }));
}
function rect(g: SVGElement, x: number, y: number, w: number, h: number, fg: string): void {
  g.appendChild(createSVGElement('rect', { x, y, width: w, height: h, fill: fg }));
}

// ── builders ────────────────────────────────────────────────
const BUILDERS: Record<PatternName, Builder> = {
  // Offset polka dots (two dots per tile → brick-offset rows).
  dots: (g, { t, fg, w }) => {
    circle(g, t * 0.25, t * 0.25, t * 0.13 * w, fg);
    circle(g, t * 0.75, t * 0.75, t * 0.13 * w, fg);
  },
  // Fine regular dot grid.
  dot_grid: (g, { t, fg, w }) => circle(g, t / 2, t / 2, t * 0.1 * w, fg),
  // Halftone — dense offset dots, larger radius.
  halftone: (g, { t, fg, w }) => {
    circle(g, t * 0.25, t * 0.25, t * 0.2 * w, fg);
    circle(g, t * 0.75, t * 0.75, t * 0.2 * w, fg);
  },
  // Thin square grid (lines on two edges; adjacent tiles complete it).
  grid: (g, { t, fg, w }) => path(g, `M0 0H${t}M0 0V${t}`, fg, w, false),
  // Engineering graph paper — minor grid + heavier major border.
  graph_paper: (g, { t, fg, w }) => {
    const s = t / 4;
    let d = '';
    for (let i = 1; i < 4; i++) d += `M${i * s} 0V${t}M0 ${i * s}H${t}`;
    path(g, d, fg, w * 0.5, false);
    path(g, `M0 0H${t}M0 0V${t}`, fg, w * 1.3, false);
  },
  // Isometric triangular grid (vertical + two 60° diagonals).
  isometric: (g, { t, fg, w }) => path(
    g, `M${t / 2} 0V${t}M0 ${t * 0.25}L${t} ${t * 0.75}M0 ${t * 0.75}L${t} ${t * 0.25}`, fg, w, false),
  // Horizontal stripes (filled half-tile band).
  stripes: (g, { t, fg }) => rect(g, 0, 0, t, t / 2, fg),
  // Diagonal band — anti-diagonal line tiles into continuous stripes.
  diagonal_stripes: (g, { t, fg, w }) => path(g, `M0 ${t}L${t} 0`, fg, t * 0.34 * w, false),
  // Crosshatch — both diagonals.
  crosshatch: (g, { t, fg, w }) => path(g, `M0 ${t}L${t} 0M0 0L${t} ${t}`, fg, w, false),
  // Checkerboard — two filled quarters on the diagonal.
  checkerboard: (g, { t, fg }) => { rect(g, 0, 0, t / 2, t / 2, fg); rect(g, t / 2, t / 2, t / 2, t / 2, fg); },
  // Stacked chevrons.
  chevron: (g, { t, fg, w }) => path(
    g, `M0 ${t * 0.5}L${t * 0.5} 0L${t} ${t * 0.5}M0 ${t}L${t * 0.5} ${t * 0.5}L${t} ${t}`, fg, w, false),
  // Zigzag line (tiles horizontally — endpoints share y).
  zigzag: (g, { t, fg, w }) => path(
    g, `M0 ${t * 0.25}L${t * 0.25} ${t * 0.75}L${t * 0.5} ${t * 0.25}L${t * 0.75} ${t * 0.75}L${t} ${t * 0.25}`, fg, w, false),
  // Up-triangle tiling (filled).
  triangles: (g, { t, fg }) => path(g, `M0 ${t}L${t / 2} 0L${t} ${t}Z`, fg, 1, true),
  // Smooth sine wave (quadratic + reflection).
  waves: (g, { t, fg, w }) => path(g, `M0 ${t * 0.5}Q${t * 0.25} 0 ${t * 0.5} ${t * 0.5}T${t} ${t * 0.5}`, fg, w, false),
  // Fish-scale scallops (semicircle arcs).
  scallop: (g, { t, fg, w }) => path(g, `M0 ${t}A${t / 2} ${t / 2} 0 0 1 ${t} ${t}`, fg, w, false),
  // Plus signs.
  plus: (g, { t, fg, w }) => {
    const b = t * 0.07 * w;
    rect(g, t / 2 - b, t * 0.2, b * 2, t * 0.6, fg);
    rect(g, t * 0.2, t / 2 - b, t * 0.6, b * 2, fg);
  },
  // Small cross ticks.
  cross: (g, { t, fg, w }) => path(
    g, `M${t * 0.5} ${t * 0.34}V${t * 0.66}M${t * 0.34} ${t * 0.5}H${t * 0.66}`, fg, w, false),
  // Running-bond brick wall.
  brick: (g, { t, fg, w }) => path(
    g, `M0 0H${t}M0 ${t / 2}H${t}M0 0V${t / 2}M${t / 2} ${t / 2}V${t}`, fg, w, false),
  // Carbon-fibre weave (offset filled blocks).
  carbon: (g, { t, fg }) => { rect(g, 0, 0, t / 2, t / 2, fg); rect(g, t / 2, t / 2, t / 2, t / 2, fg); },
  // Memphis-style scattered marks — fixed (deterministic) irregular layout.
  scatter: (g, { t, fg, w }) => {
    circle(g, t * 0.18, t * 0.22, t * 0.05 * w, fg);
    circle(g, t * 0.7, t * 0.62, t * 0.04 * w, fg);
    path(g, `M${t * 0.46} ${t * 0.16}L${t * 0.6} ${t * 0.3}`, fg, t * 0.03 * w, false);
    path(g, `M${t * 0.12} ${t * 0.72}L${t * 0.26} ${t * 0.72}`, fg, t * 0.03 * w, false);
    path(g, `M${t * 0.82} ${t * 0.18}l${t * 0.08} 0l${-t * 0.04} ${t * 0.07}Z`, fg, 1, true);
  },
  // Confetti — small rotated sticks at fixed positions.
  confetti: (g, { t, fg, w }) => {
    const stick = (x: number, y: number, a: number): void => {
      const dx = Math.cos(a) * t * 0.08, dy = Math.sin(a) * t * 0.08;
      path(g, `M${x - dx} ${y - dy}L${x + dx} ${y + dy}`, fg, t * 0.035 * w, false);
    };
    stick(t * 0.2, t * 0.25, 0.6); stick(t * 0.72, t * 0.3, -0.5);
    stick(t * 0.4, t * 0.7, 1.1); stick(t * 0.82, t * 0.78, 0.2);
    circle(g, t * 0.55, t * 0.5, t * 0.04 * w, fg);
  },
  // Blueprint — fine grid + heavier major lines (pair with a navy bg + light fg).
  blueprint: (g, { t, fg, w }) => {
    const s = t / 5;
    let d = '';
    for (let i = 1; i < 5; i++) d += `M${i * s} 0V${t}M0 ${i * s}H${t}`;
    path(g, d, fg, w * 0.45, false);
    path(g, `M0 0H${t}M0 0V${t}`, fg, w * 1.1, false);
  },
  // Houndstooth — checker base + triangular teeth (parametric approximation).
  houndstooth: (g, { t, fg }) => {
    const h = t / 2, q = t / 4;
    rect(g, 0, 0, h, h, fg);
    rect(g, h, h, h, h, fg);
    path(g, `M${h} 0l${q} 0l${-q} ${q}Z`, fg, 1, true);
    path(g, `M0 ${h}l0 ${q}l${q} ${-q}Z`, fg, 1, true);
    path(g, `M${h} ${h}l${h} 0l${-q} ${q}Z`, fg, 1, true);
    path(g, `M${h} ${h}l0 ${h}l${q} ${-q}Z`, fg, 1, true);
  },
  // ── Print finishes (WS4) — hand-printed grain, all deterministic ───────
  // Newsprint — very fine offset dot screen (tight tile) → newspaper halftone.
  newsprint: (g, { t, fg, w }) => {
    circle(g, t * 0.25, t * 0.25, t * 0.16 * w, fg);
    circle(g, t * 0.75, t * 0.75, t * 0.16 * w, fg);
  },
  // Riso — coarse risograph screen: bold, slightly irregular offset dots on a
  // big tile so the "spot-color print" texture reads at poster scale.
  riso: (g, { t, fg, w }) => {
    const d = (x: number, y: number, r: number): void => circle(g, t * x, t * y, t * r * w, fg);
    d(0.18, 0.20, 0.10); d(0.62, 0.14, 0.075); d(0.40, 0.46, 0.11);
    d(0.84, 0.52, 0.085); d(0.14, 0.72, 0.09); d(0.68, 0.80, 0.10);
    d(0.92, 0.90, 0.06); d(0.34, 0.90, 0.07);
  },
  // Engraving — fine parallel hairlines (banknote / etched shading). Horizontal
  // rules tile seamlessly top-to-bottom; hair-thin weight keeps it a texture.
  engraving: (g, { t, fg, w }) => {
    let d = '';
    for (let i = 0; i < 4; i++) { const y = (i + 0.5) * (t / 4); d += `M0 ${y}H${t}`; }
    path(g, d, fg, Math.max(0.4, t * 0.03 * w), false);
  },
  // Mezzotint — dense deterministic speckle (aquatint / stipple grain). Fixed
  // pseudo-scatter of tiny dots; edge-hugging marks are mirrored so tiles seam.
  mezzotint: (g, { t, fg, w }) => {
    const pts: Array<[number, number, number]> = [
      [0.06, 0.12, 0.030], [0.22, 0.05, 0.022], [0.38, 0.18, 0.028], [0.55, 0.09, 0.020],
      [0.72, 0.16, 0.032], [0.90, 0.07, 0.024], [0.12, 0.34, 0.026], [0.30, 0.40, 0.020],
      [0.48, 0.30, 0.030], [0.66, 0.44, 0.022], [0.84, 0.36, 0.028], [0.04, 0.58, 0.024],
      [0.24, 0.66, 0.032], [0.44, 0.56, 0.020], [0.62, 0.62, 0.028], [0.80, 0.70, 0.026],
      [0.96, 0.60, 0.022], [0.16, 0.88, 0.030], [0.36, 0.82, 0.024], [0.58, 0.92, 0.028],
      [0.76, 0.84, 0.020], [0.92, 0.94, 0.030],
    ];
    for (const [x, y, r] of pts) circle(g, t * x, t * y, t * r * w * 1.4, fg);
  },
};

/** Render a PatternFill into a tiling <pattern> def; returns `url(#id)`. */
export function renderPattern(fill: PatternFill, defs: SVGDefsElement): string {
  const name: PatternName = (BASE_TILE[fill.pattern] ? fill.pattern : 'dots');
  const scale = fill.scale && fill.scale > 0 ? fill.scale : 1;
  const weight = fill.weight && fill.weight > 0 ? fill.weight : 1;
  const t = Math.max(2, Math.round((BASE_TILE[name] ?? 24) * scale));
  const id = defIdFor('pat', fill);
  const pattern = createSVGElement('pattern', {
    id, patternUnits: 'userSpaceOnUse', width: t, height: t,
    patternTransform: fill.angle ? `rotate(${fill.angle})` : undefined,
  });
  if (fill.bg) rect(pattern, 0, 0, t, t, fill.bg);
  const g = createSVGElement('g', {
    opacity: fill.opacity !== undefined ? String(fill.opacity) : undefined,
  });
  (BUILDERS[name] ?? BUILDERS.dots)(g, { t, fg: fill.fg, w: weight });
  pattern.appendChild(g);
  appendDefOnce(defs, pattern);
  return `url(#${id})`;
}
