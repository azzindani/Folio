/**
 * diagnose_design on a piece with music: scene cuts that miss the beat.
 *
 * A cut on the beat is felt before it is seen; one a sixteenth late reads as a
 * stumble. op:beats measures the grid and offers lengths, but only a model that
 * thought to ask heard about it. Here each cut is set against the soundtrack's
 * beat and, when it misses, the finding carries the scene length that lands it
 * — the same snapping op:beats does, so motion and reading time are kept.
 *
 * Measuring decodes the music (ffmpeg), so it runs before the synchronous
 * diagnosis — measureSoundtrack, awaited by the handler — and is cached per
 * design against the soundtrack it measured. Suggestions only: a cut off the
 * beat can be the story's choice.
 */

import * as fs from 'fs';
import type { DesignSpec } from '../../schema/types';
import type { PageFinding } from './diagnose-collect';
import { resolveDesignPath, readYAML } from './utils';
import { planScenes } from '../../export/scene-plan';
import { soundTimeline } from './motion-audio-op';
import { resolveSound } from './sound-resolve';
import { analyzeAudioFile } from './audio-analyze';
import { beatsOnPiece, snapLengths } from './motion-beats-op';

/** A cut this close to a beat is on it (about a frame at 30 fps), or an eighth of a beat at fast tempos. */
const ON_BEAT_MS = 60;
/** op:beats calls a pulse steady from this confidence. */
const STEADY = 0.4;

interface Grid { key: string; bpm: number; beat_ms: number; beats: number[] }
const measured = new Map<string, Grid>();

/** What the grid depends on: the soundtrack as written. */
const soundKey = (spec: DesignSpec): string => JSON.stringify(spec.audio ?? []);

/** Measure the piece's soundtrack so beatFindings can judge its cuts. Never throws; an unmeasurable piece is simply not judged. */
export async function measureSoundtrack(designPath: unknown, projectPath?: unknown): Promise<void> {
  try {
    if (typeof designPath !== 'string') return;
    const dPath = resolveDesignPath(designPath, typeof projectPath === 'string' ? projectPath : undefined);
    if (!fs.existsSync(dPath)) return;
    const spec = readYAML<DesignSpec>(dPath);
    if ((spec.pages?.length ?? 0) < 2 || !spec.audio?.length) return;
    const key = soundKey(spec);
    if (measured.get(dPath)?.key === key) return;
    const timeline = soundTimeline(spec);
    const sound = resolveSound(spec, dPath, timeline, typeof projectPath === 'string' ? projectPath : undefined);
    const clip = sound.clips.find(c => !c.scene);
    if (!clip) return;
    const map = await analyzeAudioFile(clip.file);
    if (map.confidence < STEADY) { measured.set(dPath, { key, bpm: map.bpm, beat_ms: map.beat_ms, beats: [] }); return; }
    const fileMs = sound.durations[clip.src] ?? map.duration_ms;
    // As op:beats: the grid as far as the music plays, so a cut may land past the piece's current end.
    const reach = clip.loop ? Math.max(clip.length_ms, timeline.total_ms) * 2 : Math.max(clip.length_ms, fileMs - clip.offset_ms);
    measured.set(dPath, { key, bpm: map.bpm, beat_ms: map.beat_ms, beats: beatsOnPiece({ ...clip, length_ms: reach }, map.beats_ms, fileMs) });
  } catch {
    // No ffmpeg, an unreadable file: the cuts go unjudged, and op:beats says why when asked.
  }
}

/** Scene cuts off the soundtrack's beat, each with the length that lands it. Empty until measured. */
export function beatFindings(spec: DesignSpec, designPath: string): PageFinding[] {
  const grid = measured.get(designPath);
  if (!grid || grid.key !== soundKey(spec) || !grid.beats.length || (spec.pages?.length ?? 0) < 2) return [];
  const scenes = planScenes(spec).scenes;
  const snaps = snapLengths(scenes, grid.beats);
  const tolerance = Math.min(ON_BEAT_MS, grid.beat_ms / 8);
  const out: PageFinding[] = [];
  scenes.forEach((s, i) => {
    const before = scenes[i - 1], snap = snaps[i - 1];
    if (!before || !snap || snap.moved_ms === 0) return;
    const nearest = grid.beats.reduce((best, b) => (Math.abs(b - s.start_ms) < Math.abs(best - s.start_ms) ? b : best), Infinity);
    const off = Math.round(s.start_ms - nearest);
    if (!Number.isFinite(nearest) || Math.abs(off) <= tolerance) return;
    out.push({
      code: 'beat_cut', severity: 'suggestion', page: s.page_id,
      message: `"${s.page_id}" cuts in at ${s.start_ms}ms, ${Math.abs(off)}ms ${off > 0 ? 'after' : 'before'} the beat at ${Math.round(nearest)}ms (${Math.round(grid.bpm)} bpm, a beat every ${Math.round(grid.beat_ms)}ms).`,
      fix: `animation(op:scene, page_id:"${before.page_id}", length_ms:${snap.on_beat_ms}) ends "${before.page_id}" on a beat that keeps its motion and reading time${i > 1 ? ' — counting the scenes before it as already snapped: apply them in order (op:beats lists every one)' : ''}. Or keep the cut where the story wants it.`,
    });
  });
  return out;
}
