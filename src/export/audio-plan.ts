/**
 * A video's sound on the piece's timeline — the design's tracks (music under
 * every scene) and each page's cues (a sound that starts with its scene).
 *
 * Pure and browser-safe. The export mixes these clips with ffmpeg
 * (audio-mux.ts) and Play all schedules the same clips in WebAudio, so the file
 * and the stage play one plan. The engine decides no timing: it places what the
 * design says, cuts at the piece's end, and NOTES what a listener would notice —
 * music cut off with no fade, silence after a track runs out.
 */

import type { AudioCue, AudioTrack, DesignSpec } from '../schema/types';
import { videoSoundClips } from './video-sound';

export interface SoundClip {
  id: string;
  src: string;
  /** The page a cue belongs to; absent for a design track. */
  scene?: string;
  /** When it starts sounding, ms on the piece's timeline. */
  start_ms: number;
  /** Where in the file it starts, ms. */
  offset_ms: number;
  /** How long it sounds, ms — already cut at the piece's end. */
  length_ms: number;
  volume: number;
  fade_in_ms: number;
  fade_out_ms: number;
  loop: boolean;
  /** The piece ended before the sound did. */
  cut: boolean;
  /** A video layer's clip played faster or slower (absent = 1): file time runs `speed`× piece time. */
  speed?: number;
}

export interface SoundPlan { clips: SoundClip[]; total_ms: number; notes: string[] }

/** What a sound plan needs from a piece: its length and where each scene starts. */
export interface SoundTimeline { total_ms: number; scenes: Array<{ page_id: string; start_ms: number }> }

/** File lengths by src, ms. A src missing here has an unknown length. */
export type SoundDurations = Record<string, number | undefined>;

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** A design track that goes quiet before the piece ends, and what to say if nothing else plays on. */
interface EarlyEnd { end: number; note: string }

function placeClip(
  raw: AudioTrack | AudioCue, id: string, start: number, total: number, durations: SoundDurations, notes: string[], scene?: string,
  early?: EarlyEnd[],
): SoundClip | null {
  const src = typeof raw.src === 'string' ? raw.src.trim() : '';
  if (!src) { notes.push(`Sound "${id}" has no src, so it was left out.`); return null; }
  if (start >= total) { notes.push(`Sound "${id}" starts at ${secs(start)}, after the piece ends at ${secs(total)}.`); return null; }
  const offset = Math.max(0, num(raw.offset, 0));
  const loop = raw.loop === true;
  const file = durations[src];
  const rest = file === undefined ? undefined : file - offset;
  if (rest !== undefined && rest <= 0 && !loop) {
    notes.push(`Sound "${id}" starts ${secs(offset)} into a ${secs(file ?? 0)} file, so nothing is left to play.`);
    return null;
  }
  const asked = num(raw.duration, 0) > 0 ? num(raw.duration, 0) : undefined;
  // A looping sound runs as long as it is asked to (or to the end); otherwise the file ends it.
  const natural = loop ? asked ?? Infinity : Math.min(asked ?? Infinity, rest ?? Infinity);
  const room = total - start;
  const length = Math.min(natural, room);
  const cut = natural > room;
  const volume = Math.min(1, Math.max(0, num(raw.volume, 1)));
  const fadeIn = Math.min(length, Math.max(0, num(raw.fade_in, 0)));
  const fadeOut = Math.min(length - fadeIn, Math.max(0, num(raw.fade_out, 0)));

  if (cut && fadeOut === 0 && Number.isFinite(natural)) {
    notes.push(`Sound "${id}" is cut off at ${secs(total)}, the end of the piece, with no fade — fade_out (e.g. 800) ends it softly.`);
  } else if (cut && fadeOut === 0 && loop) {
    notes.push(`Looping sound "${id}" stops dead at ${secs(total)} — fade_out (e.g. 800) ends it softly.`);
  }
  if (!scene && !loop && rest !== undefined && start + rest < total) {
    early?.push({ end: start + rest, note: `Track "${id}" runs out at ${secs(start + rest)}; the last ${secs(total - start - rest)} of the piece has no music. loop:true repeats it.` });
  }
  // Live: a bed given duration = the piece's length went silent 3.6 s early once the scenes grew, and nothing said so.
  if (!scene && asked !== undefined && start + length < total && (loop || rest === undefined || asked < rest)) {
    early?.push({ end: start + length, note: `Track "${id}" stops at ${secs(start + length)} because duration is ${Math.round(asked)}ms; the last ${secs(total - start - length)} of the piece has no music. Set duration to ${Math.round(total - start)}, or leave it out to play to the end.` });
  }
  if (rest === undefined && asked === undefined && !loop) {
    notes.push(`The length of "${src}" is not known here, so "${id}" is planned to the end of the piece.`);
  }
  return {
    id, src, ...(scene ? { scene } : {}), start_ms: start, offset_ms: offset, length_ms: length,
    volume, fade_in_ms: fadeIn, fade_out_ms: fadeOut, loop, cut,
  };
}

