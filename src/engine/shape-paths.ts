// Parametric shape → SVG path `d` generator. Shapes the engine couldn't draw
// before (star, burst, blob, arc, ring, bubble, heart, bolt, shield, gear,
// arrow, cross). Shorthand expands these into a `path` layer in ABSOLUTE canvas
// coords (matching renderPath / renderPolygon conventions) so they reuse the
// path renderer's fill / stroke / effects / rotation for free. Fully
// deterministic — no Math.random (render-path safe).

export type ShapeName =
  | 'star' | 'burst' | 'seal' | 'blob' | 'wave' | 'arc' | 'ring' | 'donut'
  | 'bubble' | 'speech_bubble' | 'heart' | 'lightning' | 'bolt' | 'shield'
  | 'gear' | 'cog' | 'arrow' | 'cross_shape' | 'plus_shape';

export interface ShapeBox { x: number; y: number; w: number; h: number; }
export interface ShapeResult { d: string; fillRule?: 'evenodd'; }

const TAU = Math.PI * 2;
const n2 = (v: number): string => (Math.round(v * 100) / 100).toString();
const num = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d);

// Move/Line/etc. point helper.
function pt(x: number, y: number): string { return `${n2(x)} ${n2(y)}`; }

// ── star / burst ────────────────────────────────────────────
function starPath(box: ShapeBox, points: number, innerRatio: number, rotDeg: number): string {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const rx = box.w / 2, ry = box.h / 2;
  const rot = (rotDeg * Math.PI) / 180;
  const seg: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (Math.PI * i) / points;
    const r = i % 2 === 0 ? 1 : innerRatio;
    const x = cx + Math.cos(a) * rx * r;
    const y = cy + Math.sin(a) * ry * r;
    seg.push(`${i === 0 ? 'M' : 'L'}${pt(x, y)}`);
  }
  return seg.join('') + 'Z';
}

