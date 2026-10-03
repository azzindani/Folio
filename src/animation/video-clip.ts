// A clip's edits on both clocks — the one place the arithmetic lives.
//
// Pure and browser-safe: animation(op:video) on the server and the editor's
// clip track both cut, trim and lay clips with these, so a split made by
// dragging and one made by the model leave the same two layers.

import type { Layer } from '../schema/types';
import { naturalLength, rampKeys, fileOffsetAt, edgeRates, shiftRamp, type VideoTiming } from './video-time';
import type { ClipTransition } from './clip-transition';
import { baseCrop, hasCrop, panKeys } from './clip-crop';
import { colorOf, type ClipColor } from './clip-color';

export type ClipLayer = Layer & {
  in?: number; out?: number; src?: string; layers?: Layer[];
  video?: VideoTiming & ClipSound;
};

/** How a clip sounds at its edges (export/video-sound.ts mixes it): fades, and sound before (J) or after (L) its picture. */
export interface ClipSound { volume?: number; muted?: boolean; fade_in_ms?: number; fade_out_ms?: number; audio_lead_ms?: number; audio_tail_ms?: number;
  /** How it enters from the clip that ends where it starts (clip-transition.ts). */
  transition?: ClipTransition }

/** Fields that belong to a clip's START edge (its transition in among them), and to its END edge — a cut keeps each with its own half. */
const START_SOUND = ['fade_in_ms', 'audio_lead_ms', 'transition'] as const;
const END_SOUND = ['fade_out_ms', 'audio_tail_ms'] as const;
const without = (v: ClipLayer['video'], keys: readonly string[]): NonNullable<ClipLayer['video']> =>
  Object.fromEntries(Object.entries(v ?? {}).filter(([k]) => !keys.includes(k)));

export interface ClipSummary {
  id: string;
  /** When it plays, on the scene clock. `until` is null for a loop or an unknown length. */
  plays: { from: number; until: number | null };
  /** Which part of the file that is, ms. */
  file: { from: number; to: number | null };
  speed: number; volume: number; muted: boolean; loop: boolean;
  /** Edge sound when any is set: fades, and how far the sound leads or trails the picture, ms. */
  sound?: { fade_in_ms?: number; fade_out_ms?: number; lead_ms?: number; tail_ms?: number };
  transition?: ClipTransition;
  /** Pan and zoom inside the footage when set: where it rests, and how many pan keys move it. */
  crop?: { focus: [number, number]; zoom: number; pan_keys?: number };
  /** A freeze: one frame held for its length. */
  still?: true;
  /** The clip's grade when it has one. */
  color?: ClipColor;
  /** Speed keys when the clip ramps. */
  ramp?: Array<{ at_ms: number; speed: number }>;
}

/** Shortest a trim leaves a clip, ms on the scene clock. */
export const MIN_CLIP_MS = 100;

export function summarize(l: ClipLayer): ClipSummary {
  const v = l.video ?? {};
  const speed = Number(v.speed) > 0 ? Number(v.speed) : 1;
  const offset = Math.max(0, Number(v.offset_ms) || 0);
  const used = Number(v.duration_ms) > 0 ? Number(v.duration_ms) : null;
  const from = Number(l.in) || 0;
  // How long it plays: at its speed, along its ramp, or — a still — the hold itself (video-time.ts).
  const length = naturalLength(v);
  const natural = length !== null ? from + length : null;
  const until = natural !== null && typeof l.out === 'number' ? Math.min(natural, l.out) : natural ?? (typeof l.out === 'number' ? l.out : null);
  return {
    id: l.id, plays: { from, until: until === null ? null : Math.round(until) },
    file: { from: offset, to: v.still ? offset : used === null ? null : offset + used },
    speed, volume: Math.min(1, Math.max(0, Number(v.volume ?? 1))), muted: v.muted === true, loop: v.loop === true,
    ...edgeSound(v), ...(v.transition ? { transition: v.transition } : {}),
    ...(hasCrop(l) ? { crop: { ...baseCrop(l), ...(panKeys(l).length ? { pan_keys: panKeys(l).length } : {}) } } : {}),
    ...(v.still ? { still: true as const } : {}), ...(rampKeys(v).length ? { ramp: rampKeys(v) } : {}),
    ...(colorOf(l) ? { color: colorOf(l) as ClipColor } : {}),
  };
}

