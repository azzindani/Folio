/**
 * `animation(op:text)` — After Effects' text animator in one call: split a text
 * layer into characters, words or lines, optionally each behind its own mask,
 * and animate them with a stagger and an order.
 *
 * It composes ops that already exist instead of re-implementing them: the
 * split is text-split.ts, the motion is op:motion (a preset) or op:track (raw
 * keyframes) aimed at the new pieces — so validation, stagger, order and the
 * timeline come from one tested path. If that motion is refused, the design is
 * restored to how it was before the split.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn, collectLayerIds, freeLayerId } from './utils';
import { metricsForFamily } from '../../utils/font-metrics';
import { fontsDir, projectFontsDir } from './fonts';
import { resolveScope, commitScope, applyMotion } from './motion';
import { setTrack } from './motion-sequence';
import { isMotionPreset } from './motion-presets';
import { isStaggerOrder, STAGGER_ORDERS } from './motion-order';
import { findLayer } from './split-text-op';
import { pagesWithLayer } from '../engine-edit-tools';
import { splitLayer, type SplitBy } from './text-split';

type TextAnimArgs = {
  design_path: string;
  layer_id?: string;
  by?: string;
  preset?: string;
  keyframes?: unknown;
  playback?: unknown;
  stagger_ms?: number;
  order?: string;
  mask?: boolean;
  duration?: number;
  easing?: string;
  distance?: number;
  keep_source?: boolean;
  page_id?: string;
  project_path?: string;
};

/** Timing only, not a look: a gap per unit that reads as a run. The caller's number wins. */
const DEFAULT_STAGGER: Record<SplitBy, number> = { char: 35, word: 80, line: 140 };

/** Put `withLayers` where the layer `id` sits, at any depth — a headline inside a page group stays in it. */
function replaceLayer(layers: Layer[], id: string, withLayers: Layer[]): Layer[] {
  return layers.flatMap(l => {
    if (l.id === id) return withLayers;
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    return Array.isArray(kids) ? [{ ...l, layers: replaceLayer(kids, id, withLayers) } as Layer] : [l];
  });
}

