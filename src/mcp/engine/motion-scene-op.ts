/**
 * animation(op:scene) — how one page plays as a scene of a multi-scene piece.
 *
 * A page already holds what a scene needs: its own timeline (every motion op
 * takes page_id), `transition` — how it ENTERS — and `auto_advance`, its exact
 * length. This is the one door that writes the last two, checks them first, and
 * answers with the whole piece's plan so the caller sees what changed.
 */

import * as fs from 'fs';
import type { DesignSpec, Page, PageTransition, PageTransitionType } from '../../schema/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk } from './utils';
import { holdToLength } from './motion-poster-length';
import { animationDuration, oneShotDuration } from '../../export/gif-frames';
import { sourceOptions } from '../../renderer/resolve-source';
import { syncAnimationsToSpec } from './animation-sync';
import { isKnownEasing } from '../../animation/easing';
import { planScenes, type ScenePlan } from '../../export/scene-plan';
import { APPROXIMATED } from '../../export/scene-transition';
import { hasSound, resolveSound } from './sound-resolve';
import { soundTimeline } from './motion-audio-op';

const TRANSITIONS: readonly PageTransitionType[] = [
  'none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom-in', 'zoom-out',
  'flip-h', 'flip-v', 'cube-left', 'cube-right', 'reveal', 'wipe-left', 'wipe-right', 'dissolve', 'morph',
];
const MAX_TRANSITION_MS = 3000;

type SceneArgs = {
  design_path: string;
  page_id?: string;
  transition?: unknown;
  length_ms?: unknown;
  project_path?: string;
};

/** null = remove (a cut); a string = the problem. */
function parseTransition(v: unknown): PageTransition | null | string {
  if (v === null || v === 'none') return null;
  const raw = typeof v === 'string' ? { type: v } : v;
  if (!raw || typeof raw !== 'object') return 'transition must be a type name or {type, duration?, easing?}.';
  const o = raw as Record<string, unknown>;
  if (o['type'] === 'none') return null;
  if (!TRANSITIONS.includes(o['type'] as PageTransitionType)) return `transition.type "${String(o['type'])}" is unknown. Types: ${TRANSITIONS.join(', ')}.`;
  if (o['duration'] !== undefined && (typeof o['duration'] !== 'number' || o['duration'] < 0 || o['duration'] > MAX_TRANSITION_MS)) {
    return `transition.duration must be ms between 0 and ${MAX_TRANSITION_MS}.`;
  }
  if (o['easing'] !== undefined && !isKnownEasing(o['easing'])) return `transition.easing "${String(o['easing'])}" is unknown — animation(op:presets) lists the curves.`;
  return {
    type: o['type'] as PageTransitionType,
    ...(typeof o['duration'] === 'number' ? { duration: Math.round(o['duration']) } : {}),
    ...(typeof o['easing'] === 'string' ? { easing: o['easing'] as NonNullable<PageTransition['easing']> } : {}),
  };
}

/** The piece as text: one bar per scene, ▒ where it transitions in. */
export function renderScenesASCII(plan: ScenePlan, width = 56): string {
  const total = Math.max(1, plan.total_ms);
  const col = (ms: number): number => Math.min(width - 1, Math.max(0, Math.round((ms / total) * (width - 1))));
  const lines = [`Piece ${total}ms · ${plan.scenes.length} scene${plan.scenes.length === 1 ? '' : 's'} · ═ on screen · ▒ transition in`];
  for (const s of plan.scenes) {
    const bar = Array<string>(width).fill('·');
    const a = col(s.start_ms), b = Math.max(a, col(s.start_ms + s.length_ms) - 1);
    for (let i = a; i <= b; i++) bar[i] = '═';
    if (s.transition) for (let i = a; i <= Math.max(a, col(s.start_ms + s.transition.duration_ms) - 1); i++) bar[i] = '▒';
    const label = (s.page_id + ' ').padEnd(13).slice(0, 13);
    lines.push(`${label}|${bar.join('')}| ${(s.length_ms / 1000).toFixed(1)}s${s.transition ? ` · ${s.transition.type} ${s.transition.duration_ms}ms` : ''}`);
  }
  return lines.join('\n');
}

/** animation(op:timeline, scenes:true) — when every scene is on screen, and how each enters. */
export function sceneTimeline(args: { design_path: string; hold_ms?: number; project_path?: string }): ToolResult {
  const op = 'timeline';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  if (!spec.pages?.length) return errResult(op, 'scenes:true reads pages, and this design has none.', 'Leave scenes off to see the poster\'s tracks.');
  const plan = planScenes(spec, { hold_ms: args.hold_ms });
  return okResult(op, {
    design_path: dPath,
    total_ms: plan.total_ms,
    scenes: plan.scenes,
    ascii: renderScenesASCII(plan),
    ...(plan.warnings.length ? { notes: plan.warnings } : {}),
  });
}

