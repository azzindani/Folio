/**
 * animation {op:"loop"} — After Effects' loopOut, bounded (animation/loop-out.ts).
 *
 * The layer's keys from `from` to its last repeat — cycle, pingpong or offset —
 * until `until` (default: the scene's end), written out as keyframes so every
 * player, export, check and the editor timeline read them as they read any
 * track. Run it again to change the mode or the reach: it replaces its own
 * repeats. A layer that already loops as a whole (playback.loop) is refused —
 * that repeats from its first key, which is the thing this exists to avoid.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec, LayerClock } from '../../animation/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo } from './utils';
import { resolveScope, commitScope, setAnimation } from './motion';
import { syncAnimationsToSpec } from './animation-sync';
import { readMarkers, resolveTime } from './motion-time';
import { animationDuration } from '../../export/gif-frames';
import { fromSceneTime } from '../../animation/clock-time';
import { loopOut, withoutLoop, MAX_PASSES, type LoopMode } from '../../animation/loop-out';

interface LoopArgs {
  design_path: string; project_path?: string; page_id?: string;
  layer_id?: string; mode?: string; from?: number; until?: number | string;
}

type Node = Layer & { layers?: Layer[]; clock?: LayerClock; animation?: AnimationSpec };
const MODES: LoopMode[] = ['cycle', 'pingpong', 'offset'];

/** The layer and the precomp clocks it plays under, innermost first. */
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

/** The scope with this layer's repeats taken off — what the scene is without the loop. */
function withoutOwnLoop(scope: Layer[], id: string, anim: AnimationSpec): Layer[] {
  return setAnimation(scope, new Map([[id, { ...anim, keyframes: withoutLoop(anim.keyframes ?? []) }]]));
}

export function loopMotion(args: LoopArgs): ToolResult {
  const op = 'loop';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const mode = (args.mode ?? 'cycle') as LoopMode;
  if (!MODES.includes(mode)) return errResult(op, `mode "${String(args.mode)}" is not a loop.`, 'cycle (jump back and replay), pingpong (back and forth), offset (each pass carries on from the last — a walk).');
  const id = args.layer_id;
  if (!id) return errResult(op, 'layer_id is required.', 'Name the layer whose motion should repeat.');

  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const hit = find(scoped.scope, id);
  if (!hit) return errResult(op, `No layer "${id}".`, 'manage_design {op:"inspect"} lists the ids.');
  const anim = hit.layer.animation;
  const base = withoutLoop(anim?.keyframes ?? []);
  const firstKey = base[0], lastKey = base[base.length - 1];
  if (!anim || !firstKey || !lastKey || base.length < 2) {
    return errResult(op, `"${id}" has no keyframed motion to repeat.`, 'Give it keys first — op:motion or op:keyframe — then loop the part that should repeat.');
  }
  if (anim.playback?.loop === true) {
    return errResult(op, `"${id}" already loops as a whole (playback.loop).`, 'That repeats from its first key. Clear playback.loop (edit_layer update) to loop only a tail with op:loop.');
  }
  const from = Math.floor(args.from ?? 0);
  if (!(from >= 0 && from <= base.length - 2)) return errResult(op, `from: key ${String(args.from)} is not in the track.`, `A key index 0–${base.length - 2}: the repeat runs from that key to the last (${base.length} keys).`);

  // Until the scene's end — as the scene is without this loop — unless told.
  const page = scoped.page ?? spec.pages?.[0];
  const held = page?.auto_advance;
  let until = typeof held === 'number' && held > 0 ? held : animationDuration(withoutOwnLoop(scoped.scope, id, anim));
  if (args.until !== undefined) {
    const t = resolveTime(args.until, { markers: readMarkers(spec, scoped.page), layers: scoped.scope });
    if (typeof t === 'string') return errResult(op, `until: ${t}`, 'ms on the scene clock, or a name ("outro", "title.out").');
    until = t;
  }
  const delay = anim.playback?.delay ?? 0;
  const local = firstKey.t + fromSceneTime(until, hit.clocks) - delay;
  const r = loopOut(anim.keyframes ?? [], mode, from, local, anim.playback?.easing);
  if (r.passes === 0) {
    return errResult(op, `No room for one pass: the part that repeats runs ${r.period} ms, and "${id}" ends where the scene does (${until} ms).`,
      'Pass until (ms or a marker) further on — the scene grows to it — or open time first (op:retime / op:scene length_ms).');
  }
  const end = r.keys[r.keys.length - 1]?.t ?? lastKey.t;
  const next: AnimationSpec = { ...anim, keyframes: r.keys, playback: { ...(anim.playback ?? { duration: 0 }), duration: end - firstKey.t } };
  const bak = snapshot(dPath);
  commitScope(spec, scoped.page, setAnimation(scoped.scope, new Map([[id, next]])));
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);

  const cut = r.passes >= MAX_PASSES ? [pInfo(`Cut at ${MAX_PASSES} passes`, 'a longer part to repeat, or a nearer until, keeps the file small')] : [];
  return okResult(op, {
    design_path: dPath, layer_id: id, mode, from_key: from, passes: r.passes, period_ms: r.period, until_ms: until, keys: r.keys.length,
    progress: [pOk(`Looped "${id}" (${mode})`, `${r.passes} pass(es) of ${r.period} ms after key ${from}, to ${until} ms on the scene`), ...cut],
    next_action: { tool: 'animation', params: { op: 'timeline', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}) }, remaining: 0,
      hint: 'The repeats are ordinary keys (ambient: the layer rests in a loop). Run op:loop again to change the mode or the reach — it replaces its own repeats.' },
  }, bak);
}
