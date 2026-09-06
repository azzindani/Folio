/**
 * `animation(op:sequence | track | clear | presets)` — the ops that let a model
 * author a whole scene rather than one keyframe at a time.
 *
 *   sequence  an ordered list of steps, each a preset on some layers at a time —
 *             the After Effects composition in one call. Entrances, holds and
 *             exits on the same layer fold into one track (motion-merge.ts).
 *   track     write a layer's complete keyframe track directly: any channel,
 *             per-keyframe easing, holds, anchor. The primitive everything
 *             else expands to; a model that wants full control uses this.
 *   clear     remove motion from some or all layers.
 *   presets   list every preset and easing with a one-line note — the menu.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec, Keyframe, AnchorPoint } from '../../animation/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo, pWarn } from './utils';
import { expandPreset, isMotionPreset, PRESET_NAMES, PRESET_NOTES, PRESET_KIND, presetsByKind, type MotionPreset } from './motion-presets';
import { syncAnimationsToSpec } from './animation-sync';
import { motionTargets, setAnimation, toIdList, resolveScope, commitScope } from './motion';
import { mergeFragment, MergeError, trackEnd } from './motion-merge';
import { isKnownEasing, describeEasings } from '../../animation/easing';

// ── op:sequence ──────────────────────────────────────────────

export interface SequenceStep {
  preset: string;
  layer_ids?: unknown;
  /** When the step starts, ms from scene start. Default: right after the previous step ends. */
  at?: number;
  duration?: number;
  stagger_ms?: number;
  easing?: string;
  distance?: number;
}

type SequenceArgs = {
  design_path: string;
  steps: unknown;
  page_id?: string;
  project_path?: string;
};

const ANIM_CHANNELS = new Set(['x', 'y', 'width', 'height', 'rotation', 'opacity', 'scale', 'scale_x', 'scale_y', 'skew_x', 'skew_y', 'blur', 'draw', 'fill.color', 'stroke.color']);
const ANCHORS = new Set<string>(['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right']);

function parseSteps(v: unknown): SequenceStep[] | string {
  if (!Array.isArray(v) || v.length === 0) return 'steps must be a non-empty array of {preset, layer_ids?, at?, duration?, stagger_ms?, easing?, distance?}.';
  const out: SequenceStep[] = [];
  for (const [i, s] of v.entries()) {
    if (!s || typeof s !== 'object') return `steps[${i}] is not an object.`;
    const st = s as Record<string, unknown>;
    if (!isMotionPreset(st['preset'])) return `steps[${i}].preset "${String(st['preset'])}" is unknown. Presets: ${PRESET_NAMES.join(', ')}.`;
    if (st['easing'] !== undefined && !isKnownEasing(st['easing'])) return `steps[${i}].easing "${String(st['easing'])}" is unknown — run animation(op:presets) for the list.`;
    // `layer_id` (singular) is what the sibling op:track takes, so a model that
    // learned the shape there writes it here too. An unrecognised key meant "no
    // ids", and no ids means THE WHOLE PAGE — so one step aimed at a single
    // headline silently animated all seven layers of the preset and reported
    // success, and a second step then collided with it and blamed a layer the
    // caller had never named. (Omitting ids DELIBERATELY is still a real move —
    // a closing fade_out over everything — so only the alias is added here.)
    out.push({
      preset: st['preset'] as string,
      layer_ids: st['layer_ids'] ?? st['layer_id'],
      at: typeof st['at'] === 'number' ? st['at'] : undefined,
      duration: typeof st['duration'] === 'number' ? st['duration'] : undefined,
      stagger_ms: typeof st['stagger_ms'] === 'number' ? st['stagger_ms'] : undefined,
      easing: typeof st['easing'] === 'string' ? st['easing'] : undefined,
      distance: typeof st['distance'] === 'number' ? st['distance'] : undefined,
    });
  }
  return out;
}

