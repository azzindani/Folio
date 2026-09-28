/**
 * Objects a shot brings into each other: apart as authored, cut into one
 * another where the shot rests.
 *
 * Found in the one-shot benchmark (r1): an ice cube drifted in and came to rest
 * half behind the bottle. The lint read only text, so a shot that visibly
 * sliced a prop in two came back clean. What overlaps as authored is the static
 * diagnose's to judge, and one object wholly on or in another — a badge on a
 * card, a caption on a photo — is placement, not a cut. What is left is the
 * accident motion makes: two things that were apart, now partly over each other.
 */

import type { Layer } from '../../schema/types';
import { canvasBoxes, type CanvasBox } from '../../export/frame-cull';
import { ancestry } from './motion-lint-buried';

type Node = Layer & { layers?: Layer[]; z?: number };
type Box = CanvasBox['box'];

export interface Collision {
  /** The object painted underneath, and the one over it. */
  under: string;
  over: string;
  /** How much of the smaller object the other covers, 0–1. */
  share: number;
}

const CAMERA_ID = '__camera';
/** Partly over: less is a graze, more is one tucked into the other. */
const MIN_SHARE = 0.1, TUCKED = 0.9;
/** Apart as authored: at most this share overlapped before anything moved. */
const APART = 0.02;

const area = (b: Box): number => Math.max(0, b.width) * Math.max(0, b.height);
const meet = (a: Box, b: Box): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
/** The part of `a` inside `b`, or null when they do not meet. */
const cut = (a: Box, b: Box): Box | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.width, b.x + b.width) - x, h = Math.min(a.y + a.height, b.y + b.height) - y;
  return w > 0 && h > 0 ? { x, y, width: w, height: h } : null;
};
const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};
/** What an object draws on: its outer box, and the boxes of the parts it is made of. */
interface Drawn { box: Box; parts: Box[] }
/** Past this many overlapping bits the outer boxes stand in: a crowd of parts is read as its outline. */
const MAX_BITS = 400;

/** The area a set of rectangles covers, overlaps counted once — a sweep across x. */
function unionArea(rs: Box[]): number {
  const xs = [...new Set(rs.flatMap(r => [r.x, r.x + r.width]))].sort((p, q) => p - q);
  let total = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i] ?? 0, x1 = xs[i + 1] ?? 0;
    const spans = rs.filter(r => r.x <= x0 && r.x + r.width >= x1).map(r => [r.y, r.y + r.height] as const).sort((p, q) => p[0] - q[0]);
    let covered = 0, end = -Infinity;
    for (const [y0, y1] of spans) {
      if (y1 <= end) continue;
      covered += y1 - Math.max(y0, end);
      end = y1;
    }
    total += covered * (x1 - x0);
  }
  return total;
}

/**
 * Where two objects both draw: their parts' meeting, not their outer boxes. Found live (entity-ocr,
 * 2026-09-27): a caption group — a headline at the top, a button at the bottom — "came to rest over
 * 86%" of the form a camera landed between them, measured by the box around both.
 */
function drawnMeet(a: Drawn, b: Drawn): number {
  const bits: Box[] = [];
  for (const p of a.parts) for (const q of b.parts) { const r = cut(p, q); if (r) bits.push(r); }
  return bits.length > MAX_BITS ? meet(a.box, b.box) : unionArea(bits);
}
/** The share of the smaller of two objects the other covers. */
const shareOf = (a: Drawn, b: Drawn): number => drawnMeet(a, b) / Math.max(1, Math.min(area(a.box), area(b.box)));

/** The tree in paint order: siblings by ascending z, ties as written. */
export function paintOrder(layers: Layer[]): Layer[] {
  return [...(layers as Node[])]
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
    .map(l => (Array.isArray(l.layers) ? ({ ...l, layers: paintOrder(l.layers) } as Layer) : l));
}

type Point = { x: number; y: number };

/** `ends`: where a line — an open, unfilled path standing alone — starts and stops on the canvas. */
export interface Unit extends Drawn { id: string; opacity: number; paint: number; text: boolean; leaves: string[]; ends?: Point[] }

/** Below this a leaf is not on screen at the moment measured. */
const UNSEEN = 0.02;
/** A line's end this close to an object meets it. */
const TOUCH = 6;
const CMD = /([MLHVCSQT])([^MLHVCSQT]*)/g;

