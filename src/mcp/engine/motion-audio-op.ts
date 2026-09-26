/**
 * animation(op:audio) — the sound of a video: music under the whole piece, and
 * cues that start with a scene.
 *
 *   src (+ fields)          add a track, or replace the one with the same audio_id
 *   audio_id + fields       change an existing track (volume, fades, timing)
 *   remove:true [audio_id]  take one track out, or every track in scope
 *   nothing                 report the soundtrack as it plays
 *
 * page_id puts the call on that page's cues (start_ms = ms after the scene's
 * first frame); without it, on the design's tracks (start_ms = ms into the
 * piece). Every reply is the soundtrack as the export will mix it, clipped to
 * the piece, with the notes a listener would have.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AudioCue, AudioTrack, DesignSpec } from '../../schema/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult } from './utils';
import { planScenes } from '../../export/scene-plan';
import { animationDuration } from '../../export/gif-frames';
import type { SoundPlan, SoundTimeline } from '../../export/audio-plan';
import { resolveAssetFile } from './asset-resolve';
import { isAudioExt, probeAudio } from './asset-audio';
import { resolveSound } from './sound-resolve';
import { sourceOptions } from '../../renderer/resolve-source';

export type AudioArgs = {
  design_path: string;
  project_path?: string;
  page_id?: string;
  src?: unknown;
  audio_id?: unknown;
  remove?: unknown;
  start_ms?: unknown;
  offset_ms?: unknown;
  duration?: unknown;
  volume?: unknown;
  fade_in?: unknown;
  fade_out?: unknown;
  loop?: unknown;
  hold_ms?: number;
};

const OP = 'audio';
type Entry = AudioTrack | AudioCue;

/** The piece's timing as the export will see it: a deck plays as scenes, one page as its own motion. */
export function soundTimeline(spec: DesignSpec, holdMs?: number): SoundTimeline {
  const pages = spec.pages ?? [];
  if (pages.length >= 2) {
    const plan = planScenes(spec, { hold_ms: holdMs });
    return { total_ms: plan.total_ms, scenes: plan.scenes.map(s => ({ page_id: s.page_id, start_ms: s.start_ms })) };
  }
  const first = pages[0];
  return { total_ms: animationDuration(first?.layers ?? spec.layers ?? [], sourceOptions(spec, first)), scenes: first ? [{ page_id: first.id, start_ms: 0 }] : [] };
}

/** The fields a call sets, checked. A string is the problem. */
function readFields(a: AudioArgs, cue: boolean): Partial<AudioTrack & AudioCue> | string {
  const out: Partial<AudioTrack & AudioCue> = {};
  const ms: Array<[keyof AudioArgs, 'start_time' | 'at' | 'offset' | 'duration' | 'fade_in' | 'fade_out']> = [
    ['start_ms', cue ? 'at' : 'start_time'], ['offset_ms', 'offset'], ['duration', 'duration'], ['fade_in', 'fade_in'], ['fade_out', 'fade_out'],
  ];
  for (const [arg, field] of ms) {
    const v = a[arg];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return `${String(arg)} must be a number of ms ≥ 0.`;
    out[field] = Math.round(v);
  }
  if (a.volume !== undefined) {
    if (typeof a.volume !== 'number' || a.volume < 0 || a.volume > 1) return 'volume must be a number from 0 (silent) to 1 (as recorded).';
    out.volume = Math.round(a.volume * 1000) / 1000;
  }
  if (a.loop !== undefined) {
    if (typeof a.loop !== 'boolean') return 'loop must be true or false.';
    out.loop = a.loop;
  }
  return out;
}

const bar = (from: number, to: number, total: number, width: number, ch: string): string => {
  const col = (ms: number): number => Math.min(width - 1, Math.max(0, Math.round((ms / Math.max(1, total)) * (width - 1))));
  const cells = Array<string>(width).fill('·');
  for (let i = col(from); i <= Math.max(col(from), col(to) - 1); i++) cells[i] = ch;
  return cells.join('');
};

