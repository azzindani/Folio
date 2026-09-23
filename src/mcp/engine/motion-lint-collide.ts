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
const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};
/** The share of the smaller of two boxes the other covers. */
const shareOf = (a: Box, b: Box): number => meet(a, b) / Math.max(1, Math.min(area(a), area(b)));

/** The tree in paint order: siblings by ascending z, ties as written. */
function paintOrder(layers: Layer[]): Layer[] {
  return [...(layers as Node[])]
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
    .map(l => (Array.isArray(l.layers) ? ({ ...l, layers: paintOrder(l.layers) } as Layer) : l));
}

export interface Unit { id: string; box: Box; opacity: number; paint: number; text: boolean; leaves: string[] }

/** What to call an object: its one leaf when a wrapper holds only that. */
const nameOf = (u: Unit): string => (u.leaves.length === 1 ? u.leaves[0] ?? u.id : u.id);

/**
 * The objects of a frame. A group is ONE object — its parts overlap by design —
 * unless it holds the scene: the camera, or a group as big as the canvas.
 * Leaves as big as the canvas are ground, not objects.
 */
export function frameUnits(frame: Layer[], canvas: { width: number; height: number }): Unit[] {
  const whole = canvas.width * canvas.height;
  const boxes = canvasBoxes(paintOrder(frame));
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
  boxes.forEach((b, paint) => {
    if (area(b.box) <= 0 || area(b.box) >= 0.8 * whole) return;
    const chain = up.get(b.layer.id) ?? [];
    // The outermost enclosing group that is not a scene holder names the object.
    const owner = chain.find(id => {
      if (!holders.has(id)) holders.set(id, !Array.isArray(byId.get(id)?.layers) || holder(id));
      return holders.get(id) === false;
    }) ?? b.layer.id;
    const u = units.get(owner);
    if (u) Object.assign(u, { box: union(u.box, b.box), opacity: Math.max(u.opacity, b.opacity), paint: Math.max(u.paint, paint), text: u.text && b.layer.type === 'text', leaves: [...u.leaves, b.layer.id] });
    else units.set(owner, { id: owner, box: b.box, opacity: b.opacity, paint, text: b.layer.type === 'text', leaves: [b.layer.id] });
  });
  return [...units.values()];
}

/**
 * Pairs of objects partly over each other at rest that were apart as authored,
 * one of which this shot placed (`placed` — entered or moved, itself or a parent).
 * Text on text is the overlap check's (the caller drops pairs it reports as buried).
 */
export function collisions(rest: Unit[], authored: Unit[], placed: (id: string) => boolean): Collision[] {
  const was = new Map(authored.map(u => [u.id, u.box]));
  const out: Collision[] = [];
  const seen = rest.filter(u => u.opacity > 0.3);
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      const a = seen[i], b = seen[j];
      if (!a || !b || (a.text && b.text)) continue;
      if (!a.leaves.some(placed) && !b.leaves.some(placed) && !placed(a.id) && !placed(b.id)) continue;
      const share = shareOf(a.box, b.box);
      if (share < MIN_SHARE || share > TUCKED) continue;
      const wa = was.get(a.id), wb = was.get(b.id);
      if (!wa || !wb || shareOf(wa, wb) > APART) continue;
      const [under, over] = a.paint < b.paint ? [a, b] : [b, a];
      out.push({ under: nameOf(under), over: nameOf(over), share: Math.round(share * 100) / 100 });
    }
  }
  return out;
}
