/**
 * animation(op:captions) — the words on screen in a video.
 *
 *   cues:[{text, from_ms, to_ms}]                  the design's captions, on the piece's timeline (replaces them)
 *   page_id + lines:[{text, at?, duration?}]      one scene's captions, from its first frame; untimed ones share the scene by words
 *   style:{position, font_size, color, …}         how every caption looks (merged into what is there)
 *   clear:true [+ page_id]                        remove a scene's captions, or all of them
 *   format:"srt"|"vtt"                            also write a subtitle file beside the exports
 *   nothing                                       report the captions as the video will show them
 *
 * Captions are burned into gif/mp4/webm frames, op:frame and Play all through
 * one function (export/caption-layers.ts). The engine checks the reading math
 * and the overlaps; the words and their timing stay the model's.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CaptionCue, CaptionStyle, DesignSpec, SceneCaption } from '../../schema/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult } from './utils';
import { planScenes } from '../../export/scene-plan';
import { animationDuration } from '../../export/gif-frames';
import { planCaptions, type CaptionPlan, type CaptionTimeline } from '../../export/caption-plan';
import { toSrt, toVtt } from '../../export/caption-files';
import { sourceOptions } from '../../renderer/resolve-source';

export type CaptionArgs = {
  design_path: string; project_path?: string; page_id?: string;
  cues?: unknown; lines?: unknown; style?: unknown; clear?: unknown; format?: unknown; output_path?: string; hold_ms?: number;
};

const OP = 'captions';
const STYLE_KEYS: Record<keyof CaptionStyle, 'string' | 'number'> = {
  position: 'string', font_family: 'string', font_size: 'number', font_weight: 'number', color: 'string',
  background: 'string', background_opacity: 'number', max_width: 'number', margin: 'number',
};

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isMs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function readCues(raw: unknown): CaptionCue[] | string {
  if (!Array.isArray(raw)) return 'cues must be an array of {text, from_ms, to_ms}.';
  const out: CaptionCue[] = [];
  for (const [i, c] of raw.entries()) {
    const o = (c ?? {}) as Record<string, unknown>;
    if (!isText(o['text']) || !isMs(o['from_ms']) || !isMs(o['to_ms'])) return `cues[${i}] needs text, from_ms and to_ms (ms on the piece's timeline).`;
    out.push({ text: o['text'].trim(), from_ms: Math.round(o['from_ms']), to_ms: Math.round(o['to_ms']) });
  }
  return out;
}

function readLines(raw: unknown): SceneCaption[] | string {
  if (!Array.isArray(raw)) return 'lines must be an array of {text, at?, duration?}.';
  const out: SceneCaption[] = [];
  for (const [i, c] of raw.entries()) {
    const o = (typeof c === 'string' ? { text: c } : c ?? {}) as Record<string, unknown>;
    if (!isText(o['text'])) return `lines[${i}] needs text.`;
    if ((o['at'] !== undefined && !isMs(o['at'])) || (o['duration'] !== undefined && !isMs(o['duration']))) return `lines[${i}]: at and duration are ms ≥ 0.`;
    out.push({ text: o['text'].trim(), ...(isMs(o['at']) ? { at: Math.round(o['at']) } : {}), ...(isMs(o['duration']) ? { duration: Math.round(o['duration']) } : {}) });
  }
  return out;
}

function readStyle(raw: unknown): CaptionStyle | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'style must be an object.';
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const want = STYLE_KEYS[k as keyof CaptionStyle];
    if (!want) return `style.${k} is not a caption style. Keys: ${Object.keys(STYLE_KEYS).join(', ')}.`;
    if (typeof v !== want) return `style.${k} must be a ${want}.`;
    out[k] = v;
  }
  if (out['position'] !== undefined && out['position'] !== 'bottom' && out['position'] !== 'top') return 'style.position is "bottom" or "top".';
  return out as CaptionStyle;
}

/** The piece's timing as the export sees it: a deck plays as scenes, one page as its own motion. */
export function captionTimeline(spec: DesignSpec, holdMs?: number): CaptionTimeline {
  if ((spec.pages?.length ?? 0) >= 2) return planScenes(spec, { hold_ms: holdMs });
  const first = spec.pages?.[0];
  const total = animationDuration(first?.layers ?? spec.layers ?? [], sourceOptions(spec, first));
  return { total_ms: total, scenes: first ? [{ page_id: first.id, start_ms: 0, length_ms: total }] : [] };
}

