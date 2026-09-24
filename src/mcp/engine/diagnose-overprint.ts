/**
 * A text's letters running into a small shape they are not on — a candle's
 * flame into the "%" of "30%" (benchmark r6, b22), seen only by looking.
 *
 * Nothing else judged it: the collision check compares texts with texts, the
 * motion lint judges what a shot brings together, and a text ON a shape — a
 * pill's label, a card's figure — is its container's. What is left is a shape
 * smaller than the words, partly under or over their letters, that is not part
 * of the same object (a component's parts overlap by design). The finding
 * carries the move that clears it, for the whole object the shape belongs to:
 * a flame moves with its candle.
 */

import type { Layer } from '../../schema/types';
import type { Finding } from './diagnose';
import { canvasBoxes, type CanvasBox } from '../../export/frame-cull';
import { drawnBox, lineBoxes } from '../../export/frame-geometry';
import { ancestry } from './motion-lint-buried';
import { paintOrder } from './motion-lint-collide';

type Box = CanvasBox['box'];

const SHAPES = new Set(['rect', 'ellipse', 'circle', 'path', 'polygon', 'image', 'icon']);
/** Share of the shape the letters cover: less is a graze, more is a mark set in the words. */
const MIN_SHARE = 0.1, MAX_SHARE = 0.9;
/** Under the letters and mostly covered by them, a shape is their highlight or backing. */
const BACKING = 0.5;
/** A shape this thin is a line — a rule, a grid, an underline — not an object. */
const LINE_PX = 6;
/** A blur this soft is a glow, meant to sit behind. */
const SOFT_BLUR = 6;
/** Clearance the move leaves, px. */
const GAP = 12;

const area = (b: Box): number => Math.max(0, b.width) * Math.max(0, b.height);
const meet = (a: Box, b: Box): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

/** A shape a viewer sees as a thing: drawn and filled, not ground, not a line, not a soft glow. */
function seenShape(b: CanvasBox, whole: number): boolean {
  if (!SHAPES.has(b.layer.type) || b.opacity <= 0.3) return false;
  const a = area(b.box);
  if (a <= 0 || a >= 0.8 * whole || Math.min(b.box.width, b.box.height) <= LINE_PX) return false;
  const o = b.layer as unknown as { effects?: { blur?: unknown }; fill?: unknown };
  if (typeof o.effects?.blur === 'number' && o.effects.blur >= SOFT_BLUR) return false;
  // An outline — contour rings, a planet's ring — draws lines, not a body to run into.
  const fill = o.fill, color = typeof fill === 'string' ? fill : (fill as { color?: unknown } | undefined)?.color;
  return b.layer.type === 'image' || b.layer.type === 'icon' || (fill !== undefined && color !== 'none' && color !== 'transparent');
}

/** A text's lines where the canvas draws them: its posed box, split the way its own lines split it. */
function inkLines(t: CanvasBox): Box[] {
  const own = drawnBox(t.layer), lines = lineBoxes(t.layer);
  if (!own || !lines?.length || own.width <= 0 || own.height <= 0) return [t.box];
  const kx = t.box.width / own.width, ky = t.box.height / own.height;
  return lines.map(l => ({ x: t.box.x + (l.x - own.x) * kx, y: t.box.y + (l.y - own.y) * ky, width: l.width * kx, height: l.height * ky }));
}

/** Ids that move, themselves or through a group: the authored frame is not what a viewer sees of them. */
function moving(layers: Layer[], inherited = false, out = new Set<string>()): Set<string> {
  for (const l of layers as Array<Layer & { layers?: Layer[]; animation?: { keyframes?: unknown[]; enter?: unknown; exit?: unknown; loop?: unknown }; in?: unknown; out?: unknown }>) {
    const a = l.animation;
    const own = inherited || (a?.keyframes?.length ?? 0) >= 2 || !!a?.enter || !!a?.exit || !!a?.loop || l.in !== undefined || l.out !== undefined;
    if (own) out.add(l.id);
    if (Array.isArray(l.layers)) moving(l.layers, own, out);
  }
  return out;
}

