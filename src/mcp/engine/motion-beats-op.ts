/**
 * animation(op:beats) — the soundtrack's timing grid, on the piece's timeline.
 *
 * Measures the music (audio-analyze.ts) and answers in PIECE time: each beat
 * where it sounds under the scenes, the sharpest onsets, and for each scene the
 * length that would end it on its nearest beat. It writes nothing. Cutting on
 * the beat is a choice, made with op:scene length_ms.
 */

import * as fs from 'fs';
import type { DesignSpec } from '../../schema/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, readYAML, errResult, okResult } from './utils';
import { planScenes } from '../../export/scene-plan';
import type { SoundClip } from '../../export/audio-plan';
import { tryFfmpeg } from '../../export/animation-export';
import { resolveSound } from './sound-resolve';
import { soundTimeline } from './motion-audio-op';
import { analyzeAudioFile } from './audio-analyze';

export type BeatsArgs = { design_path: string; project_path?: string; audio_id?: unknown; hold_ms?: number };

const OP = 'beats';
const MAX_BEATS = 400;

/** Times in a file, placed where the clip sounds them on the piece — every pass of a loop. */
export function beatsOnPiece(clip: SoundClip, fileTimes: number[], fileMs: number): number[] {
  const out: number[] = [];
  const end = clip.start_ms + clip.length_ms;
  // Piece time of the file's 0 ms on this pass: the first pass starts at the offset, later ones at 0.
  let passStart = clip.start_ms - clip.offset_ms;
  for (let pass = 0; passStart < end && pass < 1000; pass++) {
    for (const t of fileTimes) {
      const at = passStart + t;
      if (at >= clip.start_ms && at <= end) out.push(Math.round(at));
    }
    if (!clip.loop || fileMs <= 0) break;
    passStart += fileMs;
  }
  return out;
}

export interface BeatSnap { page_id: string; length_ms: number; on_beat_ms: number; moved_ms: number; longer_for?: 'reading' | 'motion' }

/**
 * For each scene in order, the length that ends it on the nearest beat — each counting the changes
 * before it — but never one the scene plan then warns about: not shorter than its motion or its
 * reading time, unless it is already shorter. Live, on the GPT-6 Astra promo, the nearest beat
 * took a stats scene under its reading time and cut the opener's camera push.
 */
export function snapLengths(
  scenes: Array<{ page_id: string; start_ms: number; length_ms: number; motion_ms?: number; read_ms?: number }>, beats: number[],
): BeatSnap[] {
  let shift = 0;
  return scenes.map(s => {
    const start = s.start_ms + shift;
    const end = start + s.length_ms;
    const nearestFrom = (min: number): number => {
      let nearest = Infinity;
      for (const b of beats) if (b - start >= min && Math.abs(b - end) < Math.abs(nearest - end)) nearest = b;
      return nearest;
    };
    const motion = s.motion_ms ?? 0;
    const read = s.read_ms ?? 0;
    const free = nearestFrom(100);
    const kept = nearestFrom(Math.max(100, Math.min(s.length_ms, Math.max(motion, read))));
    const onBeat = Number.isFinite(kept) ? Math.round(kept - start) : s.length_ms;
    shift += onBeat - s.length_ms;
    const longer = Number.isFinite(free) && free !== kept ? (read >= motion ? 'reading' : 'motion') : undefined;
    return { page_id: s.page_id, length_ms: s.length_ms, on_beat_ms: onBeat, moved_ms: onBeat - s.length_ms, ...(longer ? { longer_for: longer } : {}) };
  });
}

/** The beat grid under the scene cuts, as text on op:timeline's scale. */
export function renderBeatsASCII(total: number, beats: number[], cuts: number[], width = 56): string {
  const col = (ms: number): number => Math.min(width - 1, Math.max(0, Math.round((ms / Math.max(1, total)) * (width - 1))));
  const ruler = Array<string>(width).fill(' ');
  beats.forEach((b, i) => { const c = col(b); if (ruler[c] !== '|') ruler[c] = i % 4 === 0 ? '|' : '·'; });
  const marks = Array<string>(width).fill(' ');
  for (const ms of cuts) marks[col(ms)] = '▼';
  return [`Beats over ${total}ms · | every 4th beat · ▼ scene cut`, `cuts  ${marks.join('')}`, `beats ${ruler.join('')}`].join('\n');
}