/** The ends of an open, unfilled path on the canvas. Absolute commands only; anything else is not read as a line. */
function lineEnds(b: CanvasBox): Point[] | undefined {
  const l = b.layer as { type?: string; d?: unknown; fill?: unknown };
  const m = b.matrix;
  if (l.type !== 'path' || typeof l.d !== 'string' || !m || (l.fill !== undefined && l.fill !== 'none')) return undefined;
  if (/[^MLHVCSQT\d\s.,eE+-]/.test(l.d)) return undefined;
  let first: Point | undefined;
  let at: Point = { x: 0, y: 0 };
  for (const [, cmd, args] of l.d.matchAll(CMD)) {
    const n = (args ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (n.some(v => !Number.isFinite(v))) return undefined;
    const [x0 = at.x, y0 = at.y] = n;
    const [x1 = at.x, y1 = at.y] = n.slice(-2);
    if (!first && cmd === 'M') first = { x: x0, y: y0 };
    at = cmd === 'H' ? { x: n[n.length - 1] ?? at.x, y: at.y } : cmd === 'V' ? { x: at.x, y: n[n.length - 1] ?? at.y } : { x: x1, y: y1 };
  }
  if (!first) return undefined;
  const map = (p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
  return [map(first), map(at)];
}

/** A line whose end lies on an object is drawn to meet it — a cable into its plug, an arrow at its card. */
const touches = (line: Unit | undefined, b: Box): boolean => (line?.ends ?? []).some(p =>
  p.x >= b.x - TOUCH && p.x <= b.x + b.width + TOUCH && p.y >= b.y - TOUCH && p.y <= b.y + b.height + TOUCH);

/** What to call an object: its one leaf when a wrapper holds only that. */
const nameOf = (u: Unit): string => (u.leaves.length === 1 ? u.leaves[0] ?? u.id : u.id);

/**
 * The objects of a frame. A group is ONE object — its parts overlap by design —
 * unless it holds the scene: the camera, or a group as big as the canvas.
 * Leaves as big as the canvas are ground, not objects.
 */
export function frameUnits(frame: Layer[], canvas: { width: number; height: number }, opts: { hidden?: boolean } = {}): Unit[] {
  const whole = canvas.width * canvas.height;
  // An image is what it draws, not its box: an icon's transparent margin meets nothing (image-ink.ts, r8).
  const inked = (b: CanvasBox): Box => {
    const f = (b.layer as { ink_box?: { x: number; y: number; w: number; h: number } }).ink_box;
    return f ? { x: b.box.x + f.x * b.box.width, y: b.box.y + f.y * b.box.height, width: f.w * b.box.width, height: f.h * b.box.height } : b.box;
  };
  const boxes = canvasBoxes(paintOrder(frame)).map(b => ({ ...b, box: inked(b) }));
  const up = ancestry(frame);
  const byId = new Map<string, Node>();
  const index = (ls: Layer[]): void => { for (const l of ls as Node[]) { byId.set(l.id, l); if (Array.isArray(l.layers)) index(l.layers); } };
  index(frame);
  const holder = (id: string): boolean => {
    if (id === CAMERA_ID) return true;
    const g = boxes.filter(b => b.layer.id === id || (up.get(b.layer.id) ?? []).includes(id)).reduce<Box | null>((u, b) => (u ? union(u, b.box) : b.box), null);
    return !g || area(g) >= 0.8 * whole;
  };
  const holders = new Map<string, boolean>();
  const units = new Map<string, Unit>();
  // A plain shape laid edge to edge is ground too — a floor, a desk, a sky band.
  // Found on the one-shot proof piece: a character standing on a 1080-wide desk "came to rest over" it.
  const band = (b: CanvasBox): boolean => !['text', 'image', 'icon', 'video', 'script', 'group'].includes(b.layer.type)
    && ((b.box.x <= canvas.width * 0.01 && b.box.x + b.box.width >= canvas.width * 0.99)
      || (b.box.y <= canvas.height * 0.01 && b.box.y + b.box.height >= canvas.height * 0.99));
  boxes.forEach((b, paint) => {
    // What is not showing at this moment is no part of the object then. Found live (entity-ocr): a caption
    // group's payoff button, still invisible, stretched the group down over the form the camera brought in.
    // (`hidden`: where things ARE, shown or not — the baseline a later entrance is measured from.)
    if (area(b.box) <= 0 || area(b.box) >= 0.8 * whole || band(b) || (!opts.hidden && b.opacity < UNSEEN)) return;
    const chain = up.get(b.layer.id) ?? [];
    // The outermost enclosing group that is not a scene holder names the object.
    const owner = chain.find(id => {
      if (!holders.has(id)) holders.set(id, !Array.isArray(byId.get(id)?.layers) || holder(id));
      return holders.get(id) === false;
    }) ?? b.layer.id;
    const u = units.get(owner);
    if (u) Object.assign(u, { box: union(u.box, b.box), parts: [...u.parts, b.box], opacity: Math.max(u.opacity, b.opacity), paint: Math.max(u.paint, paint), text: u.text && b.layer.type === 'text', leaves: [...u.leaves, b.layer.id], ends: undefined });
    else units.set(owner, { id: owner, box: b.box, parts: [b.box], opacity: b.opacity, paint, text: b.layer.type === 'text', leaves: [b.layer.id], ends: lineEnds(b) });
  });
  return [...units.values()];
}

/**
 * Where a pair is measured. `rest` is the world, the camera's own pose taken out
 * — right only for two things the camera carries. Found in the benchmark (r8):
 * a rider held still over a camera ride was measured on the screen against a
 * hedge measured in the world, 4400 px off the frame, and "came to rest over"
 * it; a cloud set at a depth (its own, smaller move) the same. Any other pair is
 * measured on the screen, where only what is inside the frame can meet.
 */
export interface Spaces { screen: Map<string, Unit>; carried: (id: string) => boolean; frame: Box }

const clip = (b: Box | undefined, f: Box): Box | null => {
  if (!b) return null;
  const x = Math.max(b.x, f.x), y = Math.max(b.y, f.y);
  const w = Math.min(b.x + b.width, f.x + f.width) - x, h = Math.min(b.y + b.height, f.y + f.height) - y;
  return w > 0 && h > 0 ? { x, y, width: w, height: h } : null;
};

/**
 * Pairs of objects partly over each other at rest that were apart as authored,
 * one of which this shot placed (`placed` — entered or moved, itself or a parent).
 * Text on text is the overlap check's (the caller drops pairs it reports as buried).
 */
export function collisions(rest: Unit[], authored: Unit[], placed: (id: string) => boolean, spaces?: Spaces, began?: Map<string, Unit>): Collision[] {
  const was = new Map(authored.map(u => [u.id, u]));
  // Apart means apart as written AND in the first frame. A keyframed layer is written where it ends
  // (pages rising out of their books, rag-library); an entrance that scales in place is apart at t=0
  // only because each piece shrinks about its own centre (a lid on its jar, guard page b07).
  const together = (a: Unit, b: Unit): boolean => {
    const ba = began?.get(a.id), bb = began?.get(b.id);
    return !!ba && !!bb && shareOf(ba, bb) > APART;
  };
  const out: Collision[] = [];
  const seen = rest.filter(u => u.opacity > 0.3);
  // An object as the pair is measured: in the world when the camera carries both, else on the screen, inside the frame.
  const view = (u: Unit, onScreen: boolean): Unit | null => {
    if (!onScreen || !spaces) return u;
    const s = spaces.screen.get(u.id), box = clip(s?.box, spaces.frame);
    return s && box ? { ...s, box, parts: s.parts.map(p => clip(p, spaces.frame)).filter((p): p is Box => p !== null) } : null;
  };
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      const a = seen[i], b = seen[j];
      if (!a || !b || (a.text && b.text)) continue;
      if (!a.leaves.some(placed) && !b.leaves.some(placed) && !placed(a.id) && !placed(b.id)) continue;
      const onScreen = !!spaces && !(spaces.carried(a.id) && spaces.carried(b.id));
      const va = view(a, onScreen), vb = view(b, onScreen);
      if (!va || !vb || touches(va, vb.box) || touches(vb, va.box)) continue;
      const share = shareOf(va, vb);
      if (share < MIN_SHARE || share > TUCKED) continue;
      const wa = was.get(a.id), wb = was.get(b.id);
      if (!wa || !wb || shareOf(wa, wb) > APART || together(a, b)) continue;
      const [under, over] = a.paint < b.paint ? [a, b] : [b, a];
      out.push({ under: nameOf(under), over: nameOf(over), share: Math.round(share * 100) / 100 });
    }
  }
  return out;
}