export function sequenceMotion(args: SequenceArgs): ToolResult {
  const op = 'sequence';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const steps = parseSteps(args.steps);
  if (typeof steps === 'string') return errResult(op, steps, 'Fix the step and call again. animation(op:presets) lists every preset and easing.');

  const bak = snapshot(dPath);
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Run manage_design(op:inspect) to list page ids.');
  let { scope } = scoped;

  const progress: ProgressItem[] = [];
  const timeline: Array<{ step: number; preset: string; layers: string[]; from: number; to: number }> = [];
  let cursor = 0;

  for (const [i, step] of steps.entries()) {
    const preset = step.preset as MotionPreset;
    const targets = motionTargets(scope, toIdList(step.layer_ids));
    if (targets.length === 0) {
      return errResult(op, `steps[${i}] matched no layers.`, 'Pass real layer ids from manage_design(op:inspect), or omit layer_ids to target the whole page.', progress);
    }
    const stagger = Math.max(0, step.stagger_ms ?? 0);
    const at = Math.max(0, step.at ?? cursor);
    const updates = new Map<string, unknown>();
    let stepEnd = at;

    for (const [j, layer] of targets.entries()) {
      const frag = expandPreset(preset, {
        duration: step.duration, easing: step.easing, distance: step.distance, delay: at + stagger * j,
      });
      const existing = (layer as Layer & { animation?: AnimationSpec }).animation;
      try {
        const merged = PRESET_KIND[preset] === 'loop' && !existing?.keyframes?.length
          ? { keyframes: frag.keyframes, playback: frag.playback }
          : mergeFragment(existing, frag);
        updates.set(layer.id, merged);
        stepEnd = Math.max(stepEnd, PRESET_KIND[preset] === 'loop' ? at : trackEnd(merged));
      } catch (e) {
        if (e instanceof MergeError) return errResult(op, `steps[${i}] on "${layer.id}": ${e.message}`, e.hint, progress);
        throw e;
      }
    }
    scope = setAnimation(scope, updates);
    timeline.push({ step: i, preset, layers: targets.map(l => l.id), from: at, to: stepEnd });
    progress.push(pOk(`${i + 1}. ${preset} × ${targets.length} @ ${at}ms`, PRESET_NOTES[preset]));
    if (PRESET_KIND[preset] !== 'loop') cursor = stepEnd;
  }

  commitScope(spec, scoped.page, scope);
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);

  const sceneMs = Math.max(...timeline.map(t => t.to), 0);
  progress.push(pInfo('Scene length', `${sceneMs}ms — export with animation(op:export, type:"svg"|"gif")`));
  return okResult(op, {
    design_path: dPath, steps: timeline, scene_ms: sceneMs, progress,
    next_action: {
      tool: 'animation', params: { op: 'frame', design_path: dPath, t: Math.round(sceneMs / 2) }, remaining: 0,
      hint: 'op:frame renders a still at any time so you can check a pose; op:timeline shows the tracks; op:export writes the file.',
    },
  }, bak);
}

// ── op:track ─────────────────────────────────────────────────

type TrackArgs = {
  design_path: string;
  layer_id?: string;
  layer_ids?: unknown;
  keyframes: unknown;
  playback?: unknown;
  stagger_ms?: number;
  page_id?: string;
  project_path?: string;
};

function validateKeyframes(v: unknown): Keyframe[] | string {
  if (!Array.isArray(v) || v.length < 2) return 'keyframes must be an array of at least two {t, …} objects.';
  const out: Keyframe[] = [];
  for (const [i, k] of v.entries()) {
    if (!k || typeof k !== 'object') return `keyframes[${i}] is not an object.`;
    const kf = k as Record<string, unknown>;
    if (typeof kf['t'] !== 'number' || kf['t'] < 0) return `keyframes[${i}].t must be a number of ms ≥ 0.`;
    if (kf['easing'] !== undefined && !isKnownEasing(kf['easing'])) return `keyframes[${i}].easing "${String(kf['easing'])}" is unknown.`;
    for (const key of Object.keys(kf)) {
      if (key === 't' || key === 'easing' || key === 'hold') continue;
      if (!ANIM_CHANNELS.has(key)) return `keyframes[${i}].${key} is not an animatable channel. Channels: ${[...ANIM_CHANNELS].join(', ')}.`;
      const val = kf[key];
      const isColor = key.endsWith('.color');
      if (isColor ? typeof val !== 'string' : typeof val !== 'number') return `keyframes[${i}].${key} must be a ${isColor ? 'hex colour string' : 'number'}.`;
    }
    out.push(kf as Keyframe);
  }
  return out.sort((a, b) => a.t - b.t);
}

function validatePlayback(v: unknown, frames: Keyframe[]): NonNullable<AnimationSpec['playback']> | string {
  const pb = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const span = frames[frames.length - 1].t - frames[0].t;
  const duration = typeof pb['duration'] === 'number' && pb['duration'] > 0 ? pb['duration'] : (span > 0 ? span : 1000);
  if (pb['easing'] !== undefined && !isKnownEasing(pb['easing'])) return `playback.easing "${String(pb['easing'])}" is unknown.`;
  if (pb['anchor'] !== undefined && !ANCHORS.has(String(pb['anchor']))) return `playback.anchor must be one of: ${[...ANCHORS].join(', ')}.`;
  if (pb['origin'] !== undefined && pb['origin'] !== 'first' && pb['origin'] !== 'offset') return 'playback.origin must be "first" or "offset".';
  return {
    duration,
    // Hand-written tracks default to offsets: 0 means "where the layer is",
    // which is what a model reasoning about deltas expects.
    origin: (pb['origin'] as 'first' | 'offset' | undefined) ?? 'offset',
    ...(pb['loop'] === true ? { loop: true } : {}),
    ...(typeof pb['iterations'] === 'number' ? { iterations: pb['iterations'] } : {}),
    ...(pb['direction'] === 'alternate' || pb['direction'] === 'reverse' ? { direction: pb['direction'] } : {}),
    ...(typeof pb['easing'] === 'string' ? { easing: pb['easing'] } : {}),
    ...(typeof pb['delay'] === 'number' ? { delay: Math.max(0, pb['delay']) } : {}),
    ...(pb['anchor'] ? { anchor: pb['anchor'] as AnchorPoint } : {}),
  };
}