export function captionsMotion(args: CaptionArgs): ToolResult {
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(OP, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const page = args.page_id !== undefined ? (spec.pages ?? []).find(p => p.id === args.page_id) : undefined;
  if (args.page_id !== undefined && !page) return errResult(OP, `Page not found: ${args.page_id}`, 'Run manage_design(op:inspect) to list page ids.');
  const example = 'e.g. animation(op:captions, page_id:"s2", lines:[{text:"Every format"}, {text:"from one spec", at:1800}])';
  if (args.cues !== undefined && page) return errResult(OP, 'cues are timed on the whole piece; a scene takes lines.', example);
  if (args.lines !== undefined && !page) return errResult(OP, 'lines belong to a scene: pass page_id, or cues:[{text, from_ms, to_ms}] for the whole piece.', example);
  const cues = args.cues === undefined ? undefined : readCues(args.cues);
  if (typeof cues === 'string') return errResult(OP, cues, example);
  const lines = args.lines === undefined ? undefined : readLines(args.lines);
  if (typeof lines === 'string') return errResult(OP, lines, example);
  const style = args.style === undefined ? undefined : readStyle(args.style);
  if (typeof style === 'string') return errResult(OP, style, 'e.g. style:{position:"top", font_size:56, background:"none"}');
  if (args.format !== undefined && args.format !== 'srt' && args.format !== 'vtt') return errResult(OP, 'format is "srt" or "vtt".', 'Leave it off to set or list captions only.');

  const changed: string[] = [];
  const writes = args.clear === true || cues !== undefined || lines !== undefined || style !== undefined;
  const bak = writes ? snapshot(dPath) : undefined;
  if (args.clear === true) {
    if (page) delete page.captions;
    else { delete spec.captions; for (const p of spec.pages ?? []) delete p.captions; }
    changed.push(page ? `Cleared the captions of "${page.id}"` : 'Cleared every caption');
  }
  if (cues) { spec.captions = { ...spec.captions, cues }; changed.push(`Set ${cues.length} piece caption(s)`); }
  if (page && lines) { page.captions = lines; changed.push(`Set ${lines.length} caption(s) on "${page.id}"`); }
  if (style) { spec.captions = { ...spec.captions, style: { ...spec.captions?.style, ...style } }; changed.push('Updated the caption style'); }
  if (writes) writeYAML(dPath, spec);

  const timeline = captionTimeline(spec, args.hold_ms);
  const plan = planCaptions(spec, timeline);
  let file: string | undefined;
  if (args.format === 'srt' || args.format === 'vtt') {
    file = args.output_path ?? path.join(path.dirname(dPath), '..', 'exports', `${path.basename(dPath, '.design.yaml')}.${args.format}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, args.format === 'srt' ? toSrt(plan.cues) : toVtt(plan.cues), 'utf-8');
  }
  const first = plan.cues[0];
  return okResult(OP, {
    design_path: dPath,
    ...(changed.length ? { changed } : {}),
    total_ms: timeline.total_ms,
    captions: plan.cues.map(c => ({ text: c.text, from_ms: c.from_ms, to_ms: c.to_ms, ...(c.scene ? { scene: c.scene } : {}) })),
    style: spec.captions?.style ?? 'default — bottom, Archivo 600 white on a 72% black box, 4.5% of the canvas height',
    ascii: renderCaptionsASCII(plan, timeline.total_ms),
    ...(file ? { file } : {}),
    notes: [...plan.notes, 'Captions are drawn into gif/mp4/webm frames, op:frame and Play all; the svg/html export does not carry them (format:"vtt" writes a subtitle file).'],
    ...(first ? {
      next_action: {
        tool: 'animation', params: { op: 'frame', design_path: dPath, t: Math.round((first.from_ms + first.to_ms) / 2), ...((spec.pages?.length ?? 0) >= 2 ? { scenes: true } : {}) },
        remaining: 0, hint: 'See a caption over its scene before exporting.',
      },
    } : {}),
  }, bak);
}

/** The captions as text on op:timeline's scale, ▬ where a caption is on screen. */
export function renderCaptionsASCII(plan: CaptionPlan, total: number, width = 56): string {
  const col = (ms: number): number => Math.min(width - 1, Math.max(0, Math.round((ms / Math.max(1, total)) * (width - 1))));
  const lane = Array<string>(width).fill('·');
  for (const c of plan.cues) for (let i = col(c.from_ms); i <= Math.max(col(c.from_ms), col(c.to_ms) - 1); i++) lane[i] = '▬';
  return [`Captions over ${total}ms · ▬ on screen`, `text  |${lane.join('')}|`].join('\n');
}
