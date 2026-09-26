/**
 * The timeline's pure half — which layers play in time, how long the scene is,
 * the pose mapping and the keyframe edits. Kept apart from the panel so the
 * player, the canvas and the MCP engine can use it while the panel itself
 * loads on demand (the main bundle is at its budget).
 */

import { poseAt } from '../../animation/keyframe-css';
import type { Layer } from '../../schema/types';
import type { AnimationSpec, Keyframe } from '../../animation/types';

// ── Pure-function API (used by MCP engine + tests) ───────────

export interface TimelineTrack {
  layerId: string;
  layerName: string;
  keyframes: Keyframe[];
  duration: number;
}

export interface TimelineState {
  currentTime: number;   // ms
  duration: number;      // ms
  playing: boolean;
  tracks: TimelineTrack[];
}

/**
 * Every layer in the tree, depth first — with the layers that CARRY motion
 * first, and their nesting depth alongside.
 *
 * The timeline panel used to read `state.getCurrentLayers()`, which is
 * top-level only. Every MCP-authored design is ONE group (state.ts says so
 * itself, in the comment above `findLayer`), and `animation(op:sequence)` writes
 * its keyframes onto that group's CHILDREN — so the studio timeline was empty
 * for every design the engine produces, and exporting an HTML file was the only
 * way to watch a scene play. The write path (`state.updateLayer`) already
 * recursed; only the read path did not.
 */
export function flattenForTimeline(layers: Layer[], depth = 0): Array<{ layer: Layer; depth: number }> {
  const out: Array<{ layer: Layer; depth: number }> = [];
  for (const l of layers ?? []) {
    if (!l || typeof l !== 'object') continue;
    out.push({ layer: l, depth });
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) out.push(...flattenForTimeline(kids, depth + 1));
  }
  return out;
}

/**
 * A layer that plays in time: it has keyframes, travels a motion path, lives
 * in an in/out window, or follows another layer. A continuous composition's
 * link followers and windowed titles own no keyframes and were missing from
 * the timeline and from the player.
 */
export function playsInTime(l: Layer): boolean {
  const o = l as unknown as Record<string, unknown>;
  // Footage moves by itself: a page holding only a clip still plays (found live —
  // the Play button stayed hidden on a video-only page).
  // A motion rule plays the track it compiles to (renderer/resolve-motion.ts): a rule-only
  // design hid its Play button and a mixed one its rule rows.
  return (l.animation?.keyframes ?? []).length > 0 || l.animation?.rule !== undefined || Boolean(o['motion_path']) || Boolean(o['link'])
    || typeof o['in'] === 'number' || typeof o['out'] === 'number' || l.type === 'video'
    || (l.type === 'script' && typeof o['duration'] === 'number');
}
const hasMotion = playsInTime;

/**
 * What the timeline should show, given the current selection.
 *
 * No selection → the animated layers, wherever they live. That is the case the
 * panel got wrong: a design with a full scene on it showed nothing at all.
 * Nothing animated yet → the top level, so a layer can still be picked up and
 * given its first keyframe. A selection always wins, at any depth.
 */
export function timelineRows(layers: Layer[], selectedIds: string[]): Array<{ layer: Layer; depth: number }> {
  const all = flattenForTimeline(layers ?? []);
  if (selectedIds.length) return all.filter(r => selectedIds.includes(r.layer.id));
  const animated = all.filter(r => hasMotion(r.layer));
  return animated.length ? animated : all.filter(r => r.depth === 0);
}

/**
 * The scene's own length: the last keyframe of any animated layer, or the
 * last out point. A rough cut for before the sampler loads — the player then
 * uses the export's own clip length (animationDuration over the resolved tree).
 */
export function sceneDuration(layers: Layer[], fallback = 2000): number {
  let end = 0;
  for (const { layer } of flattenForTimeline(layers ?? [])) {
    const kfs = layer.animation?.keyframes ?? [];
    const delay = Number(layer.animation?.playback?.delay ?? 0) || 0;
    for (const kf of kfs) end = Math.max(end, delay + (Number(kf.t) || 0));
    const out = (layer as unknown as Record<string, unknown>)['out'];
    if (typeof out === 'number' && Number.isFinite(out)) end = Math.max(end, out);
  }
  return end > 0 ? Math.ceil(end) : fallback;
}

/** Build timeline tracks from layer list. */
export function buildTimelineTracks(
  layers: { id: string; label?: string; animation?: AnimationSpec }[],
): TimelineTrack[] {
  return layers
    .filter(l => l.animation?.keyframes !== undefined && (l.animation.keyframes ?? []).length > 0)
    .map(l => ({
      layerId: l.id,
      layerName: l.label ?? l.id,
      keyframes: l.animation!.keyframes!,
      duration: l.animation!.playback?.duration ?? 1000,
    }));
}

/** Get interpolated layer values at a given time. */
/**
 * The pose at time t — delegated to the ENGINE's sampler, not re-implemented.
 *
 * This used to lerp x/y/scale/rotation/opacity by hand and ignore `easing`
 * entirely, so the panel's scrubber disagreed with both the CSS player and the
 * exported frames: a keyframe eased "bounce" moved linearly here, and
 * skew/blur/draw/scale_x/scale_y did not move at all because the function had
 * no branch for them. poseAt is what the flipbook and the CSS route already
 * use, so using it is what makes the three agree.
 *
 * Signature kept: callers pass keyframes and a duration, and get the subset of
 * channels that actually differ from rest, which is what the panel displays.
 */