export function setTrack(args: TrackArgs): ToolResult {
  const op = 'track';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const ids = toIdList(args.layer_ids) ?? (args.layer_id ? [args.layer_id] : undefined);
  if (!ids) return errResult(op, 'layer_id (or layer_ids) is required.', 'Run manage_design(op:inspect) to find ids.');
  const frames = validateKeyframes(args.keyframes);
  if (typeof frames === 'string') return errResult(op, frames, 'Example: keyframes:[{t:0,opacity:0,y:24,easing:"ease-out-expo"},{t:600,opacity:1,y:0}]');
  const playback = validatePlayback(args.playback, frames);
  if (typeof playback === 'string') return errResult(op, playback, 'Run animation(op:presets) for the easing and anchor lists.');

  const bak = snapshot(dPath);
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Run manage_design(op:inspect) to list page ids.');
  const targets = motionTargets(scoped.scope, ids);
  if (targets.length === 0) return errResult(op, `No layer matched: ${ids.join(', ')}`, 'Ids are case-sensitive; inspect the design to see the real ones.');

  const stagger = Math.max(0, args.stagger_ms ?? 0);
  const updates = new Map<string, unknown>();
  targets.forEach((l, i) => {
    const delay = (playback.delay ?? 0) + stagger * i;
    updates.set(l.id, { keyframes: frames, playback: { ...playback, ...(delay > 0 ? { delay } : {}) } });
  });
  commitScope(spec, scoped.page, setAnimation(scoped.scope, updates));
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);

  const progress: ProgressItem[] = [pOk(`Track written on ${targets.length} layer${targets.length === 1 ? '' : 's'}`, `${frames.length} keyframes · ${playback.duration}ms${playback.loop ? ' · loop' : ''}`)];
  const missing = ids.filter(id => !targets.some(t => t.id === id));
  if (missing.length) progress.push(pWarn('Not found', missing.join(', ')));
  return okResult(op, { design_path: dPath, layers: targets.map(l => l.id), keyframes: frames, playback, progress }, bak);
}

// ── op:clear ─────────────────────────────────────────────────

export function clearMotion(args: { design_path: string; layer_ids?: unknown; page_id?: string; project_path?: string }): ToolResult {
  const op = 'clear';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const bak = snapshot(dPath);
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Run manage_design(op:inspect) to list page ids.');

  const wanted = toIdList(args.layer_ids);
  const cleared: string[] = [];
  const updates = new Map<string, unknown>();
  const visit = (l: Layer): void => {
    const anim = (l as Layer & { animation?: unknown }).animation;
    if (anim && (!wanted || wanted.includes(l.id))) { updates.set(l.id, undefined); cleared.push(l.id); }
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) for (const k of kids) visit(k);
  };
  for (const l of scoped.scope) visit(l);

  commitScope(spec, scoped.page, setAnimation(scoped.scope, updates));
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);
  return okResult(op, { design_path: dPath, cleared, progress: [pOk(`Cleared motion on ${cleared.length} layer${cleared.length === 1 ? '' : 's'}`)] }, bak);
}

// ── op:presets ───────────────────────────────────────────────

export function listMotionPresets(): ToolResult {
  const byKind = presetsByKind();
  const describe = (names: MotionPreset[]): Record<string, string> => Object.fromEntries(names.map(n => [n, PRESET_NOTES[n]]));
  return okResult('presets', {
    entrances: describe(byKind.entrance),
    exits: describe(byKind.exit),
    loops: describe(byKind.loop),
    easings: describeEasings(),
    channels: [...ANIM_CHANNELS],
    anchors: [...ANCHORS],
    how: 'op:sequence chains presets into a scene (steps:[{preset, layer_ids, at?, stagger_ms?}]); op:track writes raw keyframes with per-frame easing/hold; op:frame renders a still at time t; op:export writes svg/html/gif.',
    progress: [],
  });
}
