/**
 * A keyframe's easing as a curve you shape by hand.
 *
 * The picker offered thirty names and drew the one highlighted; a curve that
 * is none of them — a slow start with a hard landing, the particular overshoot
 * a logo needs — was only reachable by typing cubic-bezier(…) into the YAML.
 * Here the two control points of the travel to the next keyframe are handles:
 * drag one and the easing becomes `cubic-bezier(x1, y1, x2, y2)`, the string
 * the engine, the editor's CSS player and the exports already evaluate.
 *
 * Before a handle moves, the curve drawn is the easing as the engine samples it
 * (a bounce stays a bounce); the handles sit on its closest bezier — the CSS
 * the editor plays it with — so the first drag starts from what was there.
 */

import { parseCubicBezier, easingToCSS } from '../../animation/easing';
import { easingCurvePath } from './easing-curve';

export type Bezier = [number, number, number, number];

/** The CSS keywords easingToCSS hands back for the defaults, as their beziers. */
const KEYWORDS: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** How far above 1 and below 0 a handle may go — room for overshoot and anticipation. */
const Y_LO = -0.6, Y_HI = 1.6;

/** The bezier an easing is, or the closest one the editor plays it as (steps: linear). */
export function bezierFor(name: string): Bezier {
  const exact = parseCubicBezier(name);
  if (exact) return exact;
  const css = easingToCSS(name || undefined) ?? '';
  return parseCubicBezier(css) ?? KEYWORDS[css] ?? KEYWORDS['linear'] ?? [0, 0, 1, 1];
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** The plot's caption: a bezier as its four numbers (the full string is wider than the plot; the select names it), else the name. */
export const curveLabel = (name: string): string => /^cubic-bezier\((.*)\)$/i.exec(name.trim())?.[1] ?? (name || 'track default');

/** The easing string for a bezier: x kept in 0..1 (a curve must move forward in time), 2 decimals. */
export function bezierString(b: Bezier): string {
  const [x1, y1, x2, y2] = b;
  const x = (v: number): number => r2(Math.min(1, Math.max(0, v)));
  const y = (v: number): number => r2(Math.min(Y_HI, Math.max(Y_LO, v)));
  return `cubic-bezier(${x(x1)}, ${y(y1)}, ${x(x2)}, ${y(y2)})`;
}

/** The plot: a w×h svg whose unit square (time 0..1 × value 0..1) sits inside the Y_LO..Y_HI band. */
export interface CurveBox { w: number; h: number; pad: number }

/** A curve point (time, value) → svg px. */
export function toPlot(t: number, v: number, box: CurveBox): [number, number] {
  const iw = box.w - box.pad * 2, ih = box.h - box.pad * 2;
  return [box.pad + t * iw, box.pad + ((Y_HI - v) / (Y_HI - Y_LO)) * ih];
}

/** Svg px → a curve point, clamped to where a handle may go. */
export function fromPlot(x: number, y: number, box: CurveBox): [number, number] {
  const iw = box.w - box.pad * 2, ih = box.h - box.pad * 2;
  const t = (x - box.pad) / Math.max(1, iw);
  const v = Y_HI - ((y - box.pad) / Math.max(1, ih)) * (Y_HI - Y_LO);
  return [Math.min(1, Math.max(0, t)), Math.min(Y_HI, Math.max(Y_LO, v))];
}

/** The unit square's corners in px: [left, top(value 1), right, bottom(value 0)]. */
function square(box: CurveBox): [number, number, number, number] {
  const [x0, y0] = toPlot(0, 0, box), [x1, y1] = toPlot(1, 1, box);
  return [x0, y1, x1, y0];
}

/** The curve's path: the easing as the engine samples it, drawn into the unit square. */
function curveD(name: string, box: CurveBox): string {
  const [l, top, r, bottom] = square(box);
  const w = r - l, h = bottom - top;
  // easingCurvePath draws value 0..1 over 0..h from the bottom; shift it onto the square.
  return easingCurvePath(name, w, h, 64).replace(/([ML]) ([-\d.]+) ([-\d.]+)/g, (_, c: string, x: string, y: string) =>
    `${c} ${(Number(x) + l).toFixed(2)} ${(Number(y) + top).toFixed(2)}`);
}

/** The editor's svg: the unit square, the straight line for reference, the curve, and each handle on its arm. */
export function curveEditorSVG(name: string, b: Bezier, box: CurveBox): string {
  const [l, top, r, bottom] = square(box);
  const [p1x, p1y] = toPlot(b[0], b[1], box), [p2x, p2y] = toPlot(b[2], b[3], box);
  const muted = 'var(--color-text-muted, #8892a4)', border = 'var(--color-border, #2a2f37)', accent = 'var(--color-accent, #7C5CFF)';
  const handle = (n: 1 | 2, x: number, y: number): string =>
    `<circle class="tl-bez-h" data-h="${n}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${accent}" stroke="var(--color-bg, #111)" stroke-width="1.5" style="cursor:grab"/>`;
  return `<svg class="tl-bez" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}" xmlns="http://www.w3.org/2000/svg" style="display:block;touch-action:none">`
    + `<rect width="${box.w}" height="${box.h}" rx="3" fill="var(--color-surface-2, #1b1e24)"/>`
    + `<rect x="${l}" y="${top}" width="${r - l}" height="${bottom - top}" fill="none" stroke="${border}"/>`
    + `<line x1="${l}" y1="${bottom}" x2="${r}" y2="${top}" stroke="${border}" stroke-dasharray="3 3"/>`
    + `<path class="tl-bez-curve" d="${curveD(name, box)}" fill="none" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/>`
    + `<line class="tl-bez-arm" data-h="1" x1="${l}" y1="${bottom}" x2="${p1x.toFixed(1)}" y2="${p1y.toFixed(1)}" stroke="${muted}"/>`
    + `<line class="tl-bez-arm" data-h="2" x1="${r}" y1="${top}" x2="${p2x.toFixed(1)}" y2="${p2y.toFixed(1)}" stroke="${muted}"/>`
    + handle(1, p1x, p1y) + handle(2, p2x, p2y)
    + `<text class="tl-bez-label" x="6" y="${box.h - 5}" font-family="ui-monospace, monospace" font-size="9" fill="${muted}">${curveLabel(name)}</text>`
    + '</svg>';
}

/**
 * Draw the editor into `host` for easing `name`. Dragging a handle reshapes
 * the curve live; letting go hands `commit` the new cubic-bezier string. A tap
 * that does not move a handle changes nothing.
 */
export function bindCurveEditor(host: HTMLElement, name: string, box: CurveBox, commit: (easing: string) => void): void {
  let bez = bezierFor(name);
  let shown = name;
  host.innerHTML = curveEditorSVG(name, bez, box);
  const svg = host.querySelector<SVGSVGElement>('svg.tl-bez');
  if (!svg) return;
  const set = (sel: string, attrs: Record<string, string>): void => {
    svg.querySelectorAll(sel).forEach(el => Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)));
  };
  const paint = (): void => {
    const [p1x, p1y] = toPlot(bez[0], bez[1], box), [p2x, p2y] = toPlot(bez[2], bez[3], box);
    set('.tl-bez-curve', { d: curveD(shown, box) });
    set('.tl-bez-arm[data-h="1"]', { x2: p1x.toFixed(1), y2: p1y.toFixed(1) });
    set('.tl-bez-arm[data-h="2"]', { x2: p2x.toFixed(1), y2: p2y.toFixed(1) });
    set('.tl-bez-h[data-h="1"]', { cx: p1x.toFixed(1), cy: p1y.toFixed(1) });
    set('.tl-bez-h[data-h="2"]', { cx: p2x.toFixed(1), cy: p2y.toFixed(1) });
    const label = svg.querySelector('.tl-bez-label');
    if (label) label.textContent = curveLabel(shown);
  };
  svg.querySelectorAll<SVGCircleElement>('.tl-bez-h').forEach(h => h.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    const second = h.getAttribute('data-h') === '2';
    let moved = false;
    try { svg.setPointerCapture(e.pointerId); } catch { /* a synthetic event has no live pointer */ }
    const move = (ev: PointerEvent): void => {
      const rect = svg.getBoundingClientRect();
      // The svg may be drawn scaled (a zoomed panel): read the pointer in its own units.
      const [t, v] = fromPlot(((ev.clientX - rect.left) * box.w) / Math.max(1, rect.width), ((ev.clientY - rect.top) * box.h) / Math.max(1, rect.height), box);
      bez = second ? [bez[0], bez[1], t, v] : [t, v, bez[2], bez[3]];
      shown = bezierString(bez);
      moved = true;
      paint();
    };
    const end = (ev: PointerEvent): void => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', end);
      svg.removeEventListener('pointercancel', end);
      try { svg.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      if (moved && ev.type !== 'pointercancel') commit(shown);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }));
}
