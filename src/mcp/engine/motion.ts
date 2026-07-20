/**
 * `animation(op:motion)` — apply a motion preset across layers in one call.
 *
 * Authoring motion through `op:keyframe` alone means one call per layer per
 * keyframe: a six-item stagger is twenty-four calls before anything moves. This
 * is the sentence to that assembly language. What it writes is ordinary
 * keyframes on ordinary layers, so `op:timeline` shows them, `op:keyframe` can
 * overwrite any one of them, and nothing here is a black box.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo } from './utils';
import { expandPreset, isMotionPreset, PRESET_NAMES, PRESET_NOTES, type MotionPreset } from './motion-presets';

// A `type` alias, not an `interface`: dispatch.ts casts its Record<string,
// unknown> arg bag to Parameters<typeof applyMotion>[0], and an interface has
// no implicit index signature, so that cast fails to compile against one.
type MotionArgs = {
  design_path: string;
  preset: string;
  page_id?: string;
  /** Kept as unknown: this arrives as raw JSON from an MCP client, and a caller
   *  passing a single id as a bare string should not be a type error. */
  layer_ids?: unknown;
  stagger_ms?: number;
  duration?: number;
  easing?: string;
  distance?: number;
  project_path?: string;
};

/** Accept a string[] or a lone string; ignore anything else. */
function toIdList(v: unknown): string[] | undefined {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) {
    const ids = v.filter((x): x is string => typeof x === 'string');
    return ids.length > 0 ? ids : undefined;
  }
  return undefined;
}

/**
 * Targets for a motion pass, in document order.
 *
 * A locked group is treated as ONE target and not descended into: it is a
 * deliberate composition (every carousel page this engine writes is one), and
 * animating its children individually would tear apart a layout that was
 * grouped precisely so it would hold together. An explicit layer_ids list can
 * still name a child — asking for it by id is unambiguous.
 */
export function motionTargets(layers: Layer[], explicit?: string[]): Layer[] {
  if (explicit && explicit.length > 0) {
    const wanted = new Set(explicit);
    const found: Layer[] = [];
    const visit = (l: Layer): void => {
      if (wanted.has(l.id)) found.push(l);
      const kids = (l as Layer & { layers?: Layer[] }).layers;
      if (Array.isArray(kids)) for (const k of kids) visit(k);
    };
    for (const l of layers) visit(l);
    // Preserve the caller's order — a stagger is a sequence, and the order they
    // listed is the order they meant.
    return explicit.map(id => found.find(l => l.id === id)).filter((l): l is Layer => !!l);
  }

  const out: Layer[] = [];
  const visit = (l: Layer): void => {
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    const locked = (l as Layer & { locked?: boolean }).locked === true;
    if (Array.isArray(kids) && !locked) {
      for (const k of kids) visit(k);
      return;
    }
    out.push(l);
  };
  for (const l of layers) visit(l);
  return out;
}

/** Replace a layer's animation wherever it sits in the tree. */
function setAnimation(layers: Layer[], updates: Map<string, unknown>): Layer[] {
  return layers.map(function apply(l: Layer): Layer {
    const next = updates.has(l.id) ? { ...l, animation: updates.get(l.id) } : l;
    const kids = (next as Layer & { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) {
      return { ...next, layers: kids.map(apply) } as Layer;
    }
    return next as Layer;
  });
}

export function applyMotion(args: MotionArgs): ToolResult {
  const op = 'motion';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  if (!isMotionPreset(args.preset)) {
    return errResult(
      op,
      `Unknown motion preset: ${String(args.preset)}`,
      `Pick one of: ${PRESET_NAMES.join(', ')}. ` +
      `Entrances: fade_in, rise, settle, scale_in, sweep_in. Loops: pulse, float, spin, drift, breathe.`,
    );
  }
  const preset: MotionPreset = args.preset;

  const bak = snapshot(dPath);
  const spec = readYAML<DesignSpec>(dPath);

  let scope: Layer[];
  let page: Page | undefined;
  if (args.page_id) {
    page = (spec.pages ?? []).find((p: Page) => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, 'Run manage_design(op:inspect) to list page ids.');
    scope = page.layers ?? [];
  } else {
    scope = spec.pages?.[0]?.layers ?? spec.layers ?? [];
  }

  const explicitIds = toIdList(args.layer_ids);
  const targets = motionTargets(scope, explicitIds);
  if (targets.length === 0) {
    return errResult(
      op,
      'No layers matched.',
      explicitIds
        ? 'Those layer_ids are not in this page. Run manage_design(op:inspect) to see the real ids.'
        : 'The page has no layers yet — add some with add_layers first.',
    );
  }

  const stagger = Math.max(0, args.stagger_ms ?? 0);
  const updates = new Map<string, unknown>();
  const progress: ProgressItem[] = [];

  targets.forEach((layer, i) => {
    const expanded = expandPreset(preset, {
      duration: args.duration,
      easing: args.easing as never,
      distance: args.distance,
      delay: stagger * i,
    });
    updates.set(layer.id, expanded);
  });

  const applied = setAnimation(scope, updates);
  if (page) page.layers = applied;
  else if (spec.pages?.[0]) spec.pages[0].layers = applied;
  else spec.layers = applied;

  writeYAML(dPath, spec);

  const totalMs = (args.duration ?? 0) + stagger * (targets.length - 1);
  progress.push(pOk(`Applied ${preset} to ${targets.length} layer${targets.length === 1 ? '' : 's'}`, PRESET_NOTES[preset]));
  if (stagger > 0) progress.push(pInfo('Staggered', `${stagger}ms between layers${totalMs ? ` — last one starts at ${stagger * (targets.length - 1)}ms` : ''}`));

  return okResult(op, {
    design_path: dPath,
    preset,
    layers: targets.map(l => l.id),
    stagger_ms: stagger,
    progress,
    next_action: {
      tool: 'animation',
      params: { op: 'export', design_path: dPath, type: 'svg' },
      remaining: 0,
      hint: 'Motion written as ordinary keyframes — animation(op:timeline) shows them, ' +
        'animation(op:keyframe) overrides any single one. Export with type:"svg" to get a real animated file.',
    },
  }, bak);
}
