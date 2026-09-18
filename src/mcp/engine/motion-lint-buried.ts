/**
 * Text a shot puts somewhere it cannot be seen: under an opaque shape painted
 * after it.
 *
 * Found live: six header chips flew into an "AI context" card that was
 * declared after them, so the card's fill painted over every one. The frame
 * poses said each chip had landed exactly on target; only a look at the render
 * showed an empty card, and a caller that cannot see renders never gets that
 * look. Only text this shot placed (entered or moved, itself or a parent) is
 * judged — a scrim laid over a finished scene on purpose is not a mistake.
 */

import type { Layer } from '../../schema/types';
import { canvasBoxes, type CanvasBox } from '../../export/frame-cull';

type Node = Layer & { layers?: Layer[]; z?: number };

/** The tree in the order it paints: siblings by ascending z, ties as written (the renderer's stable sort). */
function paintOrder(layers: Layer[]): Layer[] {
  return [...(layers as Node[])]
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
    .map(l => (Array.isArray(l.layers) ? ({ ...l, layers: paintOrder(l.layers) } as Layer) : l));
}

/** The ids enclosing each layer, outermost first. */
export function ancestry(layers: Layer[], chain: string[] = [], out = new Map<string, string[]>()): Map<string, string[]> {
  for (const l of layers as Node[]) {
    out.set(l.id, chain);
    if (Array.isArray(l.layers)) ancestry(l.layers, [...chain, l.id], out);
  }
  return out;
}

/** A solid fill a viewer cannot see through. */
function opaqueFill(l: Layer): boolean {
  if (!['rect', 'ellipse', 'circle', 'path', 'image', 'polygon'].includes(l.type)) return false;
  if (l.type === 'image') return true;
  const fill = (l as unknown as { fill?: unknown }).fill;
  const color = typeof fill === 'string' ? fill
    : fill && typeof fill === 'object' && (fill as { type?: string }).type === 'solid' ? (fill as { color?: unknown }).color : undefined;
  if (typeof color !== 'string') return false;
  const c = color.trim().toLowerCase();
  if (c === 'none' || c === 'transparent') return false;
  const rgba = c.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/);
  if (rgba) return Number(rgba[1]) >= 0.9;
  // #rgba / #rrggbbaa carry their own alpha.
  const hex = c.match(/^#(?:[0-9a-f]{3}([0-9a-f])|[0-9a-f]{6}([0-9a-f]{2}))$/);
  if (hex) return hex[1] !== undefined ? parseInt(hex[1], 16) / 15 >= 0.9 : parseInt(hex[2] ?? 'ff', 16) / 255 >= 0.9;
  return true;
}

const covered = (a: CanvasBox['box'], b: CanvasBox['box']): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.max(1, a.width * a.height) : 0;
};

/**
 * Each text in `frame` that `placed` says this shot put there, and the opaque
 * layer painted over at least 60% of it.
 */
export function buriedTexts(frame: Layer[], placed: (id: string) => boolean): Array<{ text: string; under: string }> {
  const up = ancestry(frame);
  const boxes = canvasBoxes(paintOrder(frame));
  const out: Array<{ text: string; under: string }> = [];
  boxes.forEach((b, i) => {
    if (b.layer.type !== 'text' || b.opacity <= 0.3) return;
    if (!placed(b.layer.id) && !(up.get(b.layer.id) ?? []).some(placed)) return;
    const cover = boxes.slice(i + 1).find(o => o.opacity >= 0.9 && opaqueFill(o.layer) && covered(b.box, o.box) >= 0.6);
    if (cover) out.push({ text: b.layer.id, under: cover.layer.id });
  });
  return out;
}
