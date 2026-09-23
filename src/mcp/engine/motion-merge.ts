/**
 * Merging one-shot timelines onto a single layer track.
 *
 * A layer has ONE keyframe track. An After-Effects-style scene wants a layer
 * to enter at 0ms, sit, then leave at 3s — two presets on one layer. This
 * module folds them into one track the ordinary CSS/GIF routes already play:
 * absolute times are re-based on the earliest frame, the gap between the
 * entrance's last frame and the exit's first is a no-op tween (both are rest
 * poses, so nothing moves), and each preset's easing moves onto its own
 * keyframes so two curves survive side by side.
 */

import type { AnimationSpec, Keyframe, EasingFunction, AnchorPoint } from '../../animation/types';

type Playback = NonNullable<AnimationSpec['playback']>;

/** A one-shot fragment as `expandPreset` returns it, with its start time. */
export interface Fragment {
  keyframes: Keyframe[];
  playback: Playback;
}

const isLoop = (f: { playback?: Playback } | undefined): boolean => f?.playback?.loop === true;

/** Absolute-time keyframes: t + delay, each carrying its segment easing. */
function absoluteFrames(f: Fragment): Keyframe[] {
  const delay = Math.max(0, f.playback.delay ?? 0);
  const easing: EasingFunction | undefined = f.playback.easing;
  const sorted = [...f.keyframes].sort((a, b) => a.t - b.t);
  return sorted.map((kf, i) => ({
    ...kf,
    t: kf.t + delay,
    // The last frame of a fragment leads into whatever comes next — always a
    // rest-to-rest hop, so linear keeps it invisible. Explicit per-frame
    // easing on the fragment wins over the fragment default.
    easing: kf.easing ?? (i === sorted.length - 1 ? 'linear' : easing),
  }));
}

const NOT_A_CHANNEL = new Set(['t', 'easing', 'hold', 'spring']);

/**
 * How two poses differ while the layer is seen ("opacity 1 → 0"), or null when
 * they meet. Only channels BOTH frames name: the engine tweens a channel between
 * the frames that set it, so one named by the later frame alone snaps at the
 * gap's end rather than drifting across it (a morph ahead of a fade-in).
 */
function poseGap(from: Keyframe, to: Keyframe): string | null {
  const f = from as unknown as Record<string, unknown>, g = to as unknown as Record<string, unknown>;
  const opa = (r: Record<string, unknown>): number => (typeof r['opacity'] === 'number' ? r['opacity'] as number : 1);
  if (opa(f) <= 0.01 && opa(g) <= 0.01) return null;
  const diffs: string[] = [];
  for (const c of Object.keys(f)) {
    const x = f[c], y = g[c];
    if (NOT_A_CHANNEL.has(c) || typeof x !== 'number' || typeof y !== 'number') continue;
    if (Math.abs(x - y) <= (c === 'opacity' || c.startsWith('scale') ? 0.01 : 0.5)) continue;
    diffs.push(`${c} ${+x.toFixed(2)} → ${+y.toFixed(2)}`);
  }
  return diffs.length ? diffs.join(', ') : null;
}

export class MergeError extends Error {
  constructor(message: string, public hint: string) { super(message); this.name = 'MergeError'; }
}

/**
 * Combine an existing animation with a new fragment. Both must be one-shots:
 * a loop has no end to sequence after, and a loop on top of an entrance would
 * need two tracks. Returns the merged AnimationSpec.
 */
