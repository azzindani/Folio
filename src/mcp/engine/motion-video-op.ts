// animation {op:"video"} — trim, time and cut a clip on the scene clock.
//
// A video layer's timing lives in `video:{offset_ms, duration_ms, speed,
// volume, muted, loop}` and its `in`/`out` points. edit_layer update can write
// them, but that is a model doing clip arithmetic blind: which second of the
// file shows when, where a cut leaves each half. This op takes the edit a video
// editor would make — start here, use this part, at this speed, cut there —
// writes the fields, and answers with each clip on both clocks: when it plays
// in the piece and which part of the file that is.

import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer } from '../../schema/types';
import { summarize, cutClip, type ClipLayer } from '../../animation/video-clip';
import { applyTimingEdits, applyLookEdits, type TimingEdits, type LookEdits } from '../../animation/clip-edit';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn } from './utils';
import { resolveScope, commitScope } from './motion';
import { readMarkers, resolveTime, type TimeContext } from './motion-time';
import { resolveAssetFile } from './asset-resolve';
import { clipFileLength } from './video-length';

export { summarize, splitClip, type ClipLayer, type ClipSummary } from '../../animation/video-clip';

export function findClip(layers: Layer[], id: string): ClipLayer | null {
  for (const l of layers as ClipLayer[]) {
    if (l.id === id) return l;
    const hit = Array.isArray(l.layers) ? findClip(l.layers, id) : null;
    if (hit) return hit;
  }
  return null;
}

/** The tree with layer `id` replaced by `next` (one layer, or the two halves of a cut). */
export function replaceClip(layers: Layer[], id: string, next: Layer[]): Layer[] {
  return layers.flatMap(l => {
    if (l.id === id) return next;
    const kids = (l as ClipLayer).layers;
    return Array.isArray(kids) ? [{ ...l, layers: replaceClip(kids, id, next) } as Layer] : [l];
  });
}

export function uniqueClipId(layers: Layer[], base: string): string {
  const taken = new Set<string>();
  const walk = (ls: Layer[]): void => { for (const l of ls) { taken.add(l.id); const k = (l as ClipLayer).layers; if (Array.isArray(k)) walk(k); } };
  walk(layers);
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

export const projectOf = (designPath: string, projectPath?: string): string => projectPath ?? path.dirname(path.dirname(designPath));

// What changes a clip's `video` block is animation/clip-edit.ts — the editor's inspector writes through the same rules.
export interface VideoOpArgs extends TimingEdits, LookEdits {
  design_path: string; project_path?: string; page_id?: string; layer_id?: string;
  in?: unknown; out?: unknown; split_at?: unknown; cut?: unknown; ripple?: boolean;
}

export function videoMotion(args: VideoOpArgs): ToolResult {
  const op = 'video';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  if (!args.layer_id) return errResult(op, 'layer_id is required.', 'Name the video layer to trim, time or cut.');
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const clip = findClip(scoped.scope, args.layer_id);
  if (!clip || clip.type !== 'video') return errResult(op, `"${args.layer_id}" is not a video layer on this page.`, 'manage_design {op:"inspect"} lists the layers.');

  const file = clip.src ? resolveAssetFile(clip.src, dPath, projectOf(dPath, args.project_path)) : null;
  const fileMs = file ? clipFileLength(file) : null;
  const next: ClipLayer = { ...clip, video: { ...(clip.video ?? {}) } };
  const v = next.video ?? {};
  const timing = applyTimingEdits(next, args);
  if (timing) return errResult(op, timing.error, timing.hint);
  const progress: ProgressItem[] = [];
  // Moving the start keeps "the rest of the file" unless a length was given.
  if (args.offset_ms !== undefined && args.duration_ms === undefined && fileMs) v.duration_ms = Math.max(1, fileMs - Math.max(0, Number(v.offset_ms) || 0));
  if (fileMs !== null) {
    const off = Math.max(0, Number(v.offset_ms) || 0);
    if (off >= fileMs) return errResult(op, `offset_ms ${off} is past the end of the ${fileMs}ms clip.`, `Use an offset under ${fileMs}.`);
    if (Number(v.duration_ms) > fileMs - off) { v.duration_ms = fileMs - off; progress.push(pWarn('duration_ms trimmed', `the clip has only ${fileMs - off}ms after offset ${off}.`)); }
    // No length yet (a layer written outside writeYAML): the rest of the file, so a cut has an end to fall before.
    if (!(Number(v.duration_ms) > 0)) v.duration_ms = fileMs - off;
  }

  const ctx: TimeContext = { markers: readMarkers(spec, scoped.page), layers: scoped.scope };
  for (const [key, raw] of [['in', args.in], ['out', args.out]] as const) {
    if (raw === undefined) continue;
    if (raw === null) { delete next[key]; continue; }
    const ms = resolveTime(raw, ctx);
    if (typeof ms === 'string') return errResult(op, `${key}: ${ms}`, 'Fix that time and call again.');
    next[key] = ms;
  }

  // Transition, crop, ramp, grade and key (animation/clip-edit.ts). The clips of this list are the ones a transition can join to.
  const look = applyLookEdits(next, args, scoped.scope as ClipLayer[]);
  if (look) return errResult(op, look.error, look.hint);

  let result: ClipLayer[] = [next];
  if (args.split_at !== undefined) {
    const at = resolveTime(args.split_at, ctx);
    const cut = typeof at === 'string' ? `split_at: ${at}` : cutClip(next, at, uniqueClipId(scoped.scope, next.id));
    if (typeof cut === 'string') return errResult(op, cut, 'Pick a split_at inside the time the clip plays (the reply of a call without split_at shows it).');
    result = cut;
  }

  const bak = snapshot(dPath);
  commitScope(spec, scoped.page, replaceClip(scoped.scope, clip.id, result));
  writeYAML(dPath, spec);
  const clips = result.map(summarize);
  progress.unshift(pOk(result.length === 2 ? `Cut "${clip.id}" in two` : `Timed "${clip.id}"`, clips.map(c => `${c.id}: plays ${c.plays.from}–${c.plays.until ?? '…'}ms, file ${c.file.from}–${c.file.to ?? 'end'}ms at ${c.speed}×`).join(' · ')));
  return okResult(op, {
    design_path: dPath, clips, ...(fileMs !== null ? { file_ms: fileMs } : {}), progress,
    next_action: { tool: 'animation', params: { op: 'frame', design_path: dPath, t: clips[clips.length - 1]?.plays.from ?? 0, ...(args.page_id ? { page_id: args.page_id } : {}) }, remaining: 0,
      hint: 'op:frame shows the frame at a time; edit_layer move/scale places a half; edit_layer remove drops one — a cut.' },
  }, bak);
}