/** Whether any clip is sounding at piece time t — a track that ends where nothing else plays opens a gap. */
function soundingAt(clips: SoundClip[], t: number): boolean {
  return clips.some(c => c.start_ms <= t && c.start_ms + c.length_ms > t);
}

/** Every sound of the piece as clips on its timeline, with what a listener would notice. */
export function planSound(spec: DesignSpec, timeline: SoundTimeline, durations: SoundDurations = {}): SoundPlan {
  const notes: string[] = [];
  const clips: SoundClip[] = [];
  const total = Math.max(0, timeline.total_ms);
  // A track that ends early only leaves the piece quiet if nothing else plays on
  // to the end. Found live: a poster's twelve half-second whooshes and pops,
  // under a bed that ran the whole piece, each drew "the last 52 s has no music".
  const early: EarlyEnd[] = [];
  (spec.audio ?? []).forEach((track, i) => {
    const id = typeof track.id === 'string' && track.id ? track.id : `track-${i + 1}`;
    const clip = placeClip(track, id, Math.max(0, num(track.start_time, 0)), total, durations, notes, undefined, early);
    if (clip) clips.push(clip);
  });
  for (const e of early) if (!soundingAt(clips, e.end + 1)) notes.push(e.note);
  // A video layer's own sound (video-sound.ts): with its scene, or from 0 on a one-page piece.
  if (spec.pages?.length) {
    for (const scene of timeline.scenes) clips.push(...videoSoundClips((spec.pages.find(p => p.id === scene.page_id)?.layers) ?? [], scene.start_ms, total, durations));
  } else clips.push(...videoSoundClips(spec.layers ?? [], 0, total, durations));
  for (const scene of timeline.scenes) {
    const page = (spec.pages ?? []).find(p => p.id === scene.page_id);
    (page?.audio_cues ?? []).forEach((cue, j) => {
      const id = typeof cue.id === 'string' && cue.id ? cue.id : `${scene.page_id}-cue-${j + 1}`;
      const clip = placeClip(cue, id, scene.start_ms + Math.max(0, num(cue.at, 0)), total, durations, notes, scene.page_id);
      if (clip) clips.push(clip);
    });
  }
  return { clips, total_ms: total, notes };
}

/** How loud a clip is at piece time t: its volume under linear fades (ffmpeg afade's default curve); 0 outside it. */
export function clipGain(c: SoundClip, t: number): number {
  const local = t - c.start_ms;
  if (local < 0 || local > c.length_ms) return 0;
  let g = c.volume;
  if (c.fade_in_ms > 0 && local < c.fade_in_ms) g *= local / c.fade_in_ms;
  const tail = c.length_ms - local;
  if (c.fade_out_ms > 0 && tail < c.fade_out_ms) g *= tail / c.fade_out_ms;
  return g;
}

/** Where in its file a clip is at piece time t, ms. A loop restarts from the file's start. */
export function clipFilePosition(c: SoundClip, t: number, fileMs?: number): number {
  const pos = c.offset_ms + Math.max(0, t - c.start_ms) * (c.speed ?? 1);
  return c.loop && fileMs !== undefined && fileMs > 0 && pos >= fileMs ? pos % fileMs : pos;
}
