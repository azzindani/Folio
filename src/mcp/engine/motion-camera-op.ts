/**
 * `animation(op:camera)` — a 2D camera over a page: push in on a layer, pull
 * back to the whole page, pan from one shot to the next.
 *
 * The page's content moves into a `__camera` group whose box IS the canvas: an
 * invisible full-canvas rect pins its fill-box, so the browser pivots on the
 * canvas centre exactly as the flipbook does (a Chromium probe put the pivot on
 * the content's own centre without it). Each shot names what should fill the
 * frame; framePose turns its drawn box into scale / x / y keyframes on the
 * group. The page ground stays outside the camera, so a pull-back never shows
 * empty canvas. A second call re-frames the same camera.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { Keyframe } from '../../animation/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk } from './utils';
import { resolveScope, commitScope, motionTargets, toIdList, setAnimation } from './motion';
import { syncAnimationsToSpec } from './animation-sync';
import { isKnownEasing } from '../../animation/easing';
import { drawnBox } from '../../export/frame-geometry';
import { isFullCanvasBgRect } from '../engine-layer-predicates';
import { framePose, type Box } from './motion-camera';

type CameraArgs = { design_path: string; shots?: unknown; exclude?: unknown; padding?: number; page_id?: string; project_path?: string };
type Shot = { t: number; target: string[] | 'all'; padding?: number; easing?: string; hold?: boolean };

const CAMERA = '__camera';

function parseShots(v: unknown): Shot[] | string {
  if (!Array.isArray(v) || v.length === 0) return 'shots must be a non-empty array of {t, target?, padding?, easing?, hold?}.';
  const out: Shot[] = [];
  for (const [i, s] of v.entries()) {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    if (typeof o['t'] !== 'number' || o['t'] < 0) return `shots[${i}].t must be a number of ms ≥ 0.`;
    if (o['easing'] !== undefined && !isKnownEasing(o['easing'])) return `shots[${i}].easing "${String(o['easing'])}" is unknown.`;
    const ids = o['target'] === undefined || o['target'] === 'all' ? 'all' : toIdList(o['target']);
    if (!ids) return `shots[${i}].target must be "all", a layer id or a list of ids.`;
    out.push({ t: o['t'], target: ids, padding: typeof o['padding'] === 'number' ? o['padding'] : undefined,
      easing: typeof o['easing'] === 'string' ? o['easing'] : undefined, hold: o['hold'] === true });
  }
  return out.sort((a, b) => a.t - b.t);
}

function union(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  const r = Math.max(...boxes.map(b => b.x + b.width)), btm = Math.max(...boxes.map(b => b.y + b.height));
  return { x, y, width: r - x, height: btm - y };
}

export function cameraMotion(args: CameraArgs): ToolResult {
  const op = 'camera';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const shots = parseShots(args.shots);
  if (typeof shots === 'string') return errResult(op, shots, 'e.g. shots:[{t:0, target:"all"}, {t:1200, target:"stat", padding:80}, {t:3000, target:"all"}]');

  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const W = spec.document?.width ?? 1080, H = spec.document?.height ?? 1080;
  const canvas: Box = { x: 0, y: 0, width: W, height: H };

  // Every carousel page is one locked full-canvas group: work inside it, so its ground stays still.
  const only = scoped.scope.length === 1 ? scoped.scope[0] as Layer & { layers?: Layer[]; locked?: boolean } : undefined;
  const host = only?.type === 'group' && Array.isArray(only.layers) && (drawnBox(only)?.width ?? 0) >= W * 0.95 ? only : undefined;
  const stack = host?.layers ?? scoped.scope;

  const boxes: Array<Box | string> = shots.map(s => {
    if (s.target === 'all') return canvas;
    const found = motionTargets(stack, s.target);
    return union(found.map(l => drawnBox(l)).filter((b): b is Box => b !== null)) ?? `No layer matched: ${s.target.join(', ')}`;
  });
  const missing = boxes.find((b): b is string => typeof b === 'string');
  if (missing) return errResult(op, missing, 'manage_design {op:"inspect"} lists the ids on this page.');

  const existing = stack.find(l => l.id === CAMERA) as (Layer & { layers?: Layer[] }) | undefined;
  // exclude:[] is a real answer — "nothing held still" — not the same as leaving it out.
  const excludeIds = Array.isArray(args.exclude) || typeof args.exclude === 'string' ? toIdList(args.exclude) ?? [] : undefined;
  const keep = new Set(excludeIds ?? []);
  // Found live: a re-run with exclude reused the camera as it stood, so the layer
  // it named kept moving. With exclude, the camera is taken apart and rebuilt, so
  // what rides in it matches the list; without, its contents stay as they are.
  const loose = existing && excludeIds
    ? stack.flatMap(l => l === existing ? (existing.layers ?? []).filter(k => k.id !== `${CAMERA}_pin`) : [l])
    : stack;
  const layers: Layer[] = existing && !excludeIds ? stack : (() => {
    const outside = loose.filter(l => keep.has(l.id) || isFullCanvasBgRect(l, W, H));
    const inside = loose.filter(l => !outside.includes(l));
    const pin = { id: `${CAMERA}_pin`, type: 'rect', z: -1, x: 0, y: 0, width: W, height: H, fill: '#000000', opacity: 0 };
    const z = Math.max(1, ...inside.map(l => (l as Layer & { z?: number }).z ?? 1));
    return [...outside, { id: CAMERA, type: 'group', z, x: 0, y: 0, width: W, height: H, layers: [pin, ...inside] } as unknown as Layer];
  })();

  const frames: Keyframe[] = shots.map((s, i) => {
    const pose = framePose(boxes[i] as Box, canvas, s.padding ?? args.padding ?? 0);
    return { t: s.t, scale: pose.scale, x: pose.x, y: pose.y, ...(s.easing ? { easing: s.easing } : {}), ...(s.hold ? { hold: true } : {}) };
  });
  // A single shot still needs two frames to play: hold it.
  const track = frames.length === 1 ? [frames[0] as Keyframe, { ...(frames[0] as Keyframe), t: (frames[0]?.t ?? 0) + 1 }] : frames;
  const duration = Math.max(1, (track[track.length - 1]?.t ?? 1) - (track[0]?.t ?? 0));

  const bak = snapshot(dPath);
  const placed = setAnimation(layers, new Map([[CAMERA, { keyframes: track, playback: { duration, origin: 'offset', easing: 'ease-in-out' } }]]));
  if (host) commitScope(spec, scoped.page, [{ ...host, layers: placed } as Layer]);
  else commitScope(spec, scoped.page, placed);
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);

  return okResult(op, {
    design_path: dPath, camera: CAMERA, reused: !!existing, shots: frames.map(f => ({ t: f.t, scale: f.scale, x: f.x, y: f.y })),
    progress: [pOk(`${existing ? 'Re-framed' : 'Placed'} a camera over the page`, `${shots.length} shot(s); the ground stays still behind it`)],
    next_action: { tool: 'animation', params: { op: 'frame', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}), t: shots[Math.min(1, shots.length - 1)]?.t ?? 0 }, remaining: 0,
      hint: 'Check a shot with op:frame. Add exclude:[ids] to hold a layer still while the camera moves.' },
  }, bak);
}
