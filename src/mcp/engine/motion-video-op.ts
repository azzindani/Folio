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
import { readTransition, predecessorOf, TRANSITION_TYPES, MIN_TRANSITION_MS, MAX_TRANSITION_MS } from '../../animation/clip-transition';
import { summarize, cutClip, type ClipLayer } from '../../animation/video-clip';
import { readCropArgs } from '../../animation/clip-crop';
import { MIN_SPEED, MAX_SPEED } from '../../animation/video-time';
import { readColor } from '../../animation/clip-color';
import { readKey } from '../../animation/clip-key';
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

export interface VideoOpArgs {
  design_path: string; project_path?: string; page_id?: string; layer_id?: string;
  in?: unknown; out?: unknown; split_at?: unknown; cut?: unknown; ripple?: boolean;
  offset_ms?: number; duration_ms?: number; speed?: number; volume?: number; muted?: boolean; loop?: boolean;
  fade_in?: unknown; fade_out?: unknown; audio_lead_ms?: unknown; audio_tail_ms?: unknown; clip_transition?: unknown; focus?: unknown; zoom?: unknown; pan?: unknown; ramp?: unknown; color?: unknown; key?: unknown;
}

const FIELDS = ['offset_ms', 'duration_ms', 'speed', 'volume', 'muted', 'loop'] as const;
/** Edge sound: the arg (fade_in/fade_out share op:audio's names) and the clip field it writes. 0 or null clears. */
const SOUND = [['fade_in', 'fade_in_ms'], ['fade_out', 'fade_out_ms'], ['audio_lead_ms', 'audio_lead_ms'], ['audio_tail_ms', 'audio_tail_ms']] as const;
const MAX_EDGE_MS = 10_000;

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
  for (const [arg, key] of SOUND) {
    const n = args[arg];
    if (n === undefined) continue;
    if (n === null || n === 0) { delete (v as Record<string, unknown>)[key]; continue; }
    if (typeof n !== 'number' || !(n > 0 && n <= MAX_EDGE_MS)) return errResult(op, `${arg} ${String(n)} is out of range.`, `Use ms from 1 to ${MAX_EDGE_MS} (0 or null clears it).`);
    (v as Record<string, unknown>)[key] = Math.round(n);
  }
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

  // clip_transition, not transition: the animation tool's `transition` is op:scene's page entrance.
  if (args.clip_transition === null) delete v.transition;
  else if (args.clip_transition !== undefined) {
    const t = readTransition(args.clip_transition);
    if (typeof t === 'string') return errResult(op, t, `Use {type: ${TRANSITION_TYPES.join('|')}, duration_ms? ${MIN_TRANSITION_MS}–${MAX_TRANSITION_MS}, color? "#rrggbb" (dip), direction? left|right|up|down (wipe, push)}; null clears.`);
    if (!predecessorOf(scoped.scope.filter(l => l.id !== clip.id), next)) {
      return errResult(op, `No clip ends where "${clip.id}" starts (${Number(next.in) || 0} ms) — a transition joins a clip to the one before it on its track.`, 'Lay the clips end to end first (op:video in on this clip, or split_at on one clip), then add the transition.');
    }
    v.transition = t;
  }

  // Pan and zoom inside the footage (animation/clip-crop.ts): null clears each.
  const crop = readCropArgs(args);
  if (typeof crop === 'string') return errResult(op, crop, 'focus [x, y] 0–1 and zoom 1–4 set where the frame rests; pan:[{at_ms (file clock), focus?, zoom?, easing?}] moves it.');
  for (const k of ['focus', 'zoom', 'pan'] as const) {
    if (crop[k] === null) delete (v as Record<string, unknown>)[k];
    else if (crop[k] !== undefined) (v as Record<string, unknown>)[k] = crop[k];
  }

  // A speed ramp (video-time.ts): keys on the clip's own clock; null clears.
  if (args.ramp === null) delete v.ramp;
  else if (args.ramp !== undefined) {
    const keys = Array.isArray(args.ramp) ? args.ramp as Array<Record<string, unknown>> : [];
    const bad = !keys.length || keys.some(k => typeof k['at_ms'] !== 'number' || k['at_ms'] < 0 || typeof k['speed'] !== 'number' || !(k['speed'] >= MIN_SPEED && k['speed'] <= MAX_SPEED));
    if (bad) return errResult(op, `ramp must be [{at_ms, speed}] — at_ms from the clip's start (ms), speed ${MIN_SPEED}–${MAX_SPEED}.`, 'ramp:[{at_ms:0, speed:1}, {at_ms:800, speed:0.25}, {at_ms:2000, speed:1}] slows into a moment and back out.');
    if (v.still) return errResult(op, `"${clip.id}" is a freeze; it has no speed to ramp.`, 'Ramp the clip it was frozen from.');
    v.ramp = keys.map(k => ({ at_ms: Math.round(k['at_ms'] as number), speed: k['speed'] as number })).sort((a, b) => a.at_ms - b.at_ms);
  }

  // A grade (animation/clip-color.ts); null clears.
  if (args.color !== undefined) {
    const grade = readColor(args.color);
    if (typeof grade === 'string') return errResult(op, grade, 'color:{exposure -3–3 stops, contrast/saturation/temperature/tint -1–1, lut:"assets/docs/look.cube"}; null clears.');
    if (grade === null || !Object.keys(grade).length) delete v.color; else v.color = grade;
  }
  // A green screen taken out (animation/clip-key.ts); null clears.
  if (args.key !== undefined) {
    const key = readKey(args.key);
    if (typeof key === 'string') return errResult(op, key, 'key:{color:"#00ff00" (the screen), similarity? 0–1 (default 0.4: more takes out more), blend? 0–1 (default 0.1: the soft edge)}; null clears.');
    if (key === null) delete v.key; else v.key = key;
  }

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
