// A clip's edits on both clocks — the one place the arithmetic lives.
//
// Pure and browser-safe: animation(op:video) on the server and the editor's
// clip track both cut, trim and lay clips with these, so a split made by
// dragging and one made by the model leave the same two layers.

import type { Layer } from '../schema/types';
import type { VideoTiming } from './video-time';
import type { ClipTransition } from './clip-transition';
import { baseCrop, hasCrop, panKeys } from './clip-crop';

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
}

/** Shortest a trim leaves a clip, ms on the scene clock. */
export const MIN_CLIP_MS = 100;

export function summarize(l: ClipLayer): ClipSummary {
  const v = l.video ?? {};
  const speed = Number(v.speed) > 0 ? Number(v.speed) : 1;
  const offset = Math.max(0, Number(v.offset_ms) || 0);
  const used = Number(v.duration_ms) > 0 ? Number(v.duration_ms) : null;
  const from = Number(l.in) || 0;
  const natural = used !== null && !v.loop ? from + used / speed : null;
  const until = natural !== null && typeof l.out === 'number' ? Math.min(natural, l.out) : natural ?? (typeof l.out === 'number' ? l.out : null);
  return {
    id: l.id, plays: { from, until: until === null ? null : Math.round(until) },
    file: { from: offset, to: used === null ? null : offset + used },
    speed, volume: Math.min(1, Math.max(0, Number(v.volume ?? 1))), muted: v.muted === true, loop: v.loop === true,
    ...edgeSound(v), ...(v.transition ? { transition: v.transition } : {}),
    ...(hasCrop(l) ? { crop: { ...baseCrop(l), ...(panKeys(l).length ? { pan_keys: panKeys(l).length } : {}) } } : {}),
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
  const used = Math.round((t - s.plays.from) * s.speed);
  const rest = s.file.to === null ? undefined : Math.max(1, s.file.to - s.file.from - used);
  const first: ClipLayer = { ...l, out: Math.round(t), video: { ...without(l.video, END_SOUND), duration_ms: used } };
  const second: ClipLayer = { ...l, id: secondId, in: Math.round(t), video: { ...without(l.video, START_SOUND), offset_ms: s.file.from + used, ...(rest !== undefined ? { duration_ms: rest } : {}) } };
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
  const used = s.file.to === null ? null : s.file.to - s.file.from;
  const until = s.plays.until ?? (used !== null ? s.plays.from + used / s.speed : s.plays.from + MIN_CLIP_MS);
  if (edge === 'start') {
    const earliest = s.plays.from - s.file.from / s.speed;
    const at = Math.round(Math.min(Math.max(t, earliest, 0), until - MIN_CLIP_MS));
    const d = (at - s.plays.from) * s.speed;
    const offset = Math.max(0, Math.round(s.file.from + d));
    const v = { ...(l.video ?? {}), offset_ms: offset, ...(used !== null ? { duration_ms: Math.max(1, Math.round(used - (offset - s.file.from))) } : {}) };
    return { ...l, in: at, video: v };
  }
  const room = fileMs ? s.plays.from + (fileMs - s.file.from) / s.speed : Infinity;
  const at = Math.round(Math.min(Math.max(t, s.plays.from + MIN_CLIP_MS), room));
  const next: ClipLayer = { ...l, video: { ...(l.video ?? {}), duration_ms: Math.max(1, Math.round((at - s.plays.from) * s.speed)) } };
  if (typeof l.out === 'number') next.out = at;
  return next;
}
