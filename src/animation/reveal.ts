/**
 * The `reveal` channel — a wipe that uncovers a layer from one side (After
 * Effects' Linear Wipe / an iris from the centre). One rule for both players:
 * the CSS route turns it into `clip-path: inset()` on the layer's fill-box, the
 * flipbook into a `clip_rect` over the drawn box, from the same numbers.
 *
 * The wiping edge travels from REVEAL_BLEED px BEFORE the box to REVEAL_BLEED
 * px PAST it, so at reveal 0 an outside stroke is hidden too and at reveal 1 it
 * is whole — no snap step, no trimmed stroke while the entrance holds. Sides
 * that are not wiping never clip.
 */

import type { KeyframeAnimation } from './types';

export type RevealFrom = NonNullable<KeyframeAnimation['playback']['reveal_from']>;
export const REVEAL_FROMS: readonly RevealFrom[] = ['left', 'right', 'top', 'bottom', 'center'];

/** px the wiping edge overshoots the box at each end. */
export const REVEAL_BLEED = 16;
/** A side that is not wiping sits this far out — far enough never to clip. */
const OPEN_PX = 10000;

/** One side of the inset: `frac` of the box's size on that axis plus `px`. */
export interface InsetSide { frac: number; px: number }
export interface RevealInset { top: InsetSide; right: InsetSide; bottom: InsetSide; left: InsetSide }

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** How far in each side of the box is clipped at a reveal value. */
export function revealInset(reveal: number, from: RevealFrom = 'left'): RevealInset {
  const r = clamp01(reveal);
  // `span` is the share of the box this edge crosses: all of it, or half for an iris.
  const edge = (span: number): InsetSide => ({ frac: (1 - r) * span, px: (1 - 2 * r) * REVEAL_BLEED });
  const open: InsetSide = { frac: 0, px: -OPEN_PX };
  switch (from) {
    case 'right': return { top: open, right: open, bottom: open, left: edge(1) };
    case 'top': return { top: open, right: open, bottom: edge(1), left: open };
    case 'bottom': return { top: edge(1), right: open, bottom: open, left: open };
    case 'center': return { top: edge(0.5), right: edge(0.5), bottom: edge(0.5), left: edge(0.5) };
    default: return { top: open, right: edge(1), bottom: open, left: open };
  }
}

const fmt = (v: number): string => String(Number(v.toFixed(3)));
const sideCSS = (s: InsetSide): string => (s.frac === 0 ? `${fmt(s.px)}px` : `calc(${fmt(s.frac * 100)}% + ${fmt(s.px)}px)`);

/**
 * The inset as CSS, measured on the `fill-box` — named, because an SVG element's
 * default reference box is the STROKE box (Chromium wiped 5px off the flipbook
 * on a 20px stroke), and fill-box is what the flipbook measures and the
 * transforms pivot on.
 */
export function revealInsetCSS(reveal: number, from?: RevealFrom): string {
  const i = revealInset(reveal, from);
  return `inset(${sideCSS(i.top)} ${sideCSS(i.right)} ${sideCSS(i.bottom)} ${sideCSS(i.left)}) fill-box`;
}

/**
 * The visible rectangle for a box, in the box's own coordinates — or null when
 * fully revealed, so a still frame at rest carries no clip at all.
 */
export function revealRect(
  box: { x: number; y: number; width: number; height: number }, reveal: number, from?: RevealFrom,
): { x: number; y: number; width: number; height: number } | null {
  if (reveal >= 1) return null;
  const i = revealInset(reveal, from);
  const top = i.top.frac * box.height + i.top.px, bottom = i.bottom.frac * box.height + i.bottom.px;
  const left = i.left.frac * box.width + i.left.px, right = i.right.frac * box.width + i.right.px;
  return { x: box.x + left, y: box.y + top, width: Math.max(0, box.width - left - right), height: Math.max(0, box.height - top - bottom) };
}
