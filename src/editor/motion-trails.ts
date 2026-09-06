/**
 * Onion skin + motion trails — see the PATH, not just the pose.
 *
 * Scrubbing shows one moment at a time, so the question a motion editor exists
 * to answer ("where does this thing actually go?") could only be answered by
 * playing it repeatedly and remembering. A trail answers it in one look.
 *
 * Deliberately geometry, not renders: ghosting the whole design at t±Δ means
 * two extra full renders per frame, which is exactly the wrong cost during a
 * scrub. Sampling each animated layer's own box across the scene gives the
 * path, the spacing (bunched = slow, spread = fast — the easing, visible) and
 * the start/end, at a cost that does not scale with the design.
 */

import type { Layer } from '../schema/types';
import type { Keyframe } from '../animation/types';
import { interpolateAtTime, poseToLayerUpdate, flattenForTimeline } from '../ui/panels/timeline-panel';

export interface TrailSample { t: number; x: number; y: number; w: number; h: number; opacity: number }
export interface LayerTrail { layerId: string; samples: TrailSample[] }

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * Where one layer sits at each sampled moment.
 *
 * Uses the same `interpolateAtTime` + `poseToLayerUpdate` the player uses, so a
 * ghost is drawn exactly where playback will put the layer — a trail that
 * disagreed with the animation would be worse than none.
 */
export function layerTrail(layer: Layer, duration: number, samples = 12): LayerTrail | null {
  const kfs = (layer.animation?.keyframes ?? []) as Keyframe[];
  if (kfs.length < 2 || !(duration > 0)) return null;
  const o = layer as unknown as Record<string, unknown>;
  const n = Math.max(2, Math.min(40, Math.floor(samples)));
  const out: TrailSample[] = [];
  for (let i = 0; i < n; i++) {
    const t = (duration * i) / (n - 1);
    const pose = interpolateAtTime(kfs, t, duration);
    const u = poseToLayerUpdate(layer, pose) as unknown as Record<string, unknown>;
    out.push({
      t,
      x: num(u['x'], num(o['x'])),
      y: num(u['y'], num(o['y'])),
      w: num(o['width']),
      h: num(o['height']),
      opacity: Math.max(0, Math.min(1, num(u['opacity'], num(o['opacity'], 1)))),
    });
  }
  return { layerId: String(o['id'] ?? ''), samples: out };
}

/** Trails for every animated layer on a surface, at any depth. */
export function surfaceTrails(layers: Layer[], duration: number, samples = 12): LayerTrail[] {
  const out: LayerTrail[] = [];
  for (const { layer } of flattenForTimeline(layers ?? [])) {
    const tr = layerTrail(layer, duration, samples);
    // A layer that never moves and only fades has no path worth drawing.
    if (tr && trailMoves(tr)) out.push(tr);
  }
  return out;
}

/** Does this trail go anywhere? A pure fade is not a path. */
export function trailMoves(trail: LayerTrail, epsilon = 0.5): boolean {
  const s = trail.samples;
  if (s.length < 2) return false;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of s) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return (maxX - minX) > epsilon || (maxY - minY) > epsilon;
}

/**
 * The trails as an SVG overlay in DESIGN coordinates — the caller scales it the
 * same way it scales the design, so the trail lands on the artwork.
 *
 * Ghost boxes fade toward the present: the earliest sample is faintest, so the
 * direction of travel is readable without an arrowhead.
 */
export function trailsSVG(trails: LayerTrail[], docW: number, docH: number, accent = '#7C5CFF'): string {
  if (!trails.length) return '';
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${docW}" height="${docH}" viewBox="0 0 ${docW} ${docH}" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">`,
  ];
  for (const tr of trails) {
    const cs = tr.samples.map(s => `${(s.x + s.w / 2).toFixed(1)},${(s.y + s.h / 2).toFixed(1)}`).join(' ');
    parts.push(`<polyline points="${cs}" fill="none" stroke="${accent}" stroke-width="1.5" stroke-opacity="0.55" stroke-dasharray="5 4"/>`);
    tr.samples.forEach((s, i) => {
      const k = i / Math.max(1, tr.samples.length - 1);
      if (s.w > 0 && s.h > 0) {
        parts.push(`<rect x="${s.x.toFixed(1)}" y="${s.y.toFixed(1)}" width="${s.w.toFixed(1)}" height="${s.h.toFixed(1)}" fill="none" stroke="${accent}" stroke-opacity="${(0.10 + 0.35 * k).toFixed(3)}" stroke-width="1"/>`);
      }
      parts.push(`<circle cx="${(s.x + s.w / 2).toFixed(1)}" cy="${(s.y + s.h / 2).toFixed(1)}" r="${i === 0 || i === tr.samples.length - 1 ? 3.5 : 2}" fill="${accent}" fill-opacity="${(0.25 + 0.6 * k).toFixed(3)}"/>`);
    });
  }
  parts.push('</svg>');
  return parts.join('');
}
