// `edit_layer {op:"shape"}` — offset, outline-stroke and blend, over MCP.
//
// docs/MOTION.md §5: "boolean ops and shape paths exist in the renderer; offset
// path, outline stroke, blend/morph between shapes are not exposed." The
// booleans that exist run in the EDITOR and sample paths through a live SVG
// element, so a model driving the engine headlessly could not reach them at
// all. src/engine/path-ops.ts is the pure half; this is the door.
//
// Every result is an ordinary `path` layer, so it renders identically in the
// editor, in resvg exports and in the PDF — nothing here invents a new layer
// type or a rendering special case.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo, buildContext, buildHandover } from './utils';
import { blendPaths, outlineStroke, offsetPath } from '../../engine/path-ops';
import { resolveScope, commitScope } from './motion';

export type ShapeOp = 'offset' | 'outline_stroke' | 'blend';

export interface ShapeOpArgs {
  design_path: string;
  project_path?: string;
  page_id?: string;
  shape_op: ShapeOp;
  layer_ids?: string[];
  /** offset: px to grow (+) or shrink (−). */
  delta?: number;
  /** outline_stroke: the stroke width to outline; defaults to the layer's own. */
  width?: number;
  /** blend: how many in-between shapes to make. */
  steps?: number;
  /** Keep the source layers (default true for blend, false for the others). */
  keep_source?: boolean;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function find(scope: Layer[], ids: string[]): Layer[] {
  const want = new Set(ids);
  const out: Layer[] = [];
  const walk = (ls: Layer[]): void => {
    for (const l of ls) {
      if (want.has(String((l as { id?: unknown }).id ?? ''))) out.push(l);
      const kids = (l as { layers?: Layer[] }).layers;
      if (Array.isArray(kids)) walk(kids);
    }
  };
  walk(scope);
  return out;
}

/** The `d` of a layer that already IS a path. Shapes are converted by the
 *  editor's boolean tool; here we ask for a path so the result is predictable. */
function pathD(l: Layer): string | null {
  const o = l as unknown as Record<string, unknown>;
  const d = o['d'] ?? o['path'];
  return typeof d === 'string' && d.trim() ? d : null;
}

function styleOf(l: Layer): Record<string, unknown> {
  const o = l as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ['fill', 'stroke', 'stroke_width', 'opacity', 'z']) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

export async function shapeOp(args: ShapeOpArgs): Promise<ToolResult> {
  const op = 'shape';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const ids = (args.layer_ids ?? []).map(String).filter(Boolean);
  const need = args.shape_op === 'blend' ? 2 : 1;
  if (ids.length < need) {
    return errResult(op, `${args.shape_op} needs ${need} layer_id(s), got ${ids.length}`,
      args.shape_op === 'blend'
        ? 'Pass the two shapes to blend between, e.g. layer_ids:["start","end"].'
        : 'Pass the path layer to operate on, e.g. layer_ids:["outline"].');
  }

  const bak = snapshot(dPath);
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');

  const targets = find(scoped.scope, ids);
  if (targets.length < need) {
    return errResult(op, `Could not find ${need} of those layers on this page`,
      'manage_design {op:"inspect"} lists the ids. These ops work on `path` layers.');
  }
  const ds = targets.map(pathD);
  if (ds.some(d => d === null)) {
    return errResult(op, 'These ops need `path` layers, and at least one target has no `d`.',
      'A rect/ellipse has no path of its own yet. Draw the shape as {type:"path", d:"…"}, or combine '
      + 'shapes in the editor first — the result of that is a path layer.');
  }

  const made: Layer[] = [];
  let note = '';
  if (args.shape_op === 'blend') {
    const steps = Math.max(1, Math.min(Math.trunc(args.steps ?? 3), 24));
    const shapes = blendPaths(ds[0] as string, ds[1] as string, steps);
    if (!shapes) {
      return errResult(op, 'Could not blend those two paths',
        'Both must be walkable: M L H V C S Q T Z, absolute or relative. Elliptical arcs (A) are not '
        + 'supported — rebuild the curve with C or Q.');
    }
    const base = styleOf(targets[0] as Layer);
    shapes.forEach((d, i) => made.push({ ...base, id: `${ids[0]}_blend_${i + 1}`, type: 'path', d } as unknown as Layer));
    note = `${steps} in-between shape(s). The two originals are untouched — a blend is the shapes BETWEEN them.`;
  } else if (args.shape_op === 'outline_stroke') {
    const src = targets[0] as Layer;
    const w = num(args.width) ?? num((src as unknown as Record<string, unknown>)['stroke_width']) ?? 0;
    if (w <= 0) {
      return errResult(op, 'No stroke width to outline', 'Pass width, or give the layer a stroke_width first.');
    }
    const d = await outlineStroke(ds[0] as string, w);
    if (!d) return errResult(op, 'Could not outline that stroke', 'The path may be unwalkable or degenerate.');
    made.push({ ...styleOf(src), id: `${ids[0]}_outlined`, type: 'path', d, stroke: undefined, stroke_width: undefined, fill: (src as unknown as Record<string, unknown>)['stroke'] ?? '#000000' } as unknown as Layer);
    note = `The ${w}px stroke is now a filled shape covering the same ink, so it scales as artwork rather than as a stroke.`;
  } else {
    const delta = num(args.delta) ?? 0;
    if (delta === 0) return errResult(op, 'offset needs a non-zero delta', 'Pass delta:8 to grow or delta:-8 to shrink.');
    const d = await offsetPath(ds[0] as string, delta);
    if (!d) {
      return errResult(op, `Could not offset that path by ${delta}`,
        'Shrinking can consume a shape entirely, and an unwalkable path (elliptical arcs) cannot be offset at all.');
    }
    made.push({ ...styleOf(targets[0] as Layer), id: `${ids[0]}_offset`, type: 'path', d } as unknown as Layer);
    note = `${delta > 0 ? 'Grown' : 'Shrunk'} by ${Math.abs(delta)}px, as a new layer — the original is untouched.`;
  }

  const keep = args.keep_source ?? true;
  if (!keep && args.shape_op !== 'blend') {
    const drop = new Set(ids.slice(0, 1));
    scoped.scope.splice(0, scoped.scope.length, ...scoped.scope.filter(l => !drop.has(String((l as { id?: unknown }).id ?? ''))));
  }
  scoped.scope.push(...made);
  commitScope(spec, scoped.page, scoped.scope);
  writeYAML(dPath, spec);

  progress.push(pOk(`${args.shape_op} applied`, made.map(l => String((l as { id?: unknown }).id)).join(', ')));
  progress.push(pInfo('Result', note));

  return okResult(op, {
    status: 'ok', shape_op: args.shape_op,
    created: made.map(l => String((l as { id?: unknown }).id)),
    source_kept: keep || args.shape_op === 'blend',
    note,
    progress,
    context: buildContext(op, `${args.shape_op} on ${path.basename(dPath)}`, [{ type: 'design', path: dPath, role: 'updated' }]),
    handover: buildHandover('PATCH', { design_path: dPath }),
  }, bak);
}
