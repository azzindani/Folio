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
import type { VideoTiming } from '../../animation/video-time';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn } from './utils';
import { resolveScope, commitScope } from './motion';
import { readMarkers, resolveTime, type TimeContext } from './motion-time';
import { resolveAssetFile } from './asset-resolve';
import { clipFileLength } from './video-length';

export type ClipLayer = Layer & {
  in?: number; out?: number; src?: string; layers?: Layer[];
  video?: VideoTiming & { volume?: number; muted?: boolean };
};

export interface ClipSummary {
  id: string;
  /** When it plays, on the scene clock. `until` is null for a loop or an unknown length. */
  plays: { from: number; until: number | null };
  /** Which part of the file that is, ms. */
  file: { from: number; to: number | null };
  speed: number; volume: number; muted: boolean; loop: boolean;
}

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
  };
}

export const projectOf = (designPath: string, projectPath?: string): string => projectPath ?? path.dirname(path.dirname(designPath));

export interface VideoOpArgs {
  design_path: string; project_path?: string; page_id?: string; layer_id?: string;
  in?: unknown; out?: unknown; split_at?: unknown;
  offset_ms?: number; duration_ms?: number; speed?: number; volume?: number; muted?: boolean; loop?: boolean;
}

const FIELDS = ['offset_ms', 'duration_ms', 'speed', 'volume', 'muted', 'loop'] as const;

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
  if (args.speed !== undefined && !(args.speed >= 0.1 && args.speed <= 8)) return errResult(op, `speed ${String(args.speed)} is out of range.`, 'Use 0.1–8 (0.5 = half speed, 2 = double).');

  const file = clip.src ? resolveAssetFile(clip.src, dPath, projectOf(dPath, args.project_path)) : null;
  const fileMs = file ? clipFileLength(file) : null;
  const next: ClipLayer = { ...clip, video: { ...(clip.video ?? {}) } };
  const v = next.video ?? {};
  for (const k of FIELDS) if (args[k] !== undefined) (v as Record<string, unknown>)[k] = args[k];
  if (typeof v.volume === 'number') v.volume = Math.min(1, Math.max(0, v.volume));
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

  let result: ClipLayer[] = [next];
  if (args.split_at !== undefined) {
    const cut = cutClip(next, resolveTime(args.split_at, ctx), uniqueClipId(scoped.scope, next.id));
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

/** Split a clip at scene time t: the first half ends there, the second starts there, from the frame the first stopped on. */
function cutClip(l: ClipLayer, t: number | string, secondId: string): ClipLayer[] | string {
  if (typeof t === 'string') return `split_at: ${t}`;
  const s = summarize(l);
  if (!(t > s.plays.from) || (s.plays.until !== null && t >= s.plays.until)) {
    return `split_at ${t}ms is not while "${l.id}" plays (${s.plays.from}–${s.plays.until ?? '…'}ms).`;
  }
  const used = Math.round((t - s.plays.from) * s.speed);
  const rest = s.file.to === null ? undefined : Math.max(1, s.file.to - s.file.from - used);
  const first: ClipLayer = { ...l, out: t, video: { ...(l.video ?? {}), duration_ms: used } };
  const second: ClipLayer = { ...l, id: secondId, in: t, video: { ...(l.video ?? {}), offset_ms: s.file.from + used, ...(rest !== undefined ? { duration_ms: rest } : {}) } };
  if (typeof l.out === 'number') second.out = l.out; else delete second.out;
  return [first, second];
}