export function mergeFragment(existing: AnimationSpec | undefined, add: Fragment): AnimationSpec {
  const hasExisting = !!existing?.keyframes?.length;
  if (!hasExisting) return { keyframes: add.keyframes, playback: add.playback };

  if (isLoop(existing) || isLoop(add)) {
    throw new MergeError(
      'A layer carries one track: a loop cannot be sequenced with another motion on the same layer.',
      'Give the loop its own layer (a wrapper group works), or clear the layer first with animation(op:clear).',
    );
  }
  const ex = existing as AnimationSpec & { playback: Playback };
  const exPb: Playback = ex.playback ?? { duration: Math.max(...(ex.keyframes ?? []).map(k => k.t), 1) };
  const a = absoluteFrames({ keyframes: ex.keyframes ?? [], playback: exPb });
  const b = absoluteFrames(add);

  // Two fragments overlapping in time on one layer is a real conflict, not a
  // merge: the later frames would overwrite the earlier poses at the same
  // instants. Say so instead of producing a jumble.
  const aEnd = Math.max(...a.map(k => k.t)), bStart = Math.min(...b.map(k => k.t));
  const bEnd = Math.max(...b.map(k => k.t)), aStart = Math.min(...a.map(k => k.t));
  if (bStart < aEnd && aStart < bEnd) {
    throw new MergeError(
      `Motions overlap on this layer (${aStart}–${aEnd}ms and ${bStart}–${bEnd}ms).`,
      'Move the second one later with `at`, or clear the layer and write one combined track with animation(op:track).',
    );
  }

  // The gap between two motions is a tween from the earlier one's last pose to
  // the later one's first — invisible only when the two agree: an entrance ends
  // at rest, an exit starts there. A second ENTRANCE does not: re-sequencing a
  // line to move its fade earlier kept the old one, and the line faded out over
  // the 4.5 s between them (A1b live check). Refused, naming the ways to say it.
  const [early, late] = aStart <= bStart ? [a, b] : [b, a];
  const from = early[early.length - 1], to = late[0];
  const drift = from && to ? poseGap(from, to) : null;
  if (drift && from && to) {
    throw new MergeError(
      `The motions on this layer do not meet: it would drift ${drift} over the ${Math.round(to.t - from.t)} ms between ${Math.round(from.t)} and ${Math.round(to.t)} ms.`,
      'To MOVE a motion, clear the layer first (animation op:clear) and sequence it again, or shift it with op:retime. To leave and come back, put an exit (fade_out, sink…) between two entrances.',
    );
  }

  const all = [...a, ...b].sort((x, y) => x.t - y.t);
  const start = all[0].t;
  const end = all[all.length - 1].t;
  const keyframes = all.map(k => ({ ...k, t: k.t - start }));

  // Origin must agree: mixing 'first' (absolute rest = first frame) with
  // 'offset' (deltas) would put the two halves in different coordinate spaces.
  const origin = exPb.origin ?? 'first';
  if (origin !== (add.playback.origin ?? 'first')) {
    throw new MergeError(
      'Existing track uses origin:"' + origin + '" but the new motion uses "' + (add.playback.origin ?? 'first') + '".',
      'Presets write origin:"offset". Rewrite the hand-authored track as offsets, or clear it first.',
    );
  }

  const anchor: AnchorPoint | undefined = add.playback.anchor ?? exPb.anchor;
  // A wipe keeps the side it uncovers from through a merge, as the pivot does.
  const revealFrom = add.playback.reveal_from ?? exPb.reveal_from;
  const pivot = add.playback.pivot ?? exPb.pivot;
  return {
    ...ex,
    keyframes,
    playback: {
      duration: Math.max(1, end - start),
      origin,
      ...(anchor ? { anchor } : {}),
      ...(pivot ? { pivot } : {}),
      ...(revealFrom ? { reveal_from: revealFrom } : {}),
      ...(start > 0 ? { delay: start } : {}),
      // Segment curves now live on the frames; the track default is irrelevant
      // but linear is the honest value for "no curve of its own".
      easing: 'linear',
    },
  };
}

/** Total length of a one-shot track, delay included. */
export function trackEnd(anim: AnimationSpec | undefined): number {
  if (!anim?.keyframes?.length) return 0;
  const pb = anim.playback;
  const delay = pb?.delay ?? 0;
  const dur = pb?.duration ?? Math.max(...anim.keyframes.map(k => k.t));
  return delay + dur;
}