export function interpolateAtTime(
  keyframes: Keyframe[],
  t: number,
  duration: number,
): Partial<Keyframe> {
  if (keyframes.length === 0) return {};
  const clampedT = Math.max(0, Math.min(duration, t));
  const pose = poseAt({ keyframes, playback: { duration } } as unknown as AnimationSpec, clampedT);
  // Report the channels the keyframes actually USE. Filtering by "differs from
  // rest" instead would drop a deliberate opacity of 1 at the end of a fade,
  // which is exactly the value a caller asks for when it asks for the pose.
  const used = new Set<string>();
  for (const kf of keyframes) {
    for (const [k, v] of Object.entries(kf)) if (k !== 't' && typeof v === 'number') used.add(k);
  }
  const out: Partial<Keyframe> = { t: clampedT };
  for (const [k, v] of Object.entries(pose)) {
    if (used.has(k) && typeof v === 'number') (out as Record<string, number>)[k] = v;
  }
  return out;
}


/**
 * The layer fields a pose maps onto, for a live scrub preview.
 *
 * Kept pure and exported so the mapping is testable without a DOM: the panel
 * only decides WHEN to apply it. x/y are offsets from the authored position —
 * the same convention the flipbook uses — so a preview and an exported frame
 * put the layer in the same place.
 */
export function poseToLayerUpdate(base: Layer, pose: Partial<Keyframe>): Partial<Layer> {
  const b = base as unknown as Record<string, unknown>;
  const n = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const p = pose as unknown as Record<string, number | undefined>;
  const out: Record<string, unknown> = {};
  if (p['x'] !== undefined) out['x'] = (n(b['x']) ?? 0) + p['x'];
  if (p['y'] !== undefined) out['y'] = (n(b['y']) ?? 0) + p['y'];
  if (p['opacity'] !== undefined) out['opacity'] = p['opacity'];
  if (p['rotation'] !== undefined) out['rotation'] = (n(b['rotation']) ?? 0) + p['rotation'];
  const sx = p['skew_x'] ?? 0, sy = p['skew_y'] ?? 0;
  if (sx !== 0 || sy !== 0) {
    const cx = (n(b['x']) ?? 0) + (n(b['width']) ?? 0) / 2;
    const cy = (n(b['y']) ?? 0) + (n(b['height']) ?? 0) / 2;
    out['transform'] = `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) skewX(${sx.toFixed(3)}) skewY(${sy.toFixed(3)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`;
  }
  if (p['blur'] !== undefined && p['blur'] > 0) {
    const fx = (b['effects'] ?? {}) as Record<string, unknown>;
    out['effects'] = { ...fx, blur: p['blur'] };
  }
  return out as Partial<Layer>;
}

/** Render ASCII timeline preview (for MCP output). */
export function renderTimelineASCII(tracks: TimelineTrack[], width = 60): string {
  if (tracks.length === 0) return '(no animated layers)';
  const maxDuration = Math.max(...tracks.map(t => t.duration));
  const lines: string[] = [`Timeline (${maxDuration}ms)`, '─'.repeat(width)];

  for (const track of tracks) {
    const bar = Array<string>(width).fill('·');
    for (const kf of track.keyframes) {
      const pos = Math.min(width - 1, Math.round(((kf.t ?? 0) / maxDuration) * (width - 1)));
      bar[pos] = '◆';
    }
    const label = (track.layerName + ' ').padEnd(12).slice(0, 12);
    lines.push(`${label}|${bar.join('')}|`);
  }
  lines.push('─'.repeat(width));
  return lines.join('\n');
}

/** Add or replace a keyframe in an AnimationSpec (immutable). */
export function addKeyframe(anim: AnimationSpec, kf: Keyframe): AnimationSpec {
  const existing = anim.keyframes ?? [];
  const merged = [...existing.filter(k => k.t !== kf.t), kf].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  return { ...anim, keyframes: merged };
}

/** Remove a keyframe at a given time (immutable). */
export function removeKeyframe(anim: AnimationSpec, t: number): AnimationSpec {
  return { ...anim, keyframes: (anim.keyframes ?? []).filter(k => k.t !== t) };
}

/**
 * Set the easing ON ONE keyframe — the curve from THAT keyframe to the next.
 *
 * Per-keyframe, not per-track: the engine reads `easing` off the keyframe a
 * segment starts at, so setting it on the last one changes nothing and setting
 * it on the track would flatten a sequence that deliberately eases differently
 * on the way in and on the way out. `''` clears it back to the track default.
 */
export function setKeyframeEasing(anim: AnimationSpec, t: number, easing: string): AnimationSpec {
  return {
    ...anim,
    keyframes: (anim.keyframes ?? []).map(k => {
      if (k.t !== t) return k;
      const next = { ...k } as Record<string, unknown>;
      if (easing) next['easing'] = easing; else delete next['easing'];
      return next as Keyframe;
    }),
  };
}

/**
 * Shift every keyframe later by `delayMs` — the panel's `op:sequence`.
 *
 * A sequence is layers doing the same thing at staggered starts, so applied
 * across a selection with an increasing delay per layer it IS the stagger.
 * Negative delays clamp at zero rather than running before the scene starts,
 * which would silently drop the head of the animation.
 */
export function shiftKeyframes(anim: AnimationSpec, delayMs: number): AnimationSpec {
  return {
    ...anim,
    keyframes: (anim.keyframes ?? [])
      .map(k => ({ ...k, t: Math.max(0, k.t + delayMs) }))
      .sort((a, b) => a.t - b.t),
  };
}
