/**
 * animation {op:"drive"} — one channel driven by another (animation/drive.ts).
 *
 * `channel` of layer_id = add + factor × `driver.channel` of driver.layer_id
 * (default: the same layer), lag ms later — a wheel turning as it rolls
 * (roll:true works the factor out from its width), a shadow shrinking as its
 * ball rises, a needle swinging with a bar's height. Written out as keys on
 * the source's own key structure, so it is exact at every frame; run it again
 * after changing the source to bring the driven channel up to date.
 *
 * Where it goes: a layer driving itself gets the channel on its own keys (so a
 * wheel spins about its own centre while it moves); another layer with no
 * track of its own gets the driven track; one that already moves gets it on a
 * wrapper group, `<id>_drive`, so its own track keeps playing inside.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec, Keyframe, LayerClock, LinkChannel } from '../../animation/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn } from './utils';
import { resolveScope, commitScope, setAnimation } from './motion';
import { syncAnimationsToSpec } from './animation-sync';
import { drawnBox } from '../../export/frame-geometry';
import { driveOwn, driveTrack, rollFactor, type DriveMap } from '../../animation/drive';

interface DriveArgs {
  design_path: string; project_path?: string; page_id?: string;
  layer_id?: string; channel?: string; driver?: { layer_id?: string; channel?: string };
  factor?: number; add?: number; lag?: number; roll?: boolean;
}

type Node = Layer & { layers?: Layer[]; clock?: LayerClock; animation?: AnimationSpec };
const CHANNELS: LinkChannel[] = ['x', 'y', 'rotation', 'scale', 'scale_x', 'scale_y', 'skew_x', 'skew_y', 'opacity', 'blur'];
const WRAP = '_drive';

/** A layer and the precomp clocks it plays under, innermost first. */
function find(layers: Layer[], id: string, clocks: LayerClock[] = []): { layer: Node; clocks: LayerClock[] } | null {
  for (const l of layers as Node[]) {
    if (l.id === id) return { layer: l, clocks };
    if (Array.isArray(l.layers)) {
      const hit = find(l.layers, id, l.clock ? [l.clock, ...clocks] : clocks);
      if (hit) return hit;
    }
  }
  return null;
}

/** `layers` with layer `id` put inside `make(layer)`, wherever it sits. */
function wrapLayer(layers: Layer[], id: string, make: (inner: Layer) => Layer): Layer[] {
  return layers.map(l => {
    if (l.id === id) return make(l);
    const kids = (l as Node).layers;
    return Array.isArray(kids) ? ({ ...l, layers: wrapLayer(kids, id, make) } as Layer) : l;
  });
}

/** The value a channel rests at under origin 'first' (its first key's), else 0: what x/y are measured from. */
function restOf(anim: AnimationSpec, channel: string): number {
  if (!['x', 'y'].includes(channel) || anim.playback?.origin === 'offset') return 0;
  const k = [...(anim.keyframes ?? [])].sort((a, b) => a.t - b.t).find(f => typeof f[channel] === 'number');
  return typeof k?.[channel] === 'number' ? k[channel] : 0;
}

/** Whether a track names nothing but `channel` — a driven track this op may replace. */
const onlyDriven = (keys: Keyframe[], channel: string): boolean =>
  keys.every(k => Object.keys(k).every(key => ['t', 'easing', 'hold', 'ambient', channel].includes(key)));

