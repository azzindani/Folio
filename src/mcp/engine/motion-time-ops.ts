/**
 * `animation(op:markers | span)` — the time model of a continuous composition.
 *
 *   markers  named points on the scene clock ("hook", "problem", "cta"). Every
 *            composition op takes a time as a marker, a layer point or ms.
 *   span     a layer's in and out points: it exists only between them, so forty
 *            layers can take turns on one page — and a hidden layer costs a
 *            raster frame nothing.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec, TimeMarkers } from '../../animation/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn } from './utils';
import { resolveScope, commitScope, toIdList, motionTargets } from './motion';
import { readMarkers, writeMarkers, resolveTime, usableMarkerName, type TimeContext } from './motion-time';
import { trackEnd } from './motion-merge';

type MarkersArgs = { design_path: string; page_id?: string; project_path?: string; markers?: unknown; clear?: boolean };
type SpanArgs = {
  design_path: string; page_id?: string; project_path?: string;
  layer_id?: string; layer_ids?: unknown; in?: unknown; out?: unknown; clear?: boolean;
};

const listed = (m: TimeMarkers): Array<{ name: string; ms: number }> =>
  Object.entries(m).sort((a, b) => a[1] - b[1]).map(([name, ms]) => ({ name, ms }));

export function markersMotion(args: MarkersArgs): ToolResult {
  const op = 'markers';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');

  const before = readMarkers(spec, scoped.page);
  const changes = args.markers;
  if (changes === undefined && !args.clear) {
    return okResult(op, { design_path: dPath, markers: listed(before), progress: [pOk(`${Object.keys(before).length} marker(s)`)] });
  }
  if (changes !== undefined && (typeof changes !== 'object' || changes === null || Array.isArray(changes))) {
    return errResult(op, 'markers must be an object of name → time.', 'e.g. markers:{hook:0, problem:4000, cta:"problem+6000"} — null removes one.');
  }
  const next: TimeMarkers = args.clear ? {} : { ...before };
  const ctx: TimeContext = { markers: next, layers: scoped.scope };
  // In the order given, so a marker can be set relative to one set just before it.
  for (const [name, ref] of Object.entries((changes ?? {}) as Record<string, unknown>)) {
    if (!usableMarkerName(name)) return errResult(op, `Marker name "${name}" is not usable in a time.`, 'Letters, digits, _ and -, starting with a letter, not ending in -digits (that reads as an offset): "hook", "act_2".');
    if (ref === null) { delete next[name]; continue; }
    const ms = resolveTime(ref, ctx);
    if (typeof ms === 'string') return errResult(op, `markers.${name}: ${ms}`, 'Fix that time and call again.');
    next[name] = ms;
  }
  const bak = snapshot(dPath);
  writeMarkers(spec, scoped.page, next);
  writeYAML(dPath, spec);
  return okResult(op, {
    design_path: dPath, markers: listed(next),
    progress: [pOk(`${Object.keys(next).length} marker(s) on the scene clock`, 'Any composition time can now be "name", "name+ms" or "name-ms".')],
    next_action: { tool: 'animation', params: { op: 'timeline', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}) }, remaining: 0,
      hint: 'op:timeline draws the markers over the tracks. op:storyboard names each shot as a marker itself.' },
  }, bak);
}

/** In/out on one layer, anywhere in the tree. `null` for a point removes it. */
function setWindow(layers: Layer[], id: string, win: { in?: number | null; out?: number | null }): Layer[] {
  return layers.map(l => {
    let next = l as Layer & { in?: number; out?: number; layers?: Layer[] };
    if (l.id === id) {
      next = { ...next };
      if (win.in === null) delete next.in; else if (win.in !== undefined) next.in = win.in;
      if (win.out === null) delete next.out; else if (win.out !== undefined) next.out = win.out;
    }
    return Array.isArray(next.layers) ? { ...next, layers: setWindow(next.layers, id, win) } as Layer : next as Layer;
  });
}

export function spanMotion(args: SpanArgs): ToolResult {
  const op = 'span';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const ids = toIdList(args.layer_ids) ?? (args.layer_id ? [args.layer_id] : undefined);
  if (!ids) return errResult(op, 'layer_id (or layer_ids) is required.', 'Name the layers whose in/out points to set.');
  if (args.in === undefined && args.out === undefined && !args.clear) {
    return errResult(op, 'Give in, out, or clear:true.', 'e.g. in:"problem", out:"cta-200" — a layer exists only between them.');
  }
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const found = motionTargets(scoped.scope, ids);
  if (found.length === 0) return errResult(op, `No layer matched: ${ids.join(', ')}`, 'manage_design {op:"inspect"} lists the ids.');

  const ctx: TimeContext = { markers: readMarkers(spec, scoped.page), layers: scoped.scope };
  const read = (v: unknown, label: string): number | null | undefined | string => {
    if (args.clear) return null;
    if (v === undefined) return undefined;
    if (v === null) return null;
    const ms = resolveTime(v, ctx);
    return typeof ms === 'string' ? `${label}: ${ms}` : ms;
  };
  const tIn = read(args.in, 'in'), tOut = read(args.out, 'out');
  if (typeof tIn === 'string') return errResult(op, tIn, 'Fix that time and call again.');
  if (typeof tOut === 'string') return errResult(op, tOut, 'Fix that time and call again.');

  const progress: ProgressItem[] = [];
  const windows: Array<{ id: string; in?: number; out?: number }> = [];
  let scope = scoped.scope;
  for (const l of found as Array<Layer & { in?: number; out?: number; animation?: AnimationSpec }>) {
    const a = tIn === undefined ? l.in : tIn ?? undefined;
    const b = tOut === undefined ? l.out : tOut ?? undefined;
    if (a !== undefined && b !== undefined && b <= a) return errResult(op, `"${l.id}": out (${b}ms) must come after in (${a}ms).`, 'A layer needs some time on screen.');
    scope = setWindow(scope, l.id, { in: tIn, out: tOut });
    windows.push({ id: l.id, ...(a !== undefined ? { in: a } : {}), ...(b !== undefined ? { out: b } : {}) });
    // Motion outside the window never plays — worth a word, not a refusal (a cut can be the point).
    const anim = l.animation;
    if (anim?.keyframes?.length && anim.playback?.loop !== true) {
      const start = anim.playback?.delay ?? 0, end = trackEnd(anim);
      if ((a !== undefined && start < a) || (b !== undefined && end > b)) {
        progress.push(pWarn(`${l.id}: motion runs ${start}–${end}ms`, `outside its window ${a ?? 0}–${b ?? '∞'}ms, so that part never shows.`));
      }
    }
  }
  const bak = snapshot(dPath);
  commitScope(spec, scoped.page, scope);
  writeYAML(dPath, spec);
  progress.unshift(pOk(`${args.clear ? 'Cleared' : 'Set'} in/out on ${found.length} layer(s)`, 'Outside its window a layer is not drawn — in the SVG, the GIF/MP4 and op:frame alike.'));
  return okResult(op, {
    design_path: dPath, windows, progress,
    next_action: { tool: 'animation', params: { op: 'timeline', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}) }, remaining: 0,
      hint: 'op:timeline shows each window as a bar; op:frame at a time inside and outside it shows the layer come and go.' },
  }, bak);
}
