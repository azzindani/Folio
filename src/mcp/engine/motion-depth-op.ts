/**
 * animation {op:"depth"} — set layers under a camera at a depth (motion-depth.ts).
 *
 * depths:{id: d} takes each layer out of the camera (or the depth it had) and
 * puts it on the wrapper for d: behind the focal plane (d > 0) it is drawn
 * under the camera's content and travels less; in front (d < 0) it is drawn
 * over it and travels more; 0 puts it back in the camera. The layer keeps its
 * world coordinates — only how much of the camera's move it gets changes.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk } from './utils';
import { resolveScope, commitScope } from './motion';
import { syncAnimationsToSpec } from './animation-sync';
import { cameraHome, syncDepth, depthId, parallax, DEPTH } from './motion-depth';

type DepthArgs = { design_path: string; project_path?: string; page_id?: string; depths?: unknown };
type Node = Layer & { layers?: Layer[]; z?: number; camera_depth?: number; x?: number; y?: number; width?: number; height?: number };

/** Take layer `id` out of wherever it sits under `layers`. */
function pluck(layers: Layer[], id: string): Layer | null {
  const i = layers.findIndex(l => l.id === id);
  if (i >= 0) return layers.splice(i, 1)[0] ?? null;
  for (const l of layers as Node[]) {
    const hit = Array.isArray(l.layers) ? pluck(l.layers, id) : null;
    if (hit) return hit;
  }
  return null;
}

function parseDepths(v: unknown): Array<[string, number]> | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'depths must be an object {layer_id: depth}.';
  const out = Object.entries(v as Record<string, unknown>);
  if (!out.length) return 'depths is empty — name at least one layer.';
  for (const [id, d] of out) {
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= -0.9 || d > 50) return `depths.${id} must be a number above -0.9 (0 = the focal plane, 1 = twice as far, -0.5 = half as far).`;
  }
  return out as Array<[string, number]>;
}

export function depthMotion(args: DepthArgs): ToolResult {
  const op = 'depth';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const depths = parseDepths(args.depths);
  if (typeof depths === 'string') return errResult(op, depths, 'e.g. depths:{hills:1, clouds:3, grass:-0.4}.');
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const found = cameraHome(scoped.scope);
  if (!found) return errResult(op, 'No camera on this page — depth is how much of a camera\'s move a layer gets.', 'Place one first: animation {op:"camera", shots:[…]}, then set depths.');
  const { home, camera } = found;
  const cam = camera as Node;
  const box = { x: cam.x ?? 0, y: cam.y ?? 0, width: cam.width ?? 0, height: cam.height ?? 0 };
  const camZ = cam.z ?? 1;
  const progress: ProgressItem[] = [];
  const missing: string[] = [];
  for (const [id, d] of depths) {
    const holders = [cam, ...(home as Node[]).filter(l => l.id.startsWith(DEPTH))];
    const layer = holders.reduce<Layer | null>((hit, h) => hit ?? pluck(h.layers ?? [], id), null);
    if (!layer) { missing.push(id); continue; }
    if (d === 0) {
      (cam.layers ??= []).push(layer);
      progress.push(pOk(`${id} on the focal plane`, 'back in the camera: it moves as the camera does'));
      continue;
    }
    const wid = depthId(d);
    let w = (home as Node[]).find(l => l.id === wid);
    if (!w) {
      // Far wrappers are drawn under the camera's content, farthest first; near ones over it.
      const z = d > 0 ? camZ - d / (1 + d) : camZ - d / (1 - d);
      w = { id: wid, type: 'group', z, ...box, camera_depth: d,
        layers: [{ id: `${wid}_pin`, type: 'rect', z: -1, ...box, fill: '#000000', opacity: 0 } as unknown as Layer] } as Node;
      home.push(w);
    }
    (w.layers ??= []).push(layer);
    progress.push(pOk(`${id} at depth ${d}`, `${Math.round(parallax(d) * 100)}% of the camera's travel and zoom — ${d > 0 ? 'behind' : 'in front of'} the focal plane`));
  }
  if (missing.length) return errResult(op, `Not under the camera: ${missing.join(', ')}.`, 'Depth moves layers the camera carries; manage_design {op:"inspect"} lists the ids.');
  for (let i = home.length - 1; i >= 0; i--) {
    const w = home[i] as Node | undefined;
    if (w?.id.startsWith(DEPTH) && !(w.layers ?? []).some(l => l.id !== `${w.id}_pin`)) home.splice(i, 1);
  }
  syncDepth(scoped.scope);
  const bak = snapshot(dPath);
  commitScope(spec, scoped.page, scoped.scope);
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);
  const keys = cam.animation?.keyframes ?? [];
  const moveAt = keys[1]?.t ?? keys[0]?.t ?? 0;
  return okResult(op, {
    design_path: dPath, depths: Object.fromEntries(depths), progress,
    next_action: { tool: 'animation', params: { op: 'frame', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}), t: moveAt }, remaining: 0,
      hint: 'Look at a frame mid-move: far layers should lag the camera, near ones lead it.' },
  }, bak);
}
