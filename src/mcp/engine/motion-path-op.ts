// `animation(op:"motion_path")` — send a layer along a curve.
//
// The field, the schema and the SVG renderer have all supported this since the
// motion work landed; nothing could SET it. docs/MOTION.md §5: "rendered but
// not surfaced as an MCP op or sampled by the flipbook". Both halves close
// together — this writes the field, gif-frames.ts samples it — because shipping
// only this one would have let a model author travel that every exported frame
// then ignored.
//
// The path is the MODEL'S (§0.4). The engine validates that it can be walked,
// reports how long it is, and refuses what it cannot reproduce — it never
// supplies a shape.
import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo, buildContext, buildHandover } from './utils';
import { samplePath } from '../../animation/motion-path';
import { resolveScope, commitScope } from './motion';

export interface MotionPathArgs {
  design_path: string;
  project_path?: string;
  page_id?: string;
  layer_ids?: string[];
  path?: string;
  duration?: number;
  loop?: boolean;
  easing?: string;
  auto_rotate?: boolean;
  /** Remove the path from the named layers instead of setting one. */
  clear?: boolean;
}

function findLayers(scope: Layer[], ids: Set<string>, out: Layer[] = []): Layer[] {
  for (const l of scope) {
    if (ids.has(String((l as { id?: unknown }).id ?? ''))) out.push(l);
    const kids = (l as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) findLayers(kids, ids, out);
  }
  return out;
}

export function setMotionPath(args: MotionPathArgs): ToolResult {
  const op = 'motion_path';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const ids = (args.layer_ids ?? []).map(String).filter(Boolean);
  if (ids.length === 0) {
    return errResult(op, 'No layer_ids given', 'Name the layers to move, e.g. layer_ids:["logo"]. manage_design {op:"inspect"} lists them.');
  }

  // Validate BEFORE touching the file: a path the flipbook cannot walk would
  // animate in the browser and stand still in every export, which is exactly
  // the split this op exists to close.
  let length = 0;
  if (!args.clear) {
    if (!args.path || !args.path.trim()) {
      return errResult(op, 'No path given', 'Pass an SVG path, e.g. path:"M 0 0 Q 200 -120 400 0". Or pass clear:true to remove one.');
    }
    const sp = samplePath(args.path);
    if (!sp) {
      return errResult(op,
        `Cannot walk that path: ${args.path.slice(0, 80)}`,
        'Supported: M L H V C S Q T Z, absolute or relative. Elliptical arcs (A) are refused because the '
        + 'exporter would have to approximate them and the exported frames would then disagree with the '
        + 'browser. Rebuild the curve with C or Q. The path is an OFFSET from where the layer already sits, '
        + 'so it normally starts at "M 0 0".');
    }
    length = Math.round(sp.length);
    if (length === 0) {
      return errResult(op, 'That path has no length', 'Every point on it is the same point, so nothing would move. Give it somewhere to go.');
    }
  }

  const bak = snapshot(dPath);
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');

  const targets = findLayers(scoped.scope, new Set(ids));
  const found = new Set(targets.map(l => String((l as { id?: unknown }).id ?? '')));
  const missing = ids.filter(i => !found.has(i));
  if (targets.length === 0) {
    return errResult(op, `No such layer(s): ${ids.join(', ')}`, 'manage_design {op:"inspect"} lists the ids on this page.');
  }

  for (const l of targets) {
    const o = l as unknown as Record<string, unknown>;
    if (args.clear) { delete o['motion_path']; continue; }
    o['motion_path'] = {
      path: args.path,
      duration: typeof args.duration === 'number' && args.duration > 0 ? args.duration : 2000,
      ...(args.loop !== undefined ? { loop: args.loop } : {}),
      ...(args.easing ? { easing: args.easing } : {}),
      ...(args.auto_rotate !== undefined ? { auto_rotate: args.auto_rotate } : {}),
    };
  }
  commitScope(spec, scoped.page, scoped.scope);
  writeYAML(dPath, spec);

  const moved = targets.map(l => String((l as { id?: unknown }).id ?? ''));
  progress.push(pOk(args.clear ? 'Motion path cleared' : 'Motion path set', moved.join(', ')));
  if (!args.clear) progress.push(pInfo('Path length', `${length}px over ${args.duration ?? 2000}ms`));
  if (missing.length) progress.push(pInfo('Not found', missing.join(', ')));

  return okResult(op, {
    status: 'ok', layers: moved, cleared: args.clear === true,
    ...(missing.length ? { not_found: missing } : {}),
    ...(args.clear ? {} : { path_length_px: length, duration_ms: args.duration ?? 2000, loop: args.loop === true }),
    note: args.clear
      ? 'These layers no longer travel.'
      : 'The path OFFSETS the layer from where it already sits — "M 0 0 …" starts where you placed it. It plays '
        + 'in the SVG/HTML route and is sampled by animation {op:"frame"} and the GIF export, so the still you '
        + 'inspect is the still that exports.',
    progress,
    context: buildContext(op, `${args.clear ? 'Cleared' : 'Set'} motion path on ${moved.length} layer(s)`, [{ type: 'design', path: dPath, role: 'updated' }]),
    handover: buildHandover('PATCH', { design_path: dPath }),
  }, bak);
}
