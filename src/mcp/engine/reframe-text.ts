/**
 * Text boxes set wider (or taller) than their letters, trimmed back inside a
 * new frame. The reframe places blocks by their ink, so the letters fit — but
 * a 1400 px box around a 700 px title still ran 144 px past a 9:16 frame's
 * edge and diagnose called it clipped (benchmark sweep, b19 / b13). A trim is
 * kept only when the letters do not move: the same lines, the same ink box.
 */

import type { Layer } from '../../schema/types';
import { drawnBox } from '../../export/frame-geometry';
import { plainTextLayout } from '../../renderer/layer-renderers-shared';

type Node = Layer & { layers?: Layer[]; x?: number; y?: number; width?: number; height?: number; content?: { type?: string; value?: unknown }; style?: Record<string, unknown> };

const lines = (l: Node): string | null =>
  typeof l.content?.value === 'string' ? plainTextLayout(l.content.value, (l.style ?? {}) as never, l as never).lines.join('\n') : null;
const same = (a: ReturnType<typeof drawnBox>, b: ReturnType<typeof drawnBox>): boolean =>
  !!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

/** Try a box; keep it only if what the text draws is unchanged. */
function tryBox(l: Node, box: { x: number; y: number; width: number; height: number }): boolean {
  const before = { x: l.x, y: l.y, width: l.width, height: l.height };
  const ink = drawnBox(l), text = lines(l);
  Object.assign(l, box);
  if (box.width > 0 && box.height > 0 && lines(l) === text && same(drawnBox(l), ink)) return true;
  Object.assign(l, before);
  return false;
}

/** Trim every text box that runs past the W×H frame where its letters allow; the count trimmed. */
export function fitTextBoxes(layers: Layer[], W: number, H: number): number {
  let n = 0;
  for (const l of layers as Node[]) {
    if (Array.isArray(l.layers)) { n += fitTextBoxes(l.layers, W, H); continue; }
    if (l.type !== 'text' || typeof l.x !== 'number' || typeof l.y !== 'number' || typeof l.width !== 'number' || typeof l.height !== 'number') continue;
    const { x, y, width: w, height: h } = l as { x: number; y: number; width: number; height: number };
    let hit = false;
    if (x < 0 || x + w > W) {
      const anchor = plainTextLayout(String(l.content?.value ?? ''), (l.style ?? {}) as never, l as never).anchor;
      const c = x + w / 2, half = Math.min(c, W - c);
      const box = anchor === 'middle' ? { x: c - half, width: 2 * half } : anchor === 'end' ? { x: Math.max(0, x), width: x + w - Math.max(0, x) } : { x, width: Math.min(w, W - x) };
      hit = tryBox(l, { ...box, y, height: h }) || hit;
    }
    const cur = l as { x: number; width: number };
    if (y + h > H && y < H) hit = tryBox(l, { x: cur.x, width: cur.width, y, height: H - y }) || hit;
    if (hit) n++;
  }
  return n;
}
