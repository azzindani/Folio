// animation(op:video, on_beats) — a main track's joins moved onto the music's beats.
//
// The model picks the shots and their order; this snaps the timing: each join
// to its nearest beat (or bar line) the footage allows, the last frame too
// unless end:false (animation/beat-cut.ts). Measured on the same grid op:beats
// reports, so what the model reads there is what the cuts land on.

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo } from './utils';
import { resolveScope, commitScope } from './motion';
import { tryFfmpeg } from '../../export/animation-export';
import { musicGrid, renderBeatsASCII } from './motion-beats-op';
import { trackAround, planBeatCuts } from '../../animation/beat-cut';
import { summarize, replaceClip, projectOf, type ClipLayer } from './motion-video-op';
import { resolveAssetFile } from './asset-resolve';
import { clipFileLength } from './video-length';

export interface BeatCutArgs { design_path: string; project_path?: string; page_id?: string; layer_id?: string; on_beats?: unknown }
const OP = 'video';

/** on_beats: true, or {every?: 1|2|4…, max_shift_ms?, end?: boolean, audio_id?}. */
function readOnBeats(raw: unknown): { every: number; max_shift_ms?: number; end: boolean; audio_id?: string } | string {
  if (raw === true) return { every: 1, end: true };
  if (!raw || typeof raw !== 'object') return 'on_beats must be true or {every?, max_shift_ms?, end?, audio_id?}.';
  const r = raw as Record<string, unknown>;
  const every = r['every'] === undefined ? 1 : Number(r['every']);
  if (!Number.isInteger(every) || every < 1 || every > 16) return 'on_beats.every must be a whole number of beats, 1–16 (4 = on the bar).';
  const shift = r['max_shift_ms'];
  if (shift !== undefined && !(typeof shift === 'number' && shift > 0)) return 'on_beats.max_shift_ms must be a positive number of ms.';
  return { every, end: r['end'] !== false, ...(typeof shift === 'number' ? { max_shift_ms: shift } : {}), ...(typeof r['audio_id'] === 'string' ? { audio_id: r['audio_id'] } : {}) };
}

/** The list a layer sits in — its siblings are the track it can belong to. */
function siblingsOf(layers: Layer[], id: string): Layer[] | null {
  if (layers.some(l => l.id === id)) return layers;
  for (const l of layers) {
    const kids = (l as ClipLayer).layers;
    const hit = Array.isArray(kids) ? siblingsOf(kids, id) : null;
    if (hit) return hit;
  }
  return null;
}

export async function beatCutVideo(args: BeatCutArgs): Promise<ToolResult> {
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(OP, `Design not found: ${dPath}`, 'Check design_path.');
  if (!args.layer_id) return errResult(OP, 'layer_id is required.', 'Name any clip on the track to cut to the beat.');
  const opts = readOnBeats(args.on_beats);
  if (typeof opts === 'string') return errResult(OP, opts, 'on_beats:true snaps every join to its nearest beat; {every:4} to the bar.');
  if (!tryFfmpeg()) return errResult(OP, 'Cutting to the beat measures the music with ffmpeg, and this host has none.', 'Install ffmpeg (the Docker image ships it).');
  // Measured first, from a read that is never written back: the music takes seconds to analyse,
  // and a design read before that wait would revert any edit made during it (atomic-design-write.test.ts).
  const music = await musicGrid(readYAML<DesignSpec>(dPath), dPath, { project_path: args.project_path, ...(opts.audio_id ? { audio_id: opts.audio_id } : {}) });
  if ('error' in music) return errResult(OP, music.error, music.hint);
  if (music.pulse === 'none') {
    return errResult(OP, `"${music.clip.id}" has no steady pulse (confidence ${music.map.confidence}) — there is no grid to cut on.`,
      'Cut on the music\'s onsets by hand (op:beats lists them), or put music with a beat under the piece (op:audio).');
  }
  // From here to the write, nothing yields.
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(OP, scoped.error, 'Check page_id.');
  const track = trackAround(siblingsOf(scoped.scope, args.layer_id) ?? [], args.layer_id);
  if (!track.length) return errResult(OP, `"${args.layer_id}" is not a video layer on this page.`, 'manage_design {op:"inspect"} lists the layers.');
  const project = projectOf(dPath, args.project_path);
  const fileMs: Record<string, number | null> = {};
  for (const l of track as ClipLayer[]) {
    const file = l.src ? resolveAssetFile(l.src, dPath, project) : null;
    fileMs[l.id] = file ? clipFileLength(file) : null;
  }
  const plan = planBeatCuts(track, music.grid, { every: opts.every, end: opts.end, fileMs, ...(opts.max_shift_ms ? { max_shift_ms: opts.max_shift_ms } : {}) });
  let scope = scoped.scope;
  for (const [id, patch] of plan.patches) {
    const l = track.find(c => c.id === id);
    if (l) scope = replaceClip(scope, id, [{ ...l, ...patch } as Layer]);
  }
  const bak = plan.patches.size ? snapshot(dPath) : undefined;
  if (plan.patches.size) { commitScope(spec, scoped.page, scope); writeYAML(dPath, spec); }
  const after = (siblingsOf(scope, args.layer_id) ?? []).filter(l => plan.track.includes(l.id)).map(l => summarize(l as ClipLayer)).sort((a, b) => a.plays.from - b.plays.from);
  const cuts = after.slice(1).map(c => c.plays.from);
  return okResult(OP, {
    design_path: dPath, bpm: music.map.bpm, beat_ms: music.map.beat_ms, pulse: music.pulse, every: opts.every,
    track: plan.track, moved: plan.moved, ...(plan.kept.length ? { kept: plan.kept } : {}), clips: after,
    ascii: renderBeatsASCII(Math.max(music.total_ms, ...after.map(c => c.plays.until ?? 0)), music.grid, cuts),
    progress: [
      pOk(plan.moved.length ? `Moved ${plan.moved.length} cut(s) onto the beat` : 'Every cut already sits on the beat', plan.moved.map(m => `${m.between.join('|')}: ${m.from_ms} → ${m.to_ms}ms`).join(' · ')),
      ...plan.kept.map(k => pInfo(`Kept the cut at ${k.at_ms}ms`, k.reason)),
    ],
  }, bak);
}
