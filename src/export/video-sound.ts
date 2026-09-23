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
 */

import type { Layer } from '../schema/types';
import { resolveTimeline } from '../animation/timeline-resolve';
import type { SoundClip } from './audio-plan';

interface VideoNode { id: string; type: string; src?: string; in?: number; out?: number; layers?: VideoNode[];
  video?: { offset_ms?: number; duration_ms?: number; speed?: number; volume?: number; muted?: boolean; loop?: boolean } }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Every sounding video layer of a page, as clips starting `startMs` into the piece. */
export function videoSoundClips(layers: Layer[], startMs: number, totalMs: number, fileMs: Record<string, number | undefined> = {}): SoundClip[] {
  const out: SoundClip[] = [];
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
      const length = Math.min(natural, outMs - start, totalMs - start);
      if (!(length > 0)) continue;
      out.push({
        id: `${l.id}-sound`, src, start_ms: start, offset_ms: offset, length_ms: Math.round(length),
        volume: Math.min(1, Math.max(0, num(l.video?.volume) ?? 1)), fade_in_ms: 0, fade_out_ms: 0,
        loop, cut: natural > totalMs - start, ...(speed !== 1 ? { speed } : {}),
      });
    }
  };
  walk(resolveTimeline(layers) as unknown as VideoNode[]);
  return out;
}

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
