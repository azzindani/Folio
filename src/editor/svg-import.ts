// WP-4.8 — import an SVG (e.g. Figma export) as EDITABLE Folio layers, not a flat
// image. Each renderable element becomes a native layer (rect/ellipse/line/
// polygon/path/text) with its transform BAKED into absolute root coordinates, so
// re-exporting the design round-trips to an equivalent SVG. Browser-only: it
// mounts the SVG offscreen to read each element's CTM via the DOM.

import type { Layer } from '../schema/types';
import { transformPathD, type Matrix } from './svg-path-transform';

export interface SVGImportLayers {
  layers: Layer[];
  width: number;
  height: number;
}

const RENDERABLE = ['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'text'];

function ctmOf(el: SVGGraphicsElement): Matrix {
  const m = typeof el.getCTM === 'function' ? el.getCTM() : null;
  return m ? [m.a, m.b, m.c, m.d, m.e, m.f] : [1, 0, 0, 1, 0, 0];
}
function pt(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
const round = (v: number): number => Math.round(v * 100) / 100;
function num(el: Element, a: string, d = 0): number {
  const v = parseFloat(el.getAttribute(a) ?? '');
  return Number.isFinite(v) ? v : d;
}
function isAxisAligned(m: Matrix): boolean {
  return Math.abs(m[1]) < 1e-4 && Math.abs(m[2]) < 1e-4;
}
function rotationDeg(m: Matrix): number {
  return round((Math.atan2(m[1], m[0]) * 180) / Math.PI);
}

// Fill/stroke from presentation attrs or inline style (Figma uses both).
function paint(el: Element): { fill?: unknown; stroke?: unknown; opacity?: number } {
  const style = el.getAttribute('style') ?? '';
  const styleVal = (k: string): string | undefined =>
    style.match(new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([^;]+)`))?.[1]?.trim();
  const fillRaw = el.getAttribute('fill') ?? styleVal('fill');
  const strokeRaw = el.getAttribute('stroke') ?? styleVal('stroke');
  const swRaw = el.getAttribute('stroke-width') ?? styleVal('stroke-width');
  const opRaw = el.getAttribute('opacity') ?? styleVal('opacity');
  const out: { fill?: unknown; stroke?: unknown; opacity?: number } = {};
  if (fillRaw && fillRaw !== 'none') out.fill = { type: 'solid', color: fillRaw };
  else if (fillRaw === 'none') out.fill = { type: 'none' };
  if (strokeRaw && strokeRaw !== 'none') out.stroke = { color: strokeRaw, width: swRaw ? parseFloat(swRaw) : 1 };
  if (opRaw && Number.isFinite(parseFloat(opRaw))) out.opacity = parseFloat(opRaw);
  return out;
}

function elementToLayer(el: SVGGraphicsElement, id: string, z: number): Layer | null {
  const m = ctmOf(el);
  const base = { id, z, ...paint(el) };
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case 'rect': {
      const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height');
      const rx = num(el, 'rx');
      if (isAxisAligned(m)) {
        const [nx, ny] = pt(m, x, y);
        return { ...base, type: 'rect', x: round(nx), y: round(ny), width: round(w * m[0]), height: round(h * m[3]), ...(rx ? { radius: round(rx * m[0]) } : {}) } as unknown as Layer;
      }
      // rotated/skewed → bake corners into a path
      const c = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => pt(m, px, py));
      const d = `M${c.map(([a, b]) => `${round(a)} ${round(b)}`).join('L')}Z`;
      return { ...base, type: 'path', d } as unknown as Layer;
    }
    case 'circle': case 'ellipse': {
      const cx = num(el, 'cx'), cy = num(el, 'cy');
      const rx = tag === 'circle' ? num(el, 'r') : num(el, 'rx');
      const ry = tag === 'circle' ? num(el, 'r') : num(el, 'ry');
      const [ncx, ncy] = pt(m, cx, cy);
      const sX = Math.hypot(m[0], m[1]), sY = Math.hypot(m[2], m[3]);
      const rot = rotationDeg(m);
      return { ...base, type: 'ellipse', cx: round(ncx), cy: round(ncy), rx: round(rx * sX), ry: round(ry * sY), ...(rot ? { rotation: rot } : {}) } as unknown as Layer;
    }
    case 'line': {
      const [x1, y1] = pt(m, num(el, 'x1'), num(el, 'y1'));
      const [x2, y2] = pt(m, num(el, 'x2'), num(el, 'y2'));
      return { ...base, type: 'line', x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2) } as unknown as Layer;
    }
    case 'polygon': case 'polyline': {
      const raw = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
      const parts: string[] = [];
      for (let i = 0; i + 1 < raw.length; i += 2) { const [px, py] = pt(m, raw[i], raw[i + 1]); parts.push(`${round(px)},${round(py)}`); }
      return { ...base, type: tag, points: parts.join(' ') } as unknown as Layer;
    }
    case 'path': {
      const d = el.getAttribute('d') ?? '';
      if (!d) return null;
      return { ...base, type: 'path', d: isAxisAligned(m) && m[0] === 1 && m[3] === 1 && m[4] === 0 && m[5] === 0 ? d : transformPathD(d, m) } as unknown as Layer;
    }
    case 'text': {
      const [x, y] = pt(m, num(el, 'x'), num(el, 'y'));
      const fs = num(el, 'font-size', 16) * Math.hypot(m[0], m[1]);
      const content = (el.textContent ?? '').trim();
      if (!content) return null;
      const col = (el.getAttribute('fill') ?? '#000');
      return { ...base, type: 'text', x: round(x), y: round(y - fs), content, fill: undefined, style: { size: round(fs), color: col } } as unknown as Layer;
    }
    default:
      return null;
  }
}

/** Parse an SVG string into editable Folio layers. Mounts the SVG offscreen so
 *  element CTMs resolve, walks renderable leaves in document order. */
export function svgToLayers(svgText: string, baseZ = 0): SVGImportLayers {
  if (typeof document === 'undefined') throw new Error('svgToLayers requires a DOM');
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('Invalid SVG: ' + (err.textContent ?? '').slice(0, 80));
  const svg = doc.documentElement as unknown as SVGSVGElement;

  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const width = parseFloat(svg.getAttribute('width') ?? '') || vb[2] || 100;
  const height = parseFloat(svg.getAttribute('height') ?? '') || vb[3] || 100;

  // Offscreen mount so getCTM() works. Import the node into the live document.
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden';
  const live = document.importNode(svg, true) as unknown as SVGSVGElement;
  host.appendChild(live);
  document.body.appendChild(host);

  const layers: Layer[] = [];
  try {
    const nodes = live.querySelectorAll<SVGGraphicsElement>(RENDERABLE.join(','));
    let z = baseZ;
    nodes.forEach((el, i) => {
      // Skip elements inside <defs>/<clipPath>/<mask> — not directly rendered.
      if (el.closest('defs, clipPath, mask, symbol')) return;
      const layer = elementToLayer(el, `svg-${i}`, z++);
      if (layer) layers.push(layer);
    });
  } finally {
    document.body.removeChild(host);
  }
  return { layers, width, height };
}
