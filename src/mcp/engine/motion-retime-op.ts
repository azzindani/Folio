/**
 * `animation(op:retime)` — a ripple edit on a continuous scene: open `shift_ms`
 * at `at` (a longer shot, a longer rest), or close `-shift_ms` after it. Everything
 * timed at or after `at` moves together — tracks, in/out points, precomp
 * starts, paths, markers, the scene length, and on a one-scene piece its sounds
 * and captions — so one call acts on a lint note like "shot result is 800 ms
 * short of reading time" without re-blocking the piece.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { TimeMarkers } from '../../animation/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn } from './utils';
import { resolveScope, commitScope } from './motion';
import { readMarkers, writeMarkers, resolveTime } from './motion-time';
import { syncAnimationsToSpec } from './animation-sync';
import { animationDuration } from '../../export/gif-frames';
import { rippled, rippleLayers, emptyReport, type Ripple, type RippleReport } from './motion-retime';

type RetimeArgs = { design_path: string; page_id?: string; project_path?: string; at?: unknown; shift_ms?: unknown };

/** A time field after the ripple, recording what a closed span swallows. */
function shift(v: number | undefined, r: Ripple, label: string, rep: RippleReport): number | undefined {
  if (typeof v !== 'number') return v;
  const t = rippled(v, r);
  if (t === null) { rep.blocked.push(`${label} (${v}ms)`); return v; }
  return t;
}

function rippleMarkers(m: TimeMarkers, r: Ripple, rep: RippleReport): TimeMarkers {
  return Object.fromEntries(Object.entries(m).map(([name, t]) => [name, shift(t, r, `marker ${name}`, rep) ?? t]));
}

/**
 * Sound and captions sit on the piece's clock. On a one-scene piece that is the
 * scene's clock, so they move with it; on a deck they belong to every scene, and
 * only the scene's own cues move.
 */
function rippleSoundAndCaptions(spec: DesignSpec, r: Ripple, rep: RippleReport, oneScene: boolean, page?: Page): string[] {
  const moved: string[] = [];
  if (oneScene) {
    spec.audio = spec.audio?.map(a => {
      const start = a.start_time ?? 0;
      const t = shift(start, r, `sound ${a.id}`, rep) ?? start;
      if (t !== start) { moved.push(`sound ${a.id}`); return { ...a, start_time: t }; }
      // A bed playing across the edit plays on through it, to the new end.
      if (typeof a.duration === 'number' && start + a.duration > r.at) {
        moved.push(`sound ${a.id} (runs ${r.by > 0 ? 'longer' : 'shorter'})`);
        return { ...a, duration: Math.max(1, a.duration + r.by) };
      }
      return a;
    });
    if (spec.captions?.cues) {
      spec.captions = { ...spec.captions, cues: spec.captions.cues.map((c, i) => {
        const from = shift(c.from_ms, r, `caption ${i + 1}`, rep) ?? c.from_ms, to = shift(c.to_ms, r, `caption ${i + 1} end`, rep) ?? c.to_ms;
        if (from !== c.from_ms || to !== c.to_ms) moved.push(`caption ${i + 1}`);
        return { ...c, from_ms: from, to_ms: to };
      }) };
    }
  }
  if (page?.audio_cues) page.audio_cues = page.audio_cues.map((a, i) => (typeof a.at === 'number' ? { ...a, at: shift(a.at, r, `sound cue ${a.id ?? i + 1}`, rep) } : a));
  if (page?.captions) page.captions = page.captions.map((c, i) => (typeof c.at === 'number' ? { ...c, at: shift(c.at, r, `scene caption ${i + 1}`, rep) } : c));
  return moved;
}

export function retimeMotion(args: RetimeArgs): ToolResult {
  const op = 'retime';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const by = args.shift_ms;
  if (typeof by !== 'number' || !Number.isFinite(by) || Math.round(by) === 0) {
    return errResult(op, 'shift_ms must be a number of ms, not 0.', 'shift_ms:800 opens 800 ms at `at`; shift_ms:-500 closes the 500 ms after it.');
  }
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const markers = readMarkers(spec, scoped.page);
  const at = resolveTime(args.at, { markers, layers: scoped.scope });
  if (typeof at === 'string') return errResult(op, `at: ${at}`, 'A time in ms or a name: "result+3000" opens time 3 s into the shot "result".');
  const r: Ripple = { at, by: Math.round(by) };

  const rep = emptyReport();
  // A poster's own length (op:scene) moves with the time it spans, like a page's auto_advance.
  const own = (v: number | undefined): { length?: number } => (scoped.page || spec.pages?.length || !v ? {} : { length: v });
  const before = animationDuration(scoped.scope, own(spec.length_ms));
  const layers: Layer[] = rippleLayers(scoped.scope, r, rep);
  const nextMarkers = rippleMarkers(markers, r, rep);
  const page = scoped.page ?? spec.pages?.[0];
  const length = shift(page?.auto_advance, r, 'the scene length', rep);
  const pieceLength = scoped.page || spec.pages?.length ? undefined : shift(spec.length_ms, r, 'the piece length', rep);
  const oneScene = (spec.pages?.length ?? 0) <= 1;
  const sounds = rippleSoundAndCaptions(spec, r, rep, oneScene, page);
  if (rep.blocked.length) {
    return errResult(op, `${rep.blocked.length} thing(s) are timed inside ${at}–${at - r.by}ms, the span to close: ${rep.blocked.slice(0, 8).join('; ')}${rep.blocked.length > 8 ? '; …' : ''}.`,
      'Close a span where nothing starts or lands — a rest — or move those first. op:timeline shows where the tracks sit.');
  }
  const bak = snapshot(dPath);
  commitScope(spec, scoped.page, layers);
  writeMarkers(spec, scoped.page, nextMarkers);
  if (page && typeof length === 'number') page.auto_advance = length;
  if (typeof pieceLength === 'number') spec.length_ms = pieceLength;
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);

  const after = animationDuration(layers, own(spec.length_ms));
  const shifted = Object.entries(nextMarkers).filter(([n, t]) => markers[n] !== t).map(([n]) => n);
  const progress: ProgressItem[] = [pOk(`${r.by > 0 ? 'Opened' : 'Closed'} ${Math.abs(r.by)}ms at ${at}ms`, `${rep.moved.size} layer(s), ${shifted.length} marker(s)${sounds.length ? `, ${sounds.length} sound/caption cue(s)` : ''} moved · scene ${before} → ${after}ms`)];
  if (rep.stretched.length) progress.push(pWarn(`Moves under way at that time now run ${r.by > 0 ? 'longer' : 'shorter'}`, `${rep.stretched.slice(0, 6).join('; ')}${rep.stretched.length > 6 ? '; …' : ''} — pick a rest to keep their speed.`));
  if (rep.untouched.length) progress.push(pWarn('Left as they were', rep.untouched.slice(0, 6).join('; ')));
  if (!oneScene && spec.audio?.length) progress.push(pWarn('Design-wide sound not moved', 'It plays across every scene; move a cue with op:audio start_ms.'));
  return okResult(op, {
    design_path: dPath, at, shift_ms: r.by, scene_ms: { before, after },
    layers_moved: rep.moved.size, markers_moved: shifted, ...(sounds.length ? { cues_moved: sounds } : {}),
    ...(rep.stretched.length ? { stretched: rep.stretched.slice(0, 24) } : {}), ...(rep.untouched.length ? { untouched: rep.untouched } : {}),
    progress,
    next_action: { tool: 'animation', params: { op: 'lint', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}) }, remaining: 0,
      hint: 'op:lint re-measures reading time and rests on the new timing.' },
  }, bak);
}
