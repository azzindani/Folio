import type { PatternFill, PatternName } from '../schema/types';
import { createSVGElement, uniqueDefId } from './svg-utils';

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
};

/** Render a PatternFill into a tiling <pattern> def; returns `url(#id)`. */
export function renderPattern(fill: PatternFill, defs: SVGDefsElement): string {
  const name: PatternName = (BASE_TILE[fill.pattern] ? fill.pattern : 'dots');
  const scale = fill.scale && fill.scale > 0 ? fill.scale : 1;
  const weight = fill.weight && fill.weight > 0 ? fill.weight : 1;
  const t = Math.max(2, Math.round((BASE_TILE[name] ?? 24) * scale));
  const id = uniqueDefId('pat');
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
  defs.appendChild(pattern);
  return `url(#${id})`;
}