function edgeSound(v: ClipSound): Pick<ClipSummary, 'sound'> {
  const pick = (n: unknown): number | undefined => (Number(n) > 0 ? Math.round(Number(n)) : undefined);
  const sound = Object.fromEntries(Object.entries({ fade_in_ms: pick(v.fade_in_ms), fade_out_ms: pick(v.fade_out_ms), lead_ms: pick(v.audio_lead_ms), tail_ms: pick(v.audio_tail_ms) })
    .filter(([, n]) => n !== undefined));
  return Object.keys(sound).length ? { sound } : {};
}

/** Split a clip at scene time t: the first half ends there, the second starts there, from the frame the first stopped on. */
export function cutClip(l: ClipLayer, t: number, secondId: string): ClipLayer[] | string {
  const s = summarize(l);
  if (!(t > s.plays.from) || (s.plays.until !== null && t >= s.plays.until)) {
    return `split_at ${Math.round(t)}ms is not while "${l.id}" plays (${s.plays.from}–${s.plays.until ?? '…'}ms).`;
  }
  // A still splits into two holds of its one frame; a ramp's second half takes its keys from the cut on.
  const v = l.video ?? {}, local = t - s.plays.from;
  const used = Math.round(v.still ? local : fileOffsetAt(v, local));
  const total = Number(v.duration_ms) > 0 ? Number(v.duration_ms) : null;
  const rest = total === null ? undefined : Math.max(1, total - used);
  const first: ClipLayer = { ...l, out: Math.round(t), video: { ...without(l.video, END_SOUND), duration_ms: used } };
  const second: ClipLayer = { ...l, id: secondId, in: Math.round(t),
    video: shiftRamp({ ...without(l.video, START_SOUND), offset_ms: v.still ? s.file.from : s.file.from + used, ...(rest !== undefined ? { duration_ms: rest } : {}) }, -local) };
  if (typeof l.out === 'number') second.out = l.out; else delete second.out;
  return [first, second];
}

/** The two halves of a clip split at scene time t, or [] when t is not while it plays. */
export function splitClip(l: ClipLayer, t: number, secondId: string): ClipLayer[] {
  const halves = cutClip(l, t, secondId);
  return typeof halves === 'string' ? [] : halves;
}

/**
 * Drag an edge to scene time t. The start edge skips (or brings back) footage —
 * in, offset and length move together, so the frames that stay keep their
 * place; the end edge changes the length. Clamped to the file (`fileMs` when
 * known) and to MIN_CLIP_MS.
 */
export function trimClip(l: ClipLayer, edge: 'start' | 'end', t: number, fileMs?: number | null): ClipLayer {
  const s = summarize(l);
  const v = l.video ?? {};
  const total = Number(v.duration_ms) > 0 ? Number(v.duration_ms) : null;
  const until = s.plays.until ?? s.plays.from + (naturalLength(v) ?? MIN_CLIP_MS);
  if (edge === 'start') {
    const start = edgeRates(v, 0);
    // The file before its offset, in scene ms at the speed it starts with (a still's frame stays put: no limit).
    const earliest = start.file > 0 ? s.plays.from - s.file.from / start.file : -Infinity;
    const at = Math.round(Math.min(Math.max(t, earliest, 0), until - MIN_CLIP_MS));
    const local = at - s.plays.from;
    // Trimming in plays along its curve; bringing footage back runs at the speed it starts with.
    const fileD = v.still ? 0 : local >= 0 ? fileOffsetAt(v, local) : local * start.file;
    const lengthD = v.still ? local : fileD;
    const offset = Math.max(0, Math.round(s.file.from + fileD));
    const next = shiftRamp({ ...v, offset_ms: offset, ...(total !== null ? { duration_ms: Math.max(1, Math.round(total - lengthD)) } : {}) }, -local);
    return { ...l, in: at, video: next };
  }
  const room = v.still || !fileMs ? Infinity : s.plays.from + (naturalLength({ ...v, duration_ms: Math.max(1, fileMs - s.file.from), loop: false }) ?? Infinity);
  const at = Math.round(Math.min(Math.max(t, s.plays.from + MIN_CLIP_MS), room));
  const local = at - s.plays.from;
  const next: ClipLayer = { ...l, video: { ...v, duration_ms: Math.max(1, Math.round(v.still ? local : fileOffsetAt(v, local))) } };
  if (typeof l.out === 'number') next.out = at;
  return next;
}
