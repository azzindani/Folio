/**
 * A design's sound, found on disk — the plan, with each clip's file and length.
 *
 * planSound (export/audio-plan.ts) is pure and knows only what it is told. This
 * finds each src under the image asset rules (the project, then the shared
 * library, never outside them), reads each file's length with ffprobe, and
 * leaves out what it cannot find — with a note, never silently.
 */

import type { DesignSpec } from '../../schema/types';
import { planSound, type SoundPlan, type SoundTimeline } from '../../export/audio-plan';
import type { MuxClip } from '../../export/audio-mux';
import { resolveAssetFile } from './asset-resolve';
import { probeAudio } from './asset-audio';

export interface ResolvedSound {
  plan: SoundPlan;
  /** The plan's clips with their files — what the mux pass takes. */
  clips: MuxClip[];
  /** Length of each found file, ms, by src (absent when ffprobe is missing). */
  durations: Record<string, number | undefined>;
}

const srcOf = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

/** Every src the design's tracks and cues name. */
export function soundSources(spec: DesignSpec): string[] {
  const all = [...(spec.audio ?? []).map(t => srcOf(t.src)), ...(spec.pages ?? []).flatMap(p => (p.audio_cues ?? []).map(c => srcOf(c.src)))];
  return [...new Set(all.filter(Boolean))];
}

export function hasSound(spec: DesignSpec): boolean {
  return soundSources(spec).length > 0;
}

export function resolveSound(spec: DesignSpec, dPath: string, timeline: SoundTimeline, projectPath?: string): ResolvedSound {
  const files = new Map<string, string>();
  const durations: Record<string, number | undefined> = {};
  const missing: string[] = [];
  for (const src of soundSources(spec)) {
    const file = resolveAssetFile(src, dPath, projectPath);
    if (!file) {
      missing.push(`Sound "${src}" is not in the project or the shared library, so it is left out. Store it with manage_design(op:asset_add) and use the assets/audio/… path it returns.`);
      continue;
    }
    const probe = probeAudio(file);
    if (probe === 'not-audio') { missing.push(`"${src}" holds no audio, so it is left out.`); continue; }
    files.set(src, file);
    durations[src] = probe?.duration_ms;
  }
  // Plan only what was found, so a missing file is neither mixed nor drawn.
  const keep = (s: unknown): boolean => files.has(srcOf(s));
  const found: DesignSpec = {
    ...spec,
    audio: (spec.audio ?? []).filter(t => keep(t.src)),
    pages: (spec.pages ?? []).map(p => (p.audio_cues ? { ...p, audio_cues: p.audio_cues.filter(c => keep(c.src)) } : p)),
  };
  const plan = planSound(found, timeline, durations);
  plan.notes.unshift(...missing);
  const clips = plan.clips.flatMap(c => {
    const file = files.get(c.src);
    return file ? [{ ...c, file }] : [];
  });
  return { plan, clips, durations };
}
