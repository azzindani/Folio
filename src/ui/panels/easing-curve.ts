/**
 * Draw an easing.
 *
 * Easings were pickable per keyframe from a dropdown of thirty names, which
 * tells you nothing: "ease-out-back" and "ease-out-expo" are both "fast then
 * slow", and the difference between them is the whole reason to choose one.
 *
 * The curve is SAMPLED through `resolveEasing`, not drawn as a cubic-bezier
 * control cage. That matters: bounce, elastic and stepped easings are not
 * beziers at all, so a bezier editor could not show them — and those are
 * exactly the ones whose shape is hard to imagine. Sampling draws whatever the
 * engine actually computes, which also means the picture cannot drift from the
 * playback.
 */

import { resolveEasing } from '../../animation/easing';

/** Sample an easing into an SVG path across a w×h box (y grows downward). */
export function easingCurvePath(name: string, w: number, h: number, samples = 48): string {
  const fn = resolveEasing(name || undefined);
  const n = Math.max(2, Math.floor(samples));
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let v: number;
    try { v = fn(t); } catch { v = t; }
    if (!Number.isFinite(v)) v = t;
    const x = t * w;
    // An overshoot (back/elastic) legitimately leaves 0..1 — keep it in view by
    // reserving a margin rather than clipping the interesting part off.
    const y = h - v * h;
    pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

/** How far outside 0..1 an easing travels, so the plot can leave room. */
export function easingOvershoot(name: string, samples = 48): number {
  const fn = resolveEasing(name || undefined);
  let lo = 0, hi = 1;
  for (let i = 0; i < samples; i++) {
    let v: number;
    try { v = fn(i / (samples - 1)); } catch { v = 0; }
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return Math.max(-lo, hi - 1);
}

/**
 * A small self-contained plot of one easing: grid, the linear reference, and
 * the curve. Sized for a popover beside the keyframe that owns it.
 */
export function easingCurveSVG(name: string, w = 132, h = 92): string {
  const over = easingOvershoot(name);
  const pad = Math.min(24, Math.round(h * Math.min(0.35, over)) + 8);
  const iw = w - 16, ih = h - pad * 2;
  const label = name || 'track default';
  return [
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label} curve">`,
    `<rect width="${w}" height="${h}" rx="3" fill="var(--color-surface-2, #1b1e24)"/>`,
    `<g transform="translate(8 ${pad})">`,
    `<rect width="${iw}" height="${ih}" fill="none" stroke="var(--color-border, #2a2f37)"/>`,
    `<line x1="0" y1="${ih}" x2="${iw}" y2="0" stroke="var(--color-border, #2a2f37)" stroke-dasharray="3 3"/>`,
    `<path d="${easingCurvePath(name, iw, ih)}" fill="none" stroke="var(--color-accent, #7C5CFF)" stroke-width="2" stroke-linejoin="round"/>`,
    '</g>',
    `<text x="8" y="${h - 4}" font-family="ui-monospace, monospace" font-size="9" fill="var(--color-text-muted, #8892a4)">${label}</text>`,
    '</svg>',
  ].join('');
}
