/**
 * A decoration left framing nothing — a glow, a halo, a card, a panel still on
 * screen after everything it held has gone (benchmark r5, b17: the clock left
 * at 10.2 s, its halo stayed through the brand card; seen only in the frame).
 *
 * Read at each shot rest. A decoration is a drawn shape at least 3% of the
 * canvas — not a ground, and not a band across the whole frame (a sea, a
 * sky: scenery). What it holds: things painted over it, at least 2% of its size
 * (not the sprinkles around it), with most of their box inside it. A moon
 * rising out from behind the sea was never the sea's to hold (r7, b26). When a decoration
 * that held something at an earlier rest holds nothing at a later one and is
 * still there, the finding names what left and when, with the out point that
 * ends it with them.
 */

import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { Finding } from './diagnose';
import { canvasBoxes, type CanvasBox } from '../../export/frame-cull';
import { layersAt } from '../../export/gif-frames';
import { moments } from './diagnose-safe';
import { paintOrder } from './motion-lint-collide';

type Box = CanvasBox['box'];
const SHAPES = new Set(['rect', 'ellipse', 'circle', 'path', 'polygon']);
/** Share of a thing's box inside a decoration for the decoration to hold it. */
const HELD = 0.8;
/** Smaller than this share of the decoration, a thing is a speck around it, not what it frames. */
const SPECK = 0.02;

const area = (b: Box): number => Math.max(0, b.width) * Math.max(0, b.height);
const meet = (a: Box, b: Box): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** Each visible decoration at one moment, and the ids it holds. */
function holdings(frame: Layer[], W: number, H: number): Map<string, string[]> {
  const boxes = canvasBoxes(paintOrder(frame)), whole = W * H;
  const things = boxes.map((b, i) => ({ ...b, i })).filter(b => b.opacity > 0.3 && area(b.box) > 0);
  const out = new Map<string, string[]>();
  boxes.forEach((d, i) => {
    const a = area(d.box);
    const band = d.box.width >= 0.99 * W || d.box.height >= 0.99 * H;
    if (!SHAPES.has(d.layer.type) || d.opacity <= 0.02 || a < 0.03 * whole || a >= 0.8 * whole || band) return;
    out.set(d.layer.id, things.filter(t => t.i > i && area(t.box) >= SPECK * a && area(t.box) < a && meet(t.box, d.box) >= HELD * area(t.box)).map(t => t.layer.id));
  });
  return out;
}

/** When the last of `ids` stopped being seen, between `from` and `to` ms (bisected; a subject leaves once). */
function leftAt(layers: Layer[], ids: string[], from: number, to: number): number {
  const seen = (t: number): boolean => canvasBoxes(layersAt(layers, t)).some(b => ids.includes(b.layer.id) && b.opacity > 0.05);
  let lo = from, hi = to;
  while (hi - lo > 1) { const mid = (lo + hi) / 2; if (seen(mid)) lo = mid; else hi = mid; }
  return Math.ceil(lo);
}

/** Decorations still on screen at a shot rest after what they framed has gone. */
export function orphanFindings(spec: DesignSpec, layers: Layer[], page?: Page): Finding[] {
  const W = spec.document?.width ?? 1080, H = spec.document?.height ?? 1080;
  const out: Finding[] = [];
  const held = new Map<string, { ids: string[]; t: number }>();
  const said = new Set<string>();
  for (const m of moments(spec, layers, page)) {
    if (m.t === null) return out;                    // a still page has one moment: nothing leaves
    for (const [id, now] of holdings(m.frame, W, H)) {
      if (now.length) { held.set(id, { ids: now, t: m.t }); continue; }
      const before = held.get(id);
      if (!before || said.has(id)) continue;
      said.add(id);
      const gone = leftAt(layers, before.ids, before.t, m.t);
      const names = before.ids.slice(0, 3).map(x => `"${x}"`).join(', ') + (before.ids.length > 3 ? ` and ${before.ids.length - 3} more` : '');
      out.push({
        code: 'orphan_decoration', severity: 'warning', layer_id: id, layers: [id, ...before.ids.slice(0, 3)],
        message: `"${id}"${m.label} frames nothing: what it held (${names}) was gone by ${gone} ms, and it stayed on screen.`,
        fix: `End it with them — out at ${gone} ms, or the same exit they take — or give it something new to hold.`,
        call: { tool: 'edit_layer', params: { op: 'update', layer_id: id, props: { out: gone } } },
      });
    }
  }
  return out;
}