export function animateText(args: TextAnimArgs): ToolResult {
  const op = 'text';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const id = String(args.layer_id ?? '');
  if (!id) return errResult(op, 'No layer_id given', 'Name the text layer to animate, e.g. layer_id:"headline".');
  if (args.by !== undefined && args.by !== 'char' && args.by !== 'word' && args.by !== 'line') {
    return errResult(op, `by "${String(args.by)}" is unknown.`, 'Use char, word or line.');
  }
  const by: SplitBy = (args.by as SplitBy | undefined) ?? 'char';
  const hasFrames = Array.isArray(args.keyframes);
  if (!hasFrames && !isMotionPreset(args.preset)) {
    return errResult(op, args.preset ? `preset "${args.preset}" is unknown.` : 'Name a preset or pass keyframes.',
      'animation(op:presets) lists the presets; keyframes:[…] writes one raw track per unit instead.');
  }
  if (args.order !== undefined && !isStaggerOrder(args.order)) {
    return errResult(op, `order "${String(args.order)}" is unknown.`, `Use one of: ${STAGGER_ORDERS.join(', ')}.`);
  }

  const spec = readYAML<DesignSpec>(dPath);
  if (!args.page_id && pagesWithLayer(spec, id).length > 1) {
    return errResult(op, `Layer id "${id}" exists on several pages — refusing to guess which one.`, 'Pass page_id.');
  }
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const src = findLayer(scoped.scope, id);
  if (!src || src.type !== 'text') {
    return errResult(op, src ? `"${id}" is a ${src.type}, not text` : `No such layer: ${id}`, 'manage_design {op:"inspect"} lists the text layers.');
  }

  const o = src as unknown as Record<string, unknown>;
  const style = (o['style'] ?? {}) as Record<string, unknown>;
  const family = typeof style['font_family'] === 'string' ? style['font_family'].split(',')[0].trim().replace(/^['"]|['"]$/g, '') : 'Inter';
  const dirs = [fontsDir(), projectFontsDir(args.project_path ?? path.dirname(path.dirname(dPath))) ?? ''].filter(Boolean);
  const { units, exact } = splitLayer(src, by, metricsForFamily(family, dirs));
  if (units.length === 0) return errResult(op, `"${id}" has no text to animate`, 'Give it content first.');

  // Each unit is placed and measured, so it must not re-align or re-anchor inside its own box.
  const pieceStyle: Record<string, unknown> = { ...style, ...(by === 'line' ? {} : { align: 'left', text_align: 'left' }) };
  delete pieceStyle['vertical_align'];
  const fontSize = typeof style['font_size'] === 'number' ? style['font_size'] : 16;
  const pad = Math.round(fontSize * 0.15);
  // A line box is shorter than its ink: Archivo 800 inks 1.18em under the line top
  // whatever the line_height, so a mask one line tall cut every g, y and p at rest.
  // The mask is there to hide a unit before it arrives, never to crop it after.
  const inkDepth = Math.round(fontSize * 1.3);
  const taken = collectLayerIds(scoped.scope);
  const claim = (base: string): string => { const got = freeLayerId(taken, base); taken.add(got); return got; };
  const created: string[] = [];
  const made: Layer[] = units.map((u, i) => {
    const piece: Record<string, unknown> = { ...o, id: claim(`${id}_${by[0]}${i + 1}`), x: u.x, y: u.y, width: u.width, height: u.height,
      content: { type: 'plain', value: u.text }, style: pieceStyle };
    delete piece['animation'];
    created.push(String(piece['id']));
    if (!args.mask) return piece as unknown as Layer;
    // The mask holds still while its unit moves — type rising from under an edge.
    return { id: claim(`${id}_mask${i + 1}`), type: 'group', z: o['z'] ?? 1, clip: true,
      x: u.x - pad, y: u.y, width: u.width + pad * 2, height: Math.max(u.height, inkDepth), layers: [piece] } as unknown as Layer;
  });

  const bak = snapshot(dPath);
  const replacement = args.keep_source === true ? [{ ...o, visible: false } as unknown as Layer, ...made] : made;
  commitScope(spec, scoped.page, replaceLayer(scoped.scope, id, replacement));
  writeYAML(dPath, spec);

  const stagger = Math.max(0, args.stagger_ms ?? DEFAULT_STAGGER[by]);
  const aim = { design_path: dPath, page_id: args.page_id, layer_ids: created, stagger_ms: stagger, order: args.order };
  const motion = hasFrames
    ? setTrack({ ...aim, keyframes: args.keyframes, playback: args.playback } as Parameters<typeof setTrack>[0])
    // Behind a mask, a 24px rise starts with most of the unit already showing; travel
    // the mask's own depth so each unit really comes up from under the edge.
    : applyMotion({ ...aim, preset: String(args.preset), duration: args.duration, easing: args.easing, distance: args.distance ?? (args.mask ? inkDepth : undefined) });
  if (!motion.success) {
    if (typeof bak === 'string' && fs.existsSync(bak)) fs.copyFileSync(bak, dPath);
    return errResult(op, `The split was undone: ${String(motion['error'] ?? 'the motion was refused')}`, String(motion['hint'] ?? 'Fix the preset or keyframes and call again.'));
  }

  const progress: ProgressItem[] = [pOk(`Split "${id}" into ${units.length} ${by === 'char' ? 'character' : by} unit(s)${args.mask ? ', each behind its own mask' : ''}`, `${created[0]} …`)];
  if (!exact) progress.push(pWarn('Placed from an ESTIMATE, not font metrics', `No readable font file for "${family}", so the run may drift. Bundle the font, or animate by word or line.`));
  return okResult(op, {
    source: id, by, units: units.length, created, masked: args.mask === true,
    measured: exact ? 'font metrics' : 'estimate',
    motion: hasFrames ? 'track' : String(args.preset), stagger_ms: stagger, ...(args.order ? { order: args.order } : {}),
    progress: [...progress, ...((motion['progress'] as ProgressItem[] | undefined) ?? [])],
    next_action: { tool: 'animation', params: { op: 'frame', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}), t: Math.round((stagger * units.length) / 2) }, remaining: 0,
      hint: 'Check a pose mid-run with op:frame; each unit is an ordinary text layer with an ordinary track.' },
  }, bak);
}
