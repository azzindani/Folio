// Folio renderer — connector primitive. Draws a curved / elbow / straight line
// between two anchors with an optional arrowhead. The ENGINE owns the spatial
// math here (bezier control points, arrowhead geometry oriented to the tangent)
// so the model can just say "connect A to B" and have it render well — §0.4.
import { createSVGElement } from './svg-utils';
import { applyCommonAttributes, applyStroke, normalizeStroke } from './layer-renderers-shared';

type Pt = { x: number; y: number };

export interface ConnectorLayer {
  id: string;
  type: 'connector';
  from?: [number, number];
  to?: [number, number];
  x1?: number; y1?: number; x2?: number; y2?: number;
  curve?: 'straight' | 'arc' | 'elbow' | 's' | 'wave';
  bend?: number;            // 0..1 → fraction of length; >1 → px offset
  arrow?: 'none' | 'end' | 'start' | 'both';
  arrow_size?: number;
  stroke?: unknown;
  stroke_width?: number;
  dashed?: boolean;
  [k: string]: unknown;
}

const num = (v: unknown, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;

function endpoints(layer: ConnectorLayer): { p1: Pt; p2: Pt } {
  const f = layer.from, t = layer.to;
  const p1 = { x: num(f?.[0], num(layer.x1, 0)), y: num(f?.[1], num(layer.y1, 0)) };
  const p2 = { x: num(t?.[0], num(layer.x2, 0)), y: num(t?.[1], num(layer.y2, 0)) };
  return { p1, p2 };
}

/** Build the path `d` plus the unit tangent ARRIVING at each end (for arrows). */
function buildPath(layer: ConnectorLayer, p1: Pt, p2: Pt): { d: string; tEnd: Pt; tStart: Pt } {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;       // along
  const px = -uy, py = ux;                   // perp
  const b = layer.bend;
  const bend = b == null ? len * 0.18 : Math.abs(b) <= 1 ? b * len : b;
  const norm = (vx: number, vy: number): Pt => { const m = Math.hypot(vx, vy) || 1; return { x: vx / m, y: vy / m }; };
  const curve = layer.curve ?? 'straight';

  if (curve === 'elbow') {
    if (Math.abs(dx) >= Math.abs(dy)) {
      const mx = (p1.x + p2.x) / 2;
      return { d: `M ${p1.x} ${p1.y} L ${mx} ${p1.y} L ${mx} ${p2.y} L ${p2.x} ${p2.y}`,
        tEnd: { x: Math.sign(dx) || 1, y: 0 }, tStart: { x: -(Math.sign(dx) || 1), y: 0 } };
    }
    const my = (p1.y + p2.y) / 2;
    return { d: `M ${p1.x} ${p1.y} L ${p1.x} ${my} L ${p2.x} ${my} L ${p2.x} ${p2.y}`,
      tEnd: { x: 0, y: Math.sign(dy) || 1 }, tStart: { x: 0, y: -(Math.sign(dy) || 1) } };
  }

  if (curve === 's') {
    const c1 = { x: p1.x + dx * 0.25 + px * bend, y: p1.y + dy * 0.25 + py * bend };
    const c2 = { x: p1.x + dx * 0.75 - px * bend, y: p1.y + dy * 0.75 - py * bend };
    return { d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`,
      tEnd: norm(p2.x - c2.x, p2.y - c2.y), tStart: norm(c1.x - p1.x, c1.y - p1.y) };
  }

  if (curve === 'wave') {
    const segs = Math.max(2, Math.round(len / 90));
    let d = `M ${p1.x} ${p1.y}`;
    let prev = p1;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const on = { x: p1.x + dx * t, y: p1.y + dy * t };
      const sign = i % 2 === 1 ? 1 : -1;
      const cm = { x: (prev.x + on.x) / 2 + px * bend * 0.6 * sign, y: (prev.y + on.y) / 2 + py * bend * 0.6 * sign };
      d += ` Q ${cm.x} ${cm.y} ${on.x} ${on.y}`;
      prev = on;
    }
    return { d, tEnd: { x: ux, y: uy }, tStart: { x: -ux, y: -uy } };
  }

  if (curve === 'arc') {
    const c = { x: (p1.x + p2.x) / 2 + px * bend, y: (p1.y + p2.y) / 2 + py * bend };
    return { d: `M ${p1.x} ${p1.y} Q ${c.x} ${c.y} ${p2.x} ${p2.y}`,
      tEnd: norm(p2.x - c.x, p2.y - c.y), tStart: norm(c.x - p1.x, c.y - p1.y) };
  }

  // straight
  return { d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`, tEnd: { x: ux, y: uy }, tStart: { x: -ux, y: -uy } };
}

/** Triangle pointing along `dir` (unit) with its tip at `tip`. */
function arrowPoints(tip: Pt, dir: Pt, size: number): string {
  const bx = tip.x - dir.x * size, by = tip.y - dir.y * size;
  const wx = -dir.y, wy = dir.x;             // perp
  const w = size * 0.55;
  return `${tip.x},${tip.y} ${bx + wx * w},${by + wy * w} ${bx - wx * w},${by - wy * w}`;
}

export function renderConnector(layer: ConnectorLayer, svg: SVGSVGElement): SVGElement {
  const g = createSVGElement('g');
  const { p1, p2 } = endpoints(layer);
  const { d, tEnd, tStart } = buildPath(layer, p1, p2);

  const sn = normalizeStroke(layer) ?? { color: '#333', width: num(layer.stroke_width, 2) };
  if (layer.dashed && !sn.dash) sn.dash = [Math.max(4, sn.width * 3), Math.max(3, sn.width * 2)];

  const path = createSVGElement('path', { d });
  path.setAttribute('fill', 'none');
  applyStroke(path, sn, svg);
  path.setAttribute('stroke-linecap', sn.linecap ?? 'round');
  path.setAttribute('stroke-linejoin', sn.linejoin ?? 'round');
  g.appendChild(path);

  const arrow = layer.arrow ?? 'end';
  if (arrow !== 'none') {
    const size = num(layer.arrow_size, Math.max(9, sn.width * 3.5));
    const head = (tip: Pt, dir: Pt): SVGElement => {
      const tri = createSVGElement('polygon', { points: arrowPoints(tip, dir, size) });
      tri.setAttribute('fill', typeof sn.color === 'string' ? sn.color : '#333');
      return tri;
    };
    if (arrow === 'end' || arrow === 'both') g.appendChild(head(p2, tEnd));
    if (arrow === 'start' || arrow === 'both') g.appendChild(head(p1, tStart));
  }

  applyCommonAttributes(g, layer as never);
  return g;
}
