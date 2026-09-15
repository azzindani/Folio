/**
 * `animation(op:wiggle)` — After Effects' wiggle on any layer, as a parent.
 *
 * A layer carries one track, and a loop cannot share it with an entrance, so
 * the wiggle rides on a wrapper group around the layer (After Effects' null
 * parent): the group loops seeded noise, the layer keeps whatever it already
 * does, and the group's pose passes down to it in the SVG and the GIF alike.
 * Calling it again on the same layer re-rolls the wrapper instead of nesting a
 * second one.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk } from './utils';
import { resolveScope, commitScope, motionTargets, toIdList, setAnimation } from './motion';
import { syncAnimationsToSpec } from './animation-sync';
import { drawnBox } from '../../export/frame-geometry';
import { wiggleKeyframes, type WiggleAmplitude } from './motion-wiggle';

type WiggleArgs = {
  design_path: string;
  layer_ids?: unknown;
  layer_id?: string;
  /** px for x/y, degrees for rotation, a ratio for scale. */
  amplitude?: unknown;
  /** Wiggles per second. */
  frequency?: number;
  /** Loop length, ms. */
  duration?: number;
  seed?: string;
  page_id?: string;
  project_path?: string;
};

const WRAP = '_wiggle';

function parseAmplitude(v: unknown): WiggleAmplitude | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const out: WiggleAmplitude = {};
  for (const ch of ['x', 'y', 'rotation', 'scale'] as const) {
    const n = o[ch];
    if (typeof n === 'number' && Number.isFinite(n) && n !== 0) out[ch] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Put `id` inside its wiggle wrapper, at any depth — or leave an existing wrapper as it is. */
function wrapLayer(layers: Layer[], id: string, make: (inner: Layer) => Layer): Layer[] {
  return layers.flatMap(l => {
    if (l.id === `${id}${WRAP}`) return [l];
    if (l.id === id) return [make(l)];
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    return Array.isArray(kids) ? [{ ...l, layers: wrapLayer(kids, id, make) } as Layer] : [l];
  });
}

export function wiggleMotion(args: WiggleArgs): ToolResult {
  const op = 'wiggle';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const amp = parseAmplitude(args.amplitude);
  if (!amp) {
    return errResult(op, 'amplitude needs at least one channel.',
      'e.g. amplitude:{x:8, y:6, rotation:2} — px for x/y, degrees for rotation, a ratio for scale (0.04 = ±4%).');
  }
  const ids = toIdList(args.layer_ids) ?? (args.layer_id ? [args.layer_id] : undefined);
  if (!ids) return errResult(op, 'layer_id (or layer_ids) is required.', 'Name the layer to wiggle.');
  const frequency = typeof args.frequency === 'number' && args.frequency > 0 ? args.frequency : 2;
  const duration = typeof args.duration === 'number' && args.duration > 0 ? args.duration : 4000;

  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const found = motionTargets(scoped.scope, ids);
  if (found.length === 0) return errResult(op, `No layer matched: ${ids.join(', ')}`, 'manage_design {op:"inspect"} lists the ids.');

  const bak = snapshot(dPath);
  let scope = scoped.scope;
  const updates = new Map<string, unknown>();
  for (const l of found) {
    const box = drawnBox(l) ?? { x: 0, y: 0, width: 0, height: 0 };
    const wrapper = `${l.id}${WRAP}`;
    // The wrapper's box is the drawn box, so rotation and scale pivot on the layer itself.
    scope = wrapLayer(scope, l.id, inner => ({
      id: wrapper, type: 'group', z: (inner as Layer & { z?: number }).z ?? 1,
      x: box.x, y: box.y, width: box.width, height: box.height, layers: [inner],
    }) as unknown as Layer);
    updates.set(wrapper, {
      keyframes: wiggleKeyframes(`${args.seed ?? ''}:${l.id}`, amp, frequency, duration),
      playback: { duration, loop: true, origin: 'offset' },
    });
  }
  commitScope(spec, scoped.page, setAnimation(scope, updates));
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);

  return okResult(op, {
    design_path: dPath, layers: found.map(l => l.id), wrappers: [...updates.keys()],
    amplitude: amp, frequency, duration_ms: duration,
    progress: [pOk(`Wiggling ${found.length} layer(s)`, 'on a wrapper group, so each layer\'s own motion keeps playing underneath')],
    next_action: { tool: 'animation', params: { op: 'frame', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}), t: Math.round(duration / 4) }, remaining: 0,
      hint: 'Seeded, so it is the same wiggle every export; pass seed to re-roll it. op:clear on the wrapper id stops it.' },
  }, bak);
}