// ── organic blob (smooth closed curve, deterministic jitter) ─
const BLOB_JIT = [1.0, 0.84, 1.1, 0.9, 1.06, 0.82, 1.12, 0.94, 1.02, 0.88];
function blobPath(box: ShapeBox, lobes: number, seed: number): string {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const rx = box.w / 2, ry = box.h / 2;
  const N = Math.max(4, Math.min(10, lobes));
  const P: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    const a = (TAU * i) / N - Math.PI / 2;
    const j = BLOB_JIT[(i + seed) % BLOB_JIT.length];
    P.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j]);
  }
  // Catmull-Rom → cubic Bézier for a smooth closed loop.
  let d = `M${pt(P[0][0], P[0][1])}`;
  for (let i = 0; i < N; i++) {
    const p0 = P[(i - 1 + N) % N], p1 = P[i], p2 = P[(i + 1) % N], p3 = P[(i + 2) % N];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${pt(c1x, c1y)} ${pt(c2x, c2y)} ${pt(p2[0], p2[1])}`;
  }
  return d + 'Z';
}

// ── filled wave band (sine top edge, straight sides + bottom) ─
function wavePath(box: ShapeBox, cycles: number, amp: number): string {
  const { x, y, w, h } = box;
  const a = Math.min(amp, h * 0.45);
  const mid = y + a;
  const steps = Math.max(2, Math.round(cycles)) * 2;
  const dx = w / steps;
  let d = `M${pt(x, mid)}`;
  for (let i = 0; i < steps; i++) {
    const x1 = x + dx * i, x2 = x + dx * (i + 1);
    const cy = mid + (i % 2 === 0 ? -a : a);
    d += `Q${pt((x1 + x2) / 2, cy)} ${pt(x2, mid)}`;
  }
  return d + `L${pt(x + w, y + h)}L${pt(x, y + h)}Z`;
}

// Map fractional [fx,fy] points (0–1 within the box) to an absolute polygon.
function polyFrac(box: ShapeBox, fr: Array<[number, number]>): string {
  return fr.map(([fx, fy], i) =>
    `${i === 0 ? 'M' : 'L'}${pt(box.x + fx * box.w, box.y + fy * box.h)}`).join('') + 'Z';
}

function ellipseArc(cx: number, cy: number, rx: number, ry: number): string {
  return `M${pt(cx - rx, cy)}A${n2(rx)} ${n2(ry)} 0 1 0 ${pt(cx + rx, cy)}A${n2(rx)} ${n2(ry)} 0 1 0 ${pt(cx - rx, cy)}Z`;
}

// ── open arc (stroke shape) ─────────────────────────────────
function arcPath(box: ShapeBox, startDeg: number, endDeg: number): string {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, rx = box.w / 2, ry = box.h / 2;
  const p = (deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  };
  const [sx, sy] = p(startDeg), [ex, ey] = p(endDeg);
  const sweep = endDeg >= startDeg ? 1 : 0;
  const large = Math.abs(endDeg - startDeg) % 360 > 180 ? 1 : 0;
  return `M${pt(sx, sy)}A${n2(rx)} ${n2(ry)} 0 ${large} ${sweep} ${pt(ex, ey)}`;
}

// ── ring / donut (annulus, evenodd hole) ────────────────────
function ringPath(box: ShapeBox, thickness: number): string {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, rx = box.w / 2, ry = box.h / 2;
  const k = Math.max(0.05, Math.min(0.95, thickness));
  return ellipseArc(cx, cy, rx, ry) + ellipseArc(cx, cy, rx * (1 - k), ry * (1 - k));
}

// ── speech bubble (rounded body + tail) ─────────────────────
function bubblePath(box: ShapeBox): string {
  const { x, y, w, h } = box;
  const y1 = y + h * 0.82;
  const r = Math.min(w, y1 - y) * 0.18;
  return [
    `M${pt(x + r, y)}`, `L${pt(x + w - r, y)}`, `Q${pt(x + w, y)} ${pt(x + w, y + r)}`,
    `L${pt(x + w, y1 - r)}`, `Q${pt(x + w, y1)} ${pt(x + w - r, y1)}`,
    `L${pt(x + w * 0.42, y1)}`, `L${pt(x + w * 0.2, y + h)}`, `L${pt(x + w * 0.28, y1)}`,
    `L${pt(x + r, y1)}`, `Q${pt(x, y1)} ${pt(x, y1 - r)}`,
    `L${pt(x, y + r)}`, `Q${pt(x, y)} ${pt(x + r, y)}`, 'Z',
  ].join('');
}

// ── gear / cog (flat-topped teeth + center hole) ────────────
function gearPath(box: ShapeBox, teeth: number, thickness: number): string {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, rx = box.w / 2, ry = box.h / 2;
  const T = Math.max(5, Math.min(16, teeth));
  const step = TAU / T;
  const root = 0.74;
  const seg: string[] = [];
  for (let i = 0; i < T; i++) {
    const b = i * step - Math.PI / 2;
    const v: Array<[number, number]> = [
      [b + step * 0.06, root], [b + step * 0.18, 1], [b + step * 0.32, 1], [b + step * 0.44, root],
    ];
    for (const [a, r] of v) seg.push(`${seg.length ? 'L' : 'M'}${pt(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r)}`);
  }
  const hole = Math.max(0.1, Math.min(0.6, thickness));
  return seg.join('') + 'Z' + ellipseArc(cx, cy, rx * hole, ry * hole);
}

const HEART = (box: ShapeBox): string => {
  const { x, y, w, h } = box, cx = x + w / 2;
  return `M${pt(cx, y + h * 0.95)}C${pt(x + w * 1.05, y + h * 0.55)} ${pt(x + w * 0.78, y + h * 0.04)} ${pt(cx, y + h * 0.33)}`
    + `C${pt(x + w * 0.22, y + h * 0.04)} ${pt(x - w * 0.05, y + h * 0.55)} ${pt(cx, y + h * 0.95)}Z`;
};
const BOLT: Array<[number, number]> = [[0.55, 0], [0.12, 0.58], [0.42, 0.58], [0.3, 1], [0.88, 0.4], [0.55, 0.4], [0.68, 0]];
const SHIELD = (box: ShapeBox): string => {
  const { x, y, w, h } = box, cx = x + w / 2;
  return `M${pt(x, y)}L${pt(x + w, y)}L${pt(x + w, y + h * 0.55)}Q${pt(x + w, y + h * 0.9)} ${pt(cx, y + h)}Q${pt(x, y + h * 0.9)} ${pt(x, y + h * 0.55)}Z`;
};
const ARROW: Array<[number, number]> = [[0, 0.3], [0.6, 0.3], [0.6, 0.1], [1, 0.5], [0.6, 0.9], [0.6, 0.7], [0, 0.7]];
function crossFrac(thickness: number): Array<[number, number]> {
  const a = (1 - Math.max(0.1, Math.min(0.8, thickness))) / 2, b = 1 - a;
  return [[a, 0], [b, 0], [b, a], [1, a], [1, b], [b, b], [b, 1], [a, 1], [a, b], [0, b], [0, a], [a, a]];
}

/** Generate an SVG path `d` (absolute coords) for a parametric shape. */
export function shapePath(name: ShapeName, box: ShapeBox, p: Record<string, unknown> = {}): ShapeResult {
  switch (name) {
    case 'star':
      return { d: starPath(box, Math.max(3, num(p['points'], 5)), num(p['inner_ratio'], 0.4), num(p['rotation'], -90)) };
    case 'burst':
    case 'seal':
      return { d: starPath(box, Math.max(8, num(p['points'], 20)), num(p['inner_ratio'], 0.82), num(p['rotation'], -90)) };
    case 'blob':
      return { d: blobPath(box, num(p['lobes'], 6), Math.round(num(p['seed'], 0))) };
    case 'wave':
      return { d: wavePath(box, num(p['cycles'], 2), num(p['amplitude'], box.h * 0.3)) };
    case 'arc':
      return { d: arcPath(box, num(p['start'], -90), num(p['end'], 180)) };
    case 'ring':
    case 'donut':
      return { d: ringPath(box, num(p['thickness'], 0.4)), fillRule: 'evenodd' };
    case 'bubble':
    case 'speech_bubble':
      return { d: bubblePath(box) };
    case 'heart':
      return { d: HEART(box) };
    case 'lightning':
    case 'bolt':
      return { d: polyFrac(box, BOLT) };
    case 'shield':
      return { d: SHIELD(box) };
    case 'gear':
    case 'cog':
      return { d: gearPath(box, num(p['teeth'], 8), num(p['hole'], 0.32)), fillRule: 'evenodd' };
    case 'arrow':
      return { d: polyFrac(box, ARROW) };
    case 'cross_shape':
    case 'plus_shape':
      return { d: polyFrac(box, crossFrac(num(p['thickness'], 0.34))) };
  }
}