export function audioMotion(args: AudioArgs): ToolResult {
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(OP, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const page = args.page_id !== undefined ? (spec.pages ?? []).find(p => p.id === args.page_id) : undefined;
  if (args.page_id !== undefined && !page) {
    return errResult(OP, `Page not found: ${args.page_id}`, 'Run manage_design(op:inspect) to list page ids, or leave page_id off for music under the whole piece.');
  }
  const where = page ? `on page "${page.id}"` : 'under the piece';
  const scope: Entry[] = page ? page.audio_cues ?? [] : spec.audio ?? [];
  const idOf = (e: Entry, i: number): string => (typeof e.id === 'string' && e.id ? e.id : page ? `${page.id}-cue-${i + 1}` : `track-${i + 1}`);
  const fields = readFields(args, page !== undefined);
  if (typeof fields === 'string') return errResult(OP, fields, 'e.g. animation(op:audio, src:"assets/audio/theme.mp3", volume:0.7, fade_in:400, fade_out:1200, loop:true)');
  const id = typeof args.audio_id === 'string' && args.audio_id.trim() ? args.audio_id.trim() : undefined;
  const setsFields = Object.keys(fields).length > 0;

  let next: Entry[] | null = null;
  let changed = '';
  if (args.remove === true) {
    next = id ? scope.filter((e, i) => idOf(e, i) !== id) : [];
    if (next.length === scope.length) {
      return errResult(OP, id ? `No sound "${id}" ${where}.` : `There is no sound ${where} to remove.`, 'Call animation(op:audio) with no src to list what plays.');
    }
    changed = id ? `Removed "${id}"` : `Removed ${scope.length} sound(s)`;
  } else if (args.src !== undefined) {
    const src = typeof args.src === 'string' ? args.src.trim() : '';
    if (!src || !isAudioExt(path.extname(src).slice(1))) {
      return errResult(OP, `src must name an audio file (mp3, wav, m4a, aac, ogg, opus, flac), not "${String(args.src)}".`,
        'Find one with manage_design(op:asset_search, what:"music"|"sound") + op:asset_fetch, or store your own with op:asset_add, and pass the lib/… or assets/audio/… path it returns.');
    }
    const file = resolveAssetFile(src, dPath, args.project_path);
    if (!file) return errResult(OP, `Sound not found: ${src}`, 'Fetch one with manage_design(op:asset_search, what:"sound") + op:asset_fetch, or store your own with op:asset_add. A src reaches this project\'s files or the shared library (lib/…), never a URL.');
    if (probeAudio(file) === 'not-audio') return errResult(OP, `"${src}" holds no audio.`, 'Store a real audio file under that name, then call again.');
    const newId = id ?? (path.basename(src, path.extname(src)).replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'music');
    const at = scope.findIndex((e, i) => idOf(e, i) === newId);
    const entry = { ...fields, id: newId, src } as Entry;
    next = at >= 0 ? scope.map((e, i) => (i === at ? entry : e)) : [...scope, entry];
    changed = at >= 0 ? `Replaced "${newId}"` : `Added "${newId}" ${where}`;
  } else if (setsFields) {
    const at = id ? scope.findIndex((e, i) => idOf(e, i) === id) : -1;
    if (!id || at < 0) {
      return errResult(OP, id ? `No sound "${id}" ${where}.` : 'Which sound? Pass audio_id to change one, or src to add one.', 'Call animation(op:audio) with no src to list what plays and their ids.');
    }
    next = scope.map((e, i) => (i === at ? { ...e, ...fields, id } : e));
    changed = `Changed "${id}"`;
  }

  let bak: string | undefined;
  if (next) {
    bak = snapshot(dPath);
    if (page) {
      if (next.length) page.audio_cues = next as AudioCue[]; else delete page.audio_cues;
    } else if (next.length) spec.audio = next as AudioTrack[];
    else delete spec.audio;
    writeYAML(dPath, spec);
  }

  const timeline = soundTimeline(spec, args.hold_ms);
  const sound = resolveSound(spec, dPath, timeline, args.project_path);
  const notes = [
    ...(timeline.total_ms === 0 ? ['The piece is 0s long — nothing moves yet — so no sound plays. Add motion, or give scenes a length with op:scene.'] : []),
    ...sound.plan.notes,
  ];
  const deck = (spec.pages?.length ?? 0) >= 2;
  return okResult(OP, {
    design_path: dPath,
    ...(changed ? { changed } : {}),
    total_ms: timeline.total_ms,
    soundtrack: sound.plan.clips.map(c => ({
      id: c.id, src: c.src, ...(c.scene ? { scene: c.scene } : {}), from_ms: c.start_ms, to_ms: c.start_ms + c.length_ms,
      file_ms: sound.durations[c.src] ?? 'unknown', offset_ms: c.offset_ms, volume: c.volume, fade_in: c.fade_in_ms, fade_out: c.fade_out_ms, loop: c.loop, cut: c.cut,
    })),
    ascii: renderSoundASCII(sound.plan),
    ...(notes.length ? { notes } : {}),
    next_action: {
      tool: 'animation', params: { op: 'export', design_path: dPath, type: 'mp4', ...(deck ? { scenes: true } : {}) }, remaining: 0,
      hint: 'mp4 and webm carry the sound; a GIF has none. Play all in the editor plays it with the scenes.',
    },
  }, bak);
}

/** The soundtrack as text, one lane per clip, on the same scale as op:timeline's scene bars. */
export function renderSoundASCII(plan: SoundPlan, width = 56): string {
  const lines = [`Sound over ${plan.total_ms}ms · ♪ sounding`];
  for (const c of plan.clips) {
    const label = (`♪ ${c.id} `).padEnd(13).slice(0, 13);
    lines.push(`${label}|${bar(c.start_ms, c.start_ms + c.length_ms, plan.total_ms, width, '♪')}| ${(c.start_ms / 1000).toFixed(1)}–${((c.start_ms + c.length_ms) / 1000).toFixed(1)}s`);
  }
  return lines.join('\n');
}
