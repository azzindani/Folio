/**
 * A video layer's own sound, as clips on the piece's timeline.
 *
 * Pure and browser-safe, beside audio-plan.ts: a clip that carries sound plays
 * it from the layer's `in` point (the moment its first used frame shows,
 * video-time.ts), from `video.offset_ms` into the file, for as long as the
 * layer uses the clip — `duration_ms` of file time, and never past its `out`
 * point — at `speed` (the mix changes tempo to match) and `volume`. `muted`
 * leaves it silent. Times are the RESOLVED ones (precomp clocks applied), the
 * same the flipbook draws the frames at.
 *
 * Edges: a cut mid-waveform clicks, so every edge that is not the file's own
 * start or end fades over SEAM_FADE_MS; `fade_in_ms` / `fade_out_ms` ask for
 * longer. `audio_lead_ms` starts the sound before its picture (a J-cut) and
 * `audio_tail_ms` runs it on after (an L-cut), within the file and the scene.
 */

import type { Layer } from '../schema/types';
import { resolveTimeline } from '../animation/timeline-resolve';
import type { SoundClip } from './audio-plan';

interface VideoNode { id: string; type: string; src?: string; in?: number; out?: number; layers?: VideoNode[];
  video?: { offset_ms?: number; duration_ms?: number; speed?: number; volume?: number; muted?: boolean; loop?: boolean;
    fade_in_ms?: number; fade_out_ms?: number; audio_lead_ms?: number; audio_tail_ms?: number } }

/** The fade on a cut edge, ms: short enough to hear as a cut, long enough not to click. */
export const SEAM_FADE_MS = 12;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Every sounding video layer of a page, as clips starting `startMs` into the piece. */
export function videoSoundClips(layers: Layer[], startMs: number, totalMs: number, fileMs: Record<string, number | undefined> = {}): SoundClip[] {
  const out: Draft[] = [];
  const walk = (ls: VideoNode[]): void => {
    for (const l of ls) {
      if (Array.isArray(l.layers)) walk(l.layers);
      if (l.type !== 'video' || !l.src?.trim() || l.video?.muted === true) continue;
      const src = l.src.trim();
      const speed = (num(l.video?.speed) ?? 0) > 0 ? (num(l.video?.speed) ?? 1) : 1;
      const offset = Math.max(0, num(l.video?.offset_ms) ?? 0);
      const inMs = Math.max(0, num(l.in) ?? 0);
      const start = startMs + inMs;
      if (start >= totalMs) continue;
      const loop = l.video?.loop === true;
      const file = fileMs[src];
      const used = num(l.video?.duration_ms) ?? (file !== undefined && !loop ? Math.max(0, file - offset) : Infinity);
      // Piece time the clip sounds: its used part at speed, up to its out point and the end.
      const outMs = num(l.out) !== undefined ? startMs + (num(l.out) ?? 0) : Infinity;
      const natural = loop ? Infinity : used / speed;
      const pictureEnd = Math.min(start + natural, outMs);
      // J-cut: earlier on both clocks, never before the file's start or the scene's.
      const lead = Math.min(Math.max(0, num(l.video?.audio_lead_ms) ?? 0), offset / speed, start - startMs);
      // L-cut: on past the picture, while the file has sound left.
      const room = loop ? Infinity : file !== undefined ? Math.max(0, (file - offset - used) / speed) : Infinity;
      const tail = Math.min(Math.max(0, num(l.video?.audio_tail_ms) ?? 0), room);
      const from = start - lead, soundEnd = pictureEnd + tail;
      const length = Math.round(Math.min(soundEnd, totalMs) - from);
      if (!(length > 0)) continue;
      const fileFrom = offset - lead * speed;
      const toFileEnd = !loop && file !== undefined && fileFrom + length * speed >= file - 1;
      out.push({
        clip: {
          id: `${l.id}-sound`, src, start_ms: Math.round(from), offset_ms: Math.round(fileFrom), length_ms: length,
          volume: Math.min(1, Math.max(0, num(l.video?.volume) ?? 1)), fade_in_ms: 0, fade_out_ms: 0,
          loop, cut: soundEnd > totalMs, ...(speed !== 1 ? { speed } : {}),
        },
        askIn: num(l.video?.fade_in_ms) ?? 0, askOut: num(l.video?.fade_out_ms) ?? 0,
        seamIn: fileFrom > 0.5, seamOut: !toFileEnd,
      });
    }
  };
  walk(resolveTimeline(layers) as unknown as VideoNode[]);
  // A split the file plays straight through — the next clip picks up the same file where this
  // one stopped, at the same moment, speed and level — has no jump to hide: no dip there.
  for (const a of out) {
    for (const b of out) {
      const A = a.clip, B = b.clip;
      if (a === b || A.src !== B.src || A.loop || (A.speed ?? 1) !== (B.speed ?? 1) || A.volume !== B.volume) continue;
      if (Math.abs(A.start_ms + A.length_ms - B.start_ms) <= 1 && Math.abs(A.offset_ms + A.length_ms * (A.speed ?? 1) - B.offset_ms) <= 2) { a.seamOut = false; b.seamIn = false; }
    }
  }
  return out.map(({ clip, askIn, askOut, seamIn, seamOut }) => {
    const fadeIn = Math.min(Math.max(askIn, seamIn ? SEAM_FADE_MS : 0), clip.length_ms / 2);
    const fadeOut = Math.min(Math.max(askOut, seamOut ? SEAM_FADE_MS : 0), clip.length_ms - fadeIn);
    return { ...clip, fade_in_ms: Math.round(fadeIn), fade_out_ms: Math.round(fadeOut) };
  });
}

/** A clip's sound before its edges are settled: what was asked for, and which edges cut the waveform. */
interface Draft { clip: SoundClip; askIn: number; askOut: number; seamIn: boolean; seamOut: boolean }

/** Every src a video layer names, anywhere in the tree. */
export function videoSources(layers: Layer[] | undefined): string[] {
  const out: string[] = [];
  const walk = (ls: VideoNode[]): void => {
    for (const l of ls) {
      if (l.type === 'video' && l.src?.trim()) out.push(l.src.trim());
      if (Array.isArray(l.layers)) walk(l.layers);
    }
  };
  walk((layers ?? []) as unknown as VideoNode[]);
  return out;
}
