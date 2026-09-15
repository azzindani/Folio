/**
 * `animation(op:morph)` — turn one path into another shape, in one call.
 *
 * Writes `morph_to` on the path and a morph 0 → 1 track, merged onto whatever
 * motion the layer already has. The outline comes as a `d` string, or from
 * another path layer (`to_layer`), which is hidden so only the changing shape
 * shows. Both outlines are resampled to the same points and aligned, so the GIF
 * and the SVG (CSS `d: path()`) change shape the same way. An elliptical arc is
 * refused rather than approximated, as motion paths refuse it.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk } from './utils';
import { resolveScope, commitScope } from './motion';
import { syncAnimationsToSpec } from './animation-sync';
import { mergeFragment, MergeError } from './motion-merge';
import { isKnownEasing } from '../../animation/easing';
import { findLayer } from './split-text-op';
import { morphPair } from '../../engine/path-ops';

type MorphArgs = {
  design_path: string;
  layer_id?: string;
  /** The outline to become, as a `d` string. */
  to?: string;
  /** Or: a path layer whose outline to become. Hidden unless keep_target. */
  to_layer?: string;
  keep_target?: boolean;
  duration?: number;
  delay?: number;
  easing?: string;
  page_id?: string;
  project_path?: string;
};

type PathLike = Layer & { d?: unknown; animation?: AnimationSpec };

/** The layer `id` with `patch` applied, at any depth. */
function patchLayer(layers: Layer[], id: string, patch: (l: Layer) => Layer): Layer[] {
  return layers.map(l => {
    if (l.id === id) return patch(l);
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    return Array.isArray(kids) ? ({ ...l, layers: patchLayer(kids, id, patch) } as Layer) : l;
  });
}

export function morphMotion(args: MorphArgs): ToolResult {
  const op = 'morph';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const id = String(args.layer_id ?? '');
  if (!id) return errResult(op, 'No layer_id given', 'Name the path layer to morph.');
  if (args.easing !== undefined && !isKnownEasing(args.easing)) return errResult(op, `easing "${args.easing}" is unknown.`, 'animation(op:presets) lists the curves.');

  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const src = findLayer(scoped.scope, id) as PathLike | null;
  if (!src || typeof src.d !== 'string') {
    return errResult(op, src ? `"${id}" is a ${src.type}, not a path` : `No such layer: ${id}`, 'Morph works on path layers — a shape with a `d` outline.');
  }
  const target = args.to_layer ? (findLayer(scoped.scope, args.to_layer) as PathLike | null) : null;
  const to = typeof args.to === 'string' ? args.to : typeof target?.d === 'string' ? target.d : undefined;
  if (!to) {
    return errResult(op, args.to_layer ? `"${args.to_layer}" is not a path layer` : 'No shape to become.', 'Pass to:"<d outline>" or to_layer:"<path layer id>".');
  }
  if (!morphPair(src.d, to)) {
    return errResult(op, 'One of the outlines cannot be morphed.', 'Elliptical arcs (A) are refused — the frames would disagree with the browser. Redraw the arc with C curves.');
  }

  const duration = typeof args.duration === 'number' && args.duration > 0 ? args.duration : 900;
  const fragment = {
    keyframes: [{ t: 0, morph: 0 }, { t: duration, morph: 1 }],
    playback: { duration, origin: 'offset', easing: args.easing ?? 'ease-in-out', ...(args.delay ? { delay: Math.max(0, args.delay) } : {}) },
  } as Parameters<typeof mergeFragment>[1];
  let animation: AnimationSpec;
  try {
    animation = mergeFragment(src.animation, fragment);
  } catch (e) {
    if (e instanceof MergeError) return errResult(op, e.message, e.hint);
    throw e;
  }

  const bak = snapshot(dPath);
  const hideTarget = !!target && args.keep_target !== true;
  let scope = patchLayer(scoped.scope, id, l => ({ ...l, morph_to: to, animation }) as Layer);
  if (hideTarget && target) scope = patchLayer(scope, target.id, l => ({ ...l, visible: false }) as Layer);
  commitScope(spec, scoped.page, scope);
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);

  return okResult(op, {
    design_path: dPath, layer: id, into: args.to_layer ?? 'the given outline', duration_ms: duration, target_hidden: hideTarget,
    progress: [pOk(`"${id}" morphs into ${args.to_layer ? `"${args.to_layer}"` : 'the given outline'}`, `${duration}ms, merged onto its existing motion`)],
    next_action: { tool: 'animation', params: { op: 'frame', design_path: dPath, t: Math.round((args.delay ?? 0) + duration / 2) }, remaining: 0,
      hint: 'Check the halfway shape with op:frame.' },
  }, bak);
}
