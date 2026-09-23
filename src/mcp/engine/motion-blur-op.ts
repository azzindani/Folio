/**
 * `animation(op:motion_blur)` — After Effects' motion blur switch.
 *
 * Flags layers so every raster frame (gif/mp4/webm, op:frame, the editor's
 * Play all) smears them along their travel over the shutter; the vector
 * SVG/HTML exports play without it. A layer that moves through a wrapper — a
 * parented or linked child, a wiggle — moves on that wrapper's track, so the
 * wrappers it rides are flagged too. The reply measures each layer's longest
 * streak, so a caller that cannot watch the frames knows how strong it is.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn } from './utils';
import { resolveScope, commitScope, toIdList } from './motion';
import { pathTo, stackAround, type RigNode } from './motion-rig-stack';
import { layersAt, animationDuration } from '../../export/gif-frames';
import { PREVIEW_FRAME_MS, DEFAULT_SHUTTER } from '../../export/motion-blur';

type BlurArgs = { design_path: string; page_id?: string; project_path?: string; layer_id?: string; layer_ids?: unknown; shutter?: number; clear?: boolean };
type Flagged = RigNode & { motion_blur?: unknown; motion_path?: unknown };

/** How often the reply samples the piece for each layer's longest streak, ms. */
const PROBE_MS = 100;

export function motionBlurMotion(args: BlurArgs): ToolResult {
  const op = 'motion_blur';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const ids = toIdList(args.layer_ids) ?? (args.layer_id ? [args.layer_id] : undefined);
  if (!ids?.length) return errResult(op, 'layer_id (or layer_ids) is required — the layers to blur.', 'e.g. layer_ids:["card","ball"], shutter:180');
  const shutter = args.shutter;
  if (shutter !== undefined && !(typeof shutter === 'number' && shutter > 0 && shutter <= 720)) {
    return errResult(op, 'shutter must be 1–720 degrees of a frame.', '180 is After Effects\' default; 360 smears a whole frame, 90 half as much.');
  }
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const scope = scoped.scope;
  const missing = ids.filter(id => !pathTo(scope, id));
  if (missing.length) return errResult(op, `No layer ${missing.map(m => `"${m}"`).join(', ')}.`, 'manage_design {op:"inspect"} lists the ids.');

  const bak = snapshot(dPath);
  const value = shutter === undefined || shutter === DEFAULT_SHUTTER ? true : { shutter };
  for (const id of ids) {
    const self = pathTo(scope, id)?.slice(-1)[0] as Flagged | undefined;
    for (const l of [self, ...stackAround(scope, id)] as Flagged[]) {
      if (!l) continue;
      if (args.clear) delete l.motion_blur;
      else l.motion_blur = value;
    }
  }
  commitScope(spec, scoped.page, scope);
  writeYAML(dPath, spec);

  if (args.clear) return okResult(op, { design_path: dPath, cleared: ids, progress: [pOk(`Motion blur off on ${ids.length} layer(s)`)] }, bak);
  const peaks = peakStreaks(scope, ids);
  const progress: ProgressItem[] = [pOk(`Motion blur on ${ids.length} layer(s) at ${shutter ?? DEFAULT_SHUTTER}°`, 'smears in gif/mp4/webm frames, op:frame and Play all; the SVG/HTML exports play without it')];
  const still = ids.filter(id => !peaks[id]);
  if (still.length) progress.push(pWarn('Never smears', `${still.join(', ')} never travel more than a pixel over a shutter — only moves smear, not turns, zooms or fades.`));
  return okResult(op, {
    design_path: dPath, shutter: shutter ?? DEFAULT_SHUTTER, streaks: peaks, progress,
    next_action: { tool: 'animation', params: { op: 'frame', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}) }, remaining: 0,
      hint: 'streaks: each layer\'s longest smear (px) at 30 fps and when. op:frame at that t shows it.' },
  }, bak);
}

/** Each layer's longest smear across the piece at 30 fps — through the wrappers it rides. */
function peakStreaks(scope: Layer[], ids: string[]): Record<string, { px: number; at_ms: number }> {
  const end = animationDuration(scope);
  const out: Record<string, { px: number; at_ms: number }> = {};
  for (let t = 0; t <= end; t += PROBE_MS) {
    const frame = layersAt(scope, t, PREVIEW_FRAME_MS);
    for (const id of ids) {
      const chain = pathTo(frame, id) ?? [];
      // A streak rides every level that smears; the lengths add along the path.
      const px = chain.reduce((sum, l) => {
        const s = (l as { effects?: { motion_blur?: { dx: number; dy: number } } }).effects?.motion_blur;
        return sum + (s ? Math.hypot(s.dx, s.dy) : 0);
      }, 0);
      if (px >= 1 && px > (out[id]?.px ?? 0)) out[id] = { px: Math.round(px), at_ms: t };
    }
  }
  return out;
}