/** The shortest move that takes `s` clear of `t`, keeping `s` on the canvas; null when none does. */
function clearOf(s: Box, t: Box, W: number, H: number): [number, number] | null {
  const ways: Array<[number, number]> = [
    [0, t.y - GAP - (s.y + s.height)], [0, t.y + t.height + GAP - s.y],
    [t.x - GAP - (s.x + s.width), 0], [t.x + t.width + GAP - s.x, 0],
  ];
  const fits = ([dx, dy]: [number, number]): boolean => s.x + dx >= 0 && s.x + s.width + dx <= W && s.y + dy >= 0 && s.y + s.height + dy <= H;
  return ways.filter(fits).sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]))[0] ?? null;
}

/** Texts whose letters run partly into a smaller shape they are not on, each with the move that clears it. */
export function overprintFindings(layers: Layer[], W: number, H: number): Finding[] {
  const whole = W * H;
  const boxes = canvasBoxes(paintOrder(layers));
  const paint = new Map(boxes.map((b, i) => [b.layer.id, i]));
  const up = ancestry(layers);
  // A pair that moves is judged where its shots rest (motion-lint-collide), not here.
  const moves = moving(layers);
  // Each group's drawn extent, so a group that holds the whole scene is not taken for an object.
  const extent = new Map<string, Box>();
  for (const b of boxes) for (const g of up.get(b.layer.id) ?? []) { const e = extent.get(g); extent.set(g, e ? union(e, b.box) : b.box); }
  /** The object a leaf belongs to: its outermost group that is not the scene, else itself. */
  const owner = (id: string): string => (up.get(id) ?? []).find(g => area(extent.get(g) ?? { x: 0, y: 0, width: 0, height: 0 }) < 0.8 * whole) ?? id;
  const texts = boxes.filter(b => b.layer.type === 'text' && b.opacity > 0.3 && area(b.box) > 0).map(t => ({ ...t, lines: inkLines(t) }));
  const shapes = boxes.filter(b => seenShape(b, whole));
  const out: Finding[] = [];
  const said = new Set<string>();
  for (const t of texts) {
    for (const s of shapes) {
      if (area(s.box) >= area(t.box)) continue;             // a shape as big as the words is a ground or a panel
      if (moves.has(t.layer.id) || moves.has(s.layer.id)) continue;
      const share = t.lines.reduce((sum, l) => sum + meet(l, s.box), 0) / area(s.box);
      const under = (paint.get(s.layer.id) ?? 0) < (paint.get(t.layer.id) ?? 0);
      if (share < MIN_SHARE || share > (under ? BACKING : MAX_SHARE)) continue;
      const obj = owner(s.layer.id), textObj = owner(t.layer.id);
      if (obj === textObj || said.has(`${t.layer.id}|${obj}`)) continue;   // one component's parts overlap by design
      said.add(`${t.layer.id}|${obj}`);
      const move = clearOf(extent.get(obj) ?? s.box, t.box, W, H);
      const part = obj === s.layer.id ? '' : ` (part of "${obj}")`;
      out.push({
        code: 'overprint', severity: 'warning', layer_id: t.layer.id, layers: [t.layer.id, obj],
        message: `The letters of "${t.layer.id}" run into "${s.layer.id}"${part}: ${Math.round(share * 100)}% of it lies under or over them.`,
        fix: `Move "${obj}" clear of the words${move ? ` (${move[0] ? `dx ${Math.round(move[0])}` : `dy ${Math.round(move[1])}`})` : ''}, move the words, or set the shape wholly behind them on purpose.`,
        ...(move ? { call: { tool: 'edit_layer', params: { op: 'move', layer_id: obj, dx: Math.round(move[0]), dy: Math.round(move[1]) } } } : {}),
      });
    }
  }
  return out;
}