export function setScene(args: SceneArgs): ToolResult {
  const op = 'scene';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  if (args.transition === undefined && args.length_ms === undefined) {
    return errResult(op, 'Nothing to change.', 'Pass transition (how the page enters) and/or length_ms (how long it is on screen; 0 = motion + hold).');
  }
  const transition = args.transition === undefined ? undefined : parseTransition(args.transition);
  if (typeof transition === 'string') return errResult(op, transition, 'e.g. transition:{type:"slide-left", duration:500, easing:"ease-in-out-cubic"}');
  if (args.length_ms !== undefined && (typeof args.length_ms !== 'number' || args.length_ms < 0)) {
    return errResult(op, 'length_ms must be a number of ms ≥ 0.', '0 clears it, so the scene lasts its motion plus the export hold.');
  }

  const spec = readYAML<DesignSpec>(dPath);
  const pages = spec.pages ?? [];
  // A piece without pages — a looping GIF, a sting — has no scene to enter, but it
  // has a length: its tracks hold their last pose to it (motion-poster-length.ts).
  if (!pages.length) {
    if (args.transition !== undefined || typeof args.length_ms !== 'number') {
      return errResult(op, 'This design has no pages, so nothing enters: a transition needs a page to play between.', 'length_ms still sets how long it lasts — every track holds its last pose to it.');
    }
    // Found live (character lab): a piece moved only by loops, rules and script components
    // was refused — "Nothing here moves" — because only keyframed one-shot tracks were counted.
    const length = Math.round(args.length_ms);
    const { length_ms: _was, ...rest } = spec;
    void _was;
    const own = sourceOptions(rest as DesignSpec);
    if (animationDuration(spec.layers ?? [], own) <= 0) {
      return errResult(op, 'Nothing here moves, so there is no length to set.', 'Give a layer motion first (op:motion, op:track, a rule, a loop or a script component), then set how long the piece lasts.');
    }
    const held = holdToLength(spec.layers ?? [], length);
    if ('error' in held) return errResult(op, held.error, held.hint);
    const lands = oneShotDuration(spec.layers ?? [], own);
    if (length > 0 && lands > length) {
      return errResult(op, `Motion still runs until ${lands} ms — a length of ${length} ms would cut it off.`, `Use length_ms ≥ ${lands}, or close time first (op:retime with a negative shift_ms).`);
    }
    const bak = snapshot(dPath);
    spec.layers = held.layers;
    if (length > 0) spec.length_ms = length; else delete spec.length_ms;
    syncAnimationsToSpec(spec);
    writeYAML(dPath, spec);
    const lasts = animationDuration(spec.layers ?? [], sourceOptions(spec));
    return okResult(op, {
      design_path: dPath, scene_ms: lasts, tracks_held: held.tracks,
      progress: [pOk(`Lasts ${lasts} ms`, `${held.tracks} track(s) hold their last pose to ${length ? 'it' : 'their own last key'}${length ? '; loops, rules and script components run to it' : ''}`)],
      next_action: { tool: 'animation', params: { op: 'timeline', design_path: dPath }, remaining: 0, hint: 'op:timeline shows the length; a GIF export plays it at this length.' },
    }, bak);
  }
  const pageId = args.page_id ?? (pages.length === 1 ? pages[0]?.id : undefined);
  if (pageId === undefined) return errResult(op, 'page_id is needed: this piece has several scenes.', `Pages: ${pages.map(p => p.id).join(', ')}.`);
  const index = pages.findIndex((p: Page) => p.id === pageId);
  if (index < 0) return errResult(op, `Page not found: ${pageId}`, 'Run manage_design(op:inspect) to list page ids.');
  const bak = snapshot(dPath);
  const page = pages[index];

  if (transition === null) delete page.transition;
  else if (transition) page.transition = transition;
  if (typeof args.length_ms === 'number') {
    if (args.length_ms === 0) delete page.auto_advance;
    else page.auto_advance = Math.round(args.length_ms);
  }
  writeYAML(dPath, spec);

  const plan = planScenes(spec);
  // The music has to reach wherever the scenes now end. Live, a bed cut to the old length went
  // quiet 3.6 s early after the scenes grew, and no scene reply said so.
  const soundNotes = hasSound(spec) ? resolveSound(spec, dPath, soundTimeline(spec), args.project_path).plan.notes : [];
  const notes = [
    ...plan.warnings,
    ...soundNotes,
    ...(index === 0 && page.transition ? ['This is the first scene: there is nothing to transition from, so its transition does not play.'] : []),
    ...(page.transition && APPROXIMATED[page.transition.type] ? [`${page.transition.type} ${APPROXIMATED[page.transition.type]}.`] : []),
  ];
  return okResult(op, {
    design_path: dPath,
    page_id: page.id,
    transition: page.transition ?? 'cut',
    length_ms: page.auto_advance ?? 'motion + hold',
    total_ms: plan.total_ms,
    scenes: plan.scenes.map(s => ({ page_id: s.page_id, start_ms: s.start_ms, length_ms: s.length_ms, transition: s.transition ? `${s.transition.type} ${s.transition.duration_ms}ms` : 'cut' })),
    ...(notes.length ? { notes } : {}),
    next_action: {
      tool: 'animation', params: { op: 'export', design_path: dPath, type: 'mp4', scenes: true }, remaining: 0,
      hint: 'animation(op:frame, scenes:true, t) shows any moment of the piece — including mid-transition — before you export.',
    },
  }, bak);
}
