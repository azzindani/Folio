/**
 * `animation(op:storyboard | lint)` — one continuous scene, told in shots.
 *
 *   storyboard  the model writes WHERE each object is in each shot; the engine
 *               writes the keyframes that carry it there (Magic Move), the
 *               in/out windows that follow from what enters and leaves, and a
 *               marker per shot. Output is ordinary tracks: op:track, op:frame
 *               and op:timeline work on every one of them.
 *   lint        the time-aware checks on any page, without writing anything.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo, pWarn } from './utils';
import { resolveScope, commitScope, setAnimation } from './motion';
import { syncAnimationsToSpec } from './animation-sync';
import { readMarkers, writeMarkers, resolveTime, shotMarks } from './motion-time';
import { compileStates, type CompiledStates } from './motion-states';
import { parseStoryboard } from './motion-storyboard-parse';
import { lintComposition, type LintNote } from './motion-lint';
import { animationDuration } from '../../export/gif-frames';

type StoryboardArgs = {
  design_path: string; page_id?: string; project_path?: string;
  shots?: unknown; length_ms?: unknown; hold_ms?: number; markers?: boolean;
};

const LAST_HOLD = 2500;

/** Set or clear the in/out points the storyboard owns, wherever those layers sit. */
function applyWindows(layers: Layer[], wins: Map<string, { in?: number; out?: number }>): Layer[] {
  return layers.map(l => {
    let next = l as Layer & { in?: number; out?: number; layers?: Layer[] };
    const w = wins.get(l.id);
    if (w) {
      const { in: _i, out: _o, ...rest } = next;
      void _i; void _o;
      next = { ...rest, ...(w.in !== undefined ? { in: w.in } : {}), ...(w.out !== undefined ? { out: w.out } : {}) } as typeof next;
    }
    return Array.isArray(next.layers) ? { ...next, layers: applyWindows(next.layers, wins) } as Layer : next as Layer;
  });
}

const lintProgress = (notes: LintNote[]): ProgressItem[] => notes.length === 0
  ? [pOk('Lint: clean', 'no overlaps, edges, idle stretches, crowded moments or rushed reading found')]
  : notes.slice(0, 8).map(n => pWarn(`Lint · ${n.kind}${n.shot ? ` · ${n.shot}` : ''}`, n.note));

export function storyboardMotion(args: StoryboardArgs): ToolResult {
  const op = 'storyboard';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const markers = readMarkers(spec, scoped.page);
  const parsed = parseStoryboard(args.shots, scoped.scope, markers);
  if (typeof parsed === 'string') {
    return errResult(op, parsed, 'e.g. shots:[{id:"hook", at:0, states:{title:{x:120, y:400}, logo:"hidden"}}, {id:"problem", at:4000, states:{title:{x:60, y:60, scale:0.4}, card1:"rise"}}]');
  }

  // Compile once to learn where the last move lands, then again holding every track to the end.
  const compileAll = (end: number): Map<string, CompiledStates> =>
    new Map([...parsed.changes].map(([id, ch]) => [id, compileStates(parsed.targets.get(id) as Layer, ch, end)]));
  const draft = compileAll(0);
  const lastShot = parsed.shots[parsed.shots.length - 1];
  const landed = Math.max(lastShot?.at ?? 0, ...[...draft.values()].flatMap(c => c.landings.map(l => l.to)));
  let end = landed + Math.max(0, args.hold_ms ?? LAST_HOLD);
  const progress: ProgressItem[] = [];
  if (args.length_ms !== undefined) {
    const t = resolveTime(args.length_ms, { markers, layers: scoped.scope });
    if (typeof t === 'string') return errResult(op, `length_ms: ${t}`, 'A time in ms or a name like "cta+3000".');
    if (t < landed) progress.push(pWarn('Cut short', `length_ms ${t}ms ends before the last move lands (${landed}ms).`));
    end = t;
  }
  const compiled = compileAll(end);

  const replaced = [...parsed.targets.values()].filter(l => (l as Layer & { animation?: AnimationSpec }).animation?.keyframes?.length).map(l => l.id);
  const bak = snapshot(dPath);
  let scope = setAnimation(scoped.scope, new Map([...compiled].map(([id, c]) => [id, c.animation])));
  scope = applyWindows(scope, new Map([...compiled].map(([id, c]) => [id, { in: c.in, out: c.out }])));
  commitScope(spec, scoped.page, scope);
  if (args.markers !== false) writeMarkers(spec, scoped.page, { ...markers, ...Object.fromEntries(parsed.shots.map(s => [s.id, s.at])) });
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);

  const canvas = { width: spec.document?.width ?? 1080, height: spec.document?.height ?? 1080 };
  const lint = lintComposition(scope, canvas, parsed.shots, end);
  const shots = parsed.shots.map((s, i) => ({ id: s.id, at: s.at, until: parsed.shots[i + 1]?.at ?? end, layers: s.layers }));
  progress.unshift(pOk(`Storyboard: ${parsed.shots.length} shot(s), ${compiled.size} layer(s)`, `one continuous scene of ${end}ms — each layer is one ordinary track`));
  if (replaced.length) progress.push(pWarn('Replaced existing motion', `${replaced.join(', ')} — the storyboard owns these tracks now.`));
  for (const c of compiled.values()) for (const n of c.notes) progress.push(pWarn('Timing', n));
  progress.push(...lintProgress(lint));
  const probe = shots[Math.min(1, shots.length - 1)];
  return okResult(op, {
    design_path: dPath, scene_ms: end, shots,
    tracks: [...compiled].map(([id, c]) => ({ layer: id, ...(c.in !== undefined ? { in: c.in } : {}), ...(c.out !== undefined ? { out: c.out } : {}), landings: c.landings })),
    lint, ...(replaced.length ? { replaced } : {}), progress,
    next_action: { tool: 'animation', params: { op: 'frame', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}), t: Math.max(0, (probe?.until ?? end) - 1) }, remaining: 0,
      hint: 'op:frame at a shot\'s rest checks the layout; call op:storyboard again with changed states to re-block. Shot ids are markers now: other ops take at:"<shot>+ms".' },
  }, bak);
}

export function lintMotion(args: { design_path: string; page_id?: string; project_path?: string }): ToolResult {
  const op = 'lint';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const end = animationDuration(scoped.scope);
  if (end <= 0) return errResult(op, 'Nothing on this page moves, so there is no timeline to check.', 'Build one with animation(op:storyboard) or op:sequence first.');
  const marks = shotMarks(spec, scoped.scope, scoped.page).sort((a, b) => a.at - b.at);
  const notes = lintComposition(scoped.scope, { width: spec.document?.width ?? 1080, height: spec.document?.height ?? 1080 }, marks, end);
  return okResult(op, {
    design_path: dPath, scene_ms: end, marks, notes,
    progress: [pInfo(`Checked ${end}ms`, marks.length ? `${marks.length} marker(s) as shots` : 'no markers — the whole piece as one shot'), ...lintProgress(notes)],
  });
}