export function driveMotion(args: DriveArgs): ToolResult {
  const op = 'drive';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const id = args.layer_id, channel = args.channel as LinkChannel | undefined, from = (args.driver?.channel ?? (args.roll ? 'x' : undefined)) as LinkChannel | undefined;
  if (!id || !channel || !from) return errResult(op, 'layer_id, channel and driver:{channel} are required.', 'e.g. layer_id:"wheel", channel:"rotation", roll:true — or driver:{layer_id:"ball", channel:"y"}, factor:-0.2.');
  if (!CHANNELS.includes(channel) || !CHANNELS.includes(from)) return errResult(op, `Channels: ${CHANNELS.join(', ')}.`, 'The driven channel and the driver\'s channel must each be one of these.');
  if (args.roll && (channel !== 'rotation' || from !== 'x')) return errResult(op, 'roll:true turns rotation by x.', 'channel:"rotation", driver:{channel:"x"} — or give factor yourself.');

  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const target = find(scoped.scope, id);
  const srcId = args.driver?.layer_id ?? id;
  const source = find(scoped.scope, srcId);
  if (!target || !source) return errResult(op, `No layer "${!target ? id : srcId}".`, 'manage_design {op:"inspect"} lists the ids.');
  const srcAnim = source.layer.animation;
  if (!srcAnim?.keyframes?.some(k => typeof k[from] === 'number')) {
    return errResult(op, `"${srcId}" has no ${from} keys to drive from.`, `Key its ${from} first (op:motion / op:keyframe), then drive from it.`);
  }
  if (JSON.stringify(source.clocks) !== JSON.stringify(target.clocks)) {
    return errResult(op, `"${srcId}" and "${id}" play on different precomp clocks.`, 'Drive between layers inside the same precomp (or both outside one).');
  }
  const self = srcId === id;
  const lag = args.lag ?? 0;
  if (self && lag) return errResult(op, 'lag needs another layer to follow.', 'A layer drives itself on its own keys, at the same moments. Drive a second layer (or op:link) for a delay.');
  let factor = typeof args.factor === 'number' ? args.factor : 1;
  if (args.roll) {
    factor = rollFactor(drawnBox(target.layer)?.width ?? Number(target.layer.width ?? 0));
    if (!factor) return errResult(op, `"${id}" has no width to roll by.`, 'Give it a width, or pass factor (degrees per px).');
  }
  const map: DriveMap = { channel, from, factor, ...(args.add !== undefined ? { add: args.add } : {}) };
  const rest = restOf(srcAnim, from);
  const progress: ProgressItem[] = [];

  let scope = scoped.scope, where: string;
  if (self) {
    scope = setAnimation(scope, new Map([[id, { ...srcAnim, keyframes: driveOwn(srcAnim.keyframes ?? [], map, rest) }]]));
    where = `on "${id}"'s own keys`;
  } else {
    const pb = srcAnim.playback;
    const track: AnimationSpec = {
      keyframes: driveTrack(srcAnim.keyframes ?? [], map, rest),
      playback: { duration: pb?.duration ?? 0, delay: (pb?.delay ?? 0) + lag, origin: 'offset',
        ...(pb?.easing ? { easing: pb.easing } : {}), ...(pb?.loop ? { loop: true } : {}), ...(pb?.iterations ? { iterations: pb.iterations } : {}), ...(pb?.direction ? { direction: pb.direction } : {}) },
    };
    const own = target.layer.animation?.keyframes;
    const wrapped = find(scope, `${id}${WRAP}`);
    if (!own?.length || onlyDriven(own, channel)) {
      scope = setAnimation(scope, new Map([[id, track]]));
      where = `as "${id}"'s track`;
    } else {
      const box = drawnBox(target.layer) ?? { x: 0, y: 0, width: 0, height: 0 };
      if (!wrapped) {
        scope = wrapLayer(scope, id, inner => ({ id: `${id}${WRAP}`, type: 'group', z: (inner as Node).z ?? 1, x: box.x, y: box.y, width: box.width, height: box.height, layers: [inner] }) as unknown as Layer);
      }
      scope = setAnimation(scope, new Map([[`${id}${WRAP}`, track]]));
      where = `on the wrapper "${id}${WRAP}", so "${id}"'s own motion keeps playing inside`;
      if (['rotation', 'scale', 'scale_x', 'scale_y', 'skew_x', 'skew_y'].includes(channel) && own.some(k => typeof k['x'] === 'number' || typeof k['y'] === 'number')) {
        progress.push(pWarn(`"${id}" also travels`, `the wrapper turns and scales about where "${id}" starts, so it swings wide as it moves — drive it from its own x (driver without layer_id) to turn it in place.`));
      }
    }
  }
  const bak = snapshot(dPath);
  commitScope(spec, scoped.page, scope);
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);
  const rule = `${channel} = ${map.add ?? 0} + ${Math.round(factor * 10000) / 10000} × ${srcId}.${from}${rest ? ` (from its rest ${rest})` : ''}${lag ? `, ${lag} ms later` : ''}`;
  return okResult(op, {
    design_path: dPath, layer_id: id, channel, driver: { layer_id: srcId, channel: from }, factor, ...(map.add !== undefined ? { add: map.add } : {}), ...(lag ? { lag } : {}), rule,
    progress: [pOk(`Driven ${id}.${channel}`, `${rule} — ${where}`), ...progress],
    next_action: { tool: 'animation', params: { op: 'timeline', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}) }, remaining: 0,
      hint: `Written as keys: after changing ${srcId}'s ${from}, run op:drive again to bring ${id}.${channel} up to date.` },
  }, bak);
}
