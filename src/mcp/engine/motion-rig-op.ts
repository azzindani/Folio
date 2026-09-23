/**
 * `animation(op:parent | null)` — After Effects' rigging.
 *
 *   parent  a layer moves, turns and scales WITH another, about that layer's
 *           anchor: a moon orbits as its planet spins, a label rides a card
 *           that tilts. A zero-lag link on the same <id>_link wrapper, so the
 *           child's own motion keeps playing inside it — but where a follower
 *           from op:link turns about itself, a child turns about its parent.
 *   null    an invisible controller: a box nobody sees, animated like any
 *           layer, that others are parented to — one track drives a whole rig.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { LinkChannel } from '../../animation/types';
import type { ToolResult } from '../types';
import { collectLayerIds } from '../engine-finalize-geom';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo } from './utils';
import { resolveScope, commitScope, toIdList } from './motion';
import { syncAnimationsToSpec } from './animation-sync';
import { linkMotion, findParentList } from './motion-precomp-op';

/** What a child inherits: where the parent goes, how it turns, grows and leans — never its fade. */
export const PARENT_CHANNELS: LinkChannel[] = ['x', 'y', 'rotation', 'scale', 'scale_x', 'scale_y', 'skew_x', 'skew_y'];

type ParentArgs = { design_path: string; page_id?: string; project_path?: string; layer_id?: string; layer_ids?: unknown; to?: string; clear?: boolean };

export function parentMotion(args: ParentArgs): ToolResult {
  return linkMotion({ ...args, lag: 0, factor: 1, stagger_ms: 0, channels: PARENT_CHANNELS, pivot: 'target' });
}

type NullArgs = {
  design_path: string; page_id?: string; project_path?: string;
  layer_id?: string; x?: number; y?: number; width?: number; height?: number; layer_ids?: unknown;
};

const NULL_SIZE = 100;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function nullMotion(args: NullArgs): ToolResult {
  const op = 'null';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const id = args.layer_id;
  if (!id) return errResult(op, 'layer_id is required — the id of the new null.', 'e.g. layer_id:"rig", x:540, y:675, layer_ids:["planet","moon"]');
  const spec = readYAML<DesignSpec>(dPath);
  if (collectLayerIds(spec).has(id)) return errResult(op, `"${id}" is already taken.`, 'Pick a new id for the null.');
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const w = finite(args.width) && args.width > 0 ? args.width : NULL_SIZE;
  const h = finite(args.height) && args.height > 0 ? args.height : NULL_SIZE;
  // x/y name the null's centre — the point its children turn about.
  const cx = finite(args.x) ? args.x : (spec.document?.width ?? 1080) / 2;
  const cy = finite(args.y) ? args.y : (spec.document?.height ?? 1080) / 2;
  const scope = scoped.scope;
  const kids = toIdList(args.layer_ids) ?? [];
  const missing = kids.filter(k => !findParentList(scope, k));
  if (missing.length) return errResult(op, `No layer ${missing.map(k => `"${k}"`).join(', ')} to parent.`, 'manage_design {op:"inspect"} lists the ids.');
  const bak = snapshot(dPath);
  scope.push({ id, type: 'group', z: 0, x: cx - w / 2, y: cy - h / 2, width: w, height: h, visible: false, layers: [] } as unknown as Layer);
  commitScope(spec, scoped.page, scope);
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);

  const made = pOk(`Null "${id}" at (${cx}, ${cy})`, 'invisible — animate it like any layer (op:track, op:sequence, op:storyboard) and its children follow');
  if (!kids.length) {
    return okResult(op, {
      design_path: dPath, null: id, pivot: { x: cx, y: cy }, progress: [made],
      next_action: { tool: 'animation', params: { op: 'parent', design_path: dPath, to: id, layer_ids: ['<ids>'], ...(args.page_id ? { page_id: args.page_id } : {}) }, remaining: 1,
        hint: 'Parent the layers the null should drive, then give the null a track.' },
    }, bak);
  }
  const parented = parentMotion({ design_path: dPath, page_id: args.page_id, layer_ids: kids, to: id });
  // Undo goes back past the null too: the backup is the design before it.
  if (!parented.success) return parented;
  // A new null has no track yet — that is the next step, not a fault.
  const progress = [made, ...parented.progress.filter(p => p.message !== 'Target does not move'), pInfo('Give the null a track', `op:track / op:sequence on "${id}" — its children follow`)];
  return { ...parented, op, null: id, progress, backup: bak };
}
