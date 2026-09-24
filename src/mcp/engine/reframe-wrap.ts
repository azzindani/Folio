/**
 * Wide lines re-wrapped so a piece can be larger in its new frame (B6b).
 *
 * A 16:9 slide's one long line — "CI was slow, and it was expensive." across
 * 1300 px — is what a 9:16 frame's width is measured against, so everything
 * shrank to ×0.51 around it (b13). Type is not scaled down to fit a line:
 * the line gets more lines. A text that is a block on its own (touching no
 * other content, top-aligned, plain) may be narrowed to the room the frame
 * has at scale k; the largest k at which the re-wrapped piece still fits is
 * found by bisection, and taken only when it is worth it (≥5% larger). Its
 * aligned edge stays where it was — left, centre or right — and it is never
 * wrapped past max(4, 2 × its lines + 1): a headline, not a column of words.
 * What stood under it in its column moves down by what it grew, as a page
 * flows: b24's rule had stayed put and crossed the quote's new third line.
 */

import type { Layer } from '../../schema/types';
import { plainTextLayout } from '../../renderer/layer-renderers-shared';
import { drawnBox } from '../../export/frame-geometry';
import { planReframe, standaloneTexts, contentOf, type ReframePlan } from './reframe-layout';
import { mapSubtree } from './reframe-map';

type Text = Layer & { x: number; y: number; width: number; height: number; content: { type?: string; value: string }; style?: Record<string, unknown>; split_of?: string };
type Box = { x: number; y: number; width: number; height: number };

const boxFrom = (l: Layer): Box | null => {
  const o = l as unknown as Partial<Box>;
  return typeof o.x === 'number' && typeof o.y === 'number' && typeof o.width === 'number' && typeof o.height === 'number' ? { x: o.x, y: o.y, width: o.width, height: o.height } : null;
};
const layout = (t: Text): ReturnType<typeof plainTextLayout> => plainTextLayout(t.content.value, (t.style ?? {}) as never, t as never);

/** A text this may re-wrap: plain, boxed, set from its top, not a split piece, its width not animated. */
function wrappable(l: Layer): l is Text {
  const t = l as Text & { animation?: { keyframes?: Array<Record<string, unknown>> } };
  const va = t.style?.['vertical_align'];
  return typeof t.content?.value === 'string' && (t.content.type === undefined || t.content.type === 'plain')
    && [t.x, t.y, t.width, t.height].every(v => typeof v === 'number') && (va === undefined || va === 'top') && !t.split_of
    && !(t.animation?.keyframes ?? []).some(k => typeof k['width'] === 'number');
}

/** Narrow a text's box to `w`, keeping its aligned edge, tall enough for the lines it now has. */
function wrapTo(t: Text, w: number): void {
  const align = t.style?.['text_align'] ?? t.style?.['align'];
  t.x += align === 'center' ? (t.width - w) / 2 : align === 'right' ? t.width - w : 0;
  t.width = w;
  const l = layout(t);
  t.height = Math.max(t.height, Math.ceil(l.lines.length * l.lineH));
}

export interface WrappedPlan { plan: ReframePlan; rewrapped: string[] }

/** planReframe, with standalone lines too wide for the frame re-wrapped when that makes the piece ≥5% larger. */
export function planWithRewrap(layers: Layer[], oldW: number, oldH: number, W: number, H: number): WrappedPlan {
  const base = planReframe(layers, oldW, oldH, W, H);
  const cap = Math.min(W, H) / Math.min(oldW, oldH);
  const texts = standaloneTexts(layers, oldW, oldH).filter(wrappable);
  if (!texts.length || base.k >= cap * 0.99) return { plan: base, rewrapped: [] };
  const lines0 = texts.map(t => layout(t).lines.length);
  // Everything laid out, as it was: a wrap pushes what is under it, and a failed try puts it all back.
  const content = contentOf(layers, oldW, oldH).map(c => c.l);
  const before = content.map(l => JSON.parse(JSON.stringify(l)) as Layer);
  const restore = (): void => content.forEach((l, i) => { const b = before[i]; if (b) Object.assign(l, JSON.parse(JSON.stringify(b)) as Layer); });
  /** Move what stood under `t` in its column down by what its letters grew. */
  const flow = (t: Text, bottom: number): void => {
    const now = drawnBox(t);
    const grew = now ? now.y + now.height - bottom : 0;
    if (grew <= 0) return;
    for (const l of content) {
      const b = l === t ? null : drawnBox(l) ?? boxFrom(l);
      if (b && b.y >= bottom - 2 && b.x < t.x + t.width && b.x + b.width > t.x) mapSubtree(l, { k: 1, ox: 0, oy: 0, dx: 0, dy: grew });
    }
  };
  /** Re-wrap for scale k and plan; the plan when the piece fits at k, else null (boxes left as tried). */
  const attempt = (k: number): WrappedPlan | null => {
    restore();
    const limit = base.room / k, ids: string[] = [];
    // Top to bottom, so a push from above lands before the text below is measured.
    [...texts.keys()].sort((a, b) => (texts[a]?.y ?? 0) - (texts[b]?.y ?? 0)).forEach(i => {
      const t = texts[i];
      const ink = t ? drawnBox(t) : null;
      if (!t || !ink || ink.width <= limit) return;
      const was = { x: t.x, y: t.y, width: t.width, height: t.height };
      wrapTo(t, limit);
      if (layout(t).lines.length > Math.max(4, 2 * (lines0[i] ?? 1) + 1)) { Object.assign(t, was); return; }
      flow(t, ink.y + ink.height);
      ids.push(t.id);
    });
    if (!ids.length) return null;
    const plan = planReframe(layers, oldW, oldH, W, H);
    return plan.k >= k * 0.98 ? { plan, rewrapped: ids } : null;
  };
  let lo = base.k, hi = cap, found = false;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (attempt(mid)) { lo = mid; found = true; } else hi = mid;
  }
  const best = found && lo >= base.k * 1.05 ? attempt(lo) : null;
  if (best) return best;
  restore();
  return { plan: base, rewrapped: [] };
}