export async function beatsMotion(args: BeatsArgs): Promise<ToolResult> {
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(OP, `Design not found: ${dPath}`, 'Check design_path.');
  if (!tryFfmpeg()) return errResult(OP, 'Measuring beats needs ffmpeg to decode the music, and this host has none.', 'Install ffmpeg (the Docker image ships it).');
  const spec = readYAML<DesignSpec>(dPath);
  const timeline = soundTimeline(spec, args.hold_ms);
  const sound = resolveSound(spec, dPath, timeline, args.project_path);
  const wanted = typeof args.audio_id === 'string' && args.audio_id ? args.audio_id : undefined;
  const clip = sound.clips.find(c => (wanted ? c.id === wanted : !c.scene)) ?? (wanted ? undefined : sound.clips[0]);
  if (!clip) {
    return errResult(OP, wanted ? `No sound "${wanted}" plays in this piece.` : 'This piece has no sound to measure.',
      'Add music with animation(op:audio, src:"assets/audio/…"). op:audio with no src lists what plays and its ids.');
  }
  let map;
  try {
    map = await analyzeAudioFile(clip.file);
  } catch (e) {
    return errResult(OP, `Could not measure "${clip.src}": ${(e as Error).message}`, 'animation(op:audio) lists each file with its length; store a file that plays.');
  }

  const pulse = map.confidence >= 0.4 ? 'steady' : map.confidence >= 0.2 ? 'weak' : 'none';
  const fileMs = sound.durations[clip.src] ?? map.duration_ms;
  // Snap against the music as far as it plays, not only as far as the piece now runs: live, the
  // last scene was told to SHRINK by 694 ms because the next beat sat past the piece's current end.
  const reach = clip.loop ? Math.max(clip.length_ms, timeline.total_ms) * 2 : Math.max(clip.length_ms, fileMs - clip.offset_ms);
  const grid = beatsOnPiece({ ...clip, length_ms: reach }, map.beats_ms, fileMs);
  const beats = grid.filter(b => b <= clip.start_ms + clip.length_ms);
  const onsets = beatsOnPiece(clip, map.onsets_ms, fileMs).slice(0, 64);
  const scenes = (spec.pages?.length ?? 0) >= 2 ? planScenes(spec, { hold_ms: args.hold_ms }).scenes : [];
  const snaps = pulse === 'none' ? [] : snapLengths(scenes, grid);
  const firstMove = snaps.find(s => s.moved_ms !== 0);
  const notes = [
    ...(pulse === 'none' ? [`"${clip.id}" has no steady pulse (confidence ${map.confidence}), so no scene lengths are offered: cut on its onsets, or on the scenes' own motion.`] : []),
    ...(pulse === 'weak' ? [`"${clip.id}" has a weak pulse (confidence ${map.confidence}): hear the grid in Play all before cutting to it.`] : []),
    'Bars assume 4 beats, and the first beat found is not necessarily a downbeat.',
  ];
  return okResult(OP, {
    design_path: dPath, audio_id: clip.id, src: clip.src,
    bpm: map.bpm, beat_ms: map.beat_ms, bar_ms: Math.round(map.beat_ms * 4), confidence: map.confidence, pulse,
    total_ms: timeline.total_ms,
    beats_ms: beats.slice(0, MAX_BEATS), ...(beats.length > MAX_BEATS ? { beats_total: beats.length } : {}),
    onsets_ms: onsets,
    ...(snaps.length ? { scenes_on_beat: snaps } : {}),
    ascii: renderBeatsASCII(timeline.total_ms, beats, scenes.slice(1).map(s => s.start_ms)),
    notes,
    ...(firstMove ? {
      next_action: {
        tool: 'animation', params: { op: 'scene', design_path: dPath, page_id: firstMove.page_id, length_ms: firstMove.on_beat_ms },
        remaining: snaps.filter(s => s.moved_ms !== 0).length,
        hint: 'Each on_beat_ms ends that scene on its nearest beat that still fits its motion and reading time (longer_for says when a later beat was taken), counting the scenes before it as changed: apply them in order with op:scene — or keep a cut where the story wants it.',
      },
    } : {}),
  });
}
