/**
 * Reading `animation(op:storyboard)` shots into per-layer changes of state.
 *
 * A shot says WHEN (`at`, a time or a name) and WHERE each object is
 * (`states`). The rest — how the objects get there — is compiled by
 * motion-states.ts. Everything a model writes is checked here, so a typo in a
 * layer id or a loop preset comes back as a sentence, not a silent no-op.
 */

import type { Layer } from '../../schema/types';
import type { TimeMarkers } from '../../animation/types';
import { isKnownEasing } from '../../animation/easing';
import { isMotionPreset, PRESET_KIND, type MotionPreset } from './motion-presets';
import { isStaggerOrder, staggerRanks, STAGGER_ORDERS, type StaggerOrder } from './motion-order';
import { motionTargets } from './motion';
import { resolveTime, usableMarkerName } from './motion-time';
import type { LayerState, StateChange } from './motion-states';

export interface ParsedShot {
  id: string;
  at: number;
  /** The layers this shot changes, in the order written. */
  layers: string[];
}

export interface ParsedStoryboard { shots: ParsedShot[]; changes: Map<string, StateChange[]>; targets: Map<string, Layer> }

const NUMERIC = ['x', 'y', 'dx', 'dy', 'scale', 'scale_x', 'scale_y', 'rotation', 'opacity', 'blur', 'skew_x', 'skew_y', 'duration', 'delay'] as const;
const DEFAULT_GAP = 3000;

/** A state written as a word: "hidden", "show", or a preset name ("rise" enters, "fade_out" leaves). */
function wordState(word: string): LayerState | string {
  if (word === 'hidden' || word === 'hide') return { hidden: true };
  if (word === 'show' || word === 'shown') return { opacity: 1 };
  if (isMotionPreset(word)) {
    if (PRESET_KIND[word] === 'entrance') return { enter: word };
    if (PRESET_KIND[word] === 'exit') return { exit: word };
    return `"${word}" is a loop — a storyboard state holds still; put a loop on its own layer with op:motion or op:wiggle.`;
  }
  return `"${word}" is not a state: use an object {x, y, scale, opacity, …}, "hidden", "show", or an entrance/exit preset name.`;
}

function readState(raw: unknown, where: string): { state: LayerState; duration?: number; delay?: number; easing?: string } | string {
  if (typeof raw === 'string') {
    const s = wordState(raw);
    return typeof s === 'string' ? `${where}: ${s}` : { state: s };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return `${where} must be an object or a word ("hidden", "rise", "fade_out").`;
  const o = raw as Record<string, unknown>;
  for (const k of NUMERIC) if (o[k] !== undefined && (typeof o[k] !== 'number' || !Number.isFinite(o[k]))) return `${where}.${k} must be a number.`;
  if (o['easing'] !== undefined && !isKnownEasing(o['easing'])) return `${where}.easing "${String(o['easing'])}" is unknown.`;
  for (const k of ['fill.color', 'stroke.color']) if (o[k] !== undefined && typeof o[k] !== 'string') return `${where}.${k} must be a colour string.`;
  const state: LayerState = {};
  for (const k of ['x', 'y', 'dx', 'dy', 'scale', 'scale_x', 'scale_y', 'rotation', 'opacity', 'blur', 'skew_x', 'skew_y'] as const) {
    if (typeof o[k] === 'number') state[k] = o[k] as number;
  }
  if (typeof o['fill.color'] === 'string') state['fill.color'] = o['fill.color'];
  if (typeof o['stroke.color'] === 'string') state['stroke.color'] = o['stroke.color'];
  if (o['hidden'] === true) state.hidden = true;
  for (const k of ['enter', 'exit'] as const) {
    if (o[k] === undefined) continue;
    const want = k === 'enter' ? 'entrance' : 'exit';
    if (!isMotionPreset(o[k]) || PRESET_KIND[o[k] as MotionPreset] !== want) return `${where}.${k} must be an ${want} preset (animation op:presets lists them).`;
    state[k] = o[k] as MotionPreset;
  }
  if (state.enter && state.exit) return `${where} both enters and exits — split them across two shots.`;
  return {
    state,
    ...(typeof o['duration'] === 'number' ? { duration: o['duration'] } : {}),
    ...(typeof o['delay'] === 'number' ? { delay: Math.max(0, o['delay']) } : {}),
    ...(typeof o['easing'] === 'string' ? { easing: o['easing'] } : {}),
  };
}

/**
 * Shots → per-layer changes. `markers` resolves named times; each shot's id
 * joins them as it is read, so a later shot can say at:"hook+4000".
 */
export function parseStoryboard(raw: unknown, scope: Layer[], markers: TimeMarkers): ParsedStoryboard | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return 'shots must be a non-empty array of {id?, at, states:{<layer id>: {x?, y?, scale?, opacity?, enter?, exit?, hidden?} | "hidden" | "<preset>"}}.';
  }
  const known: TimeMarkers = { ...markers };
  const shots: ParsedShot[] = [];
  const changes = new Map<string, StateChange[]>();
  const targets = new Map<string, Layer>();
  let prev: { at: number; gap: number } | undefined;

  for (const [i, s] of raw.entries()) {
    const where = `shots[${i}]`;
    if (!s || typeof s !== 'object') return `${where} is not an object.`;
    const o = s as Record<string, unknown>;
    const id = typeof o['id'] === 'string' && o['id'] ? o['id'] : `shot${i + 1}`;
    if (!usableMarkerName(id)) return `${where}.id "${id}" must be a name usable in a time: letters, digits, _ and -, not ending in -digits.`;
    if (shots.some(p => p.id === id)) return `${where}.id "${id}" is used twice.`;
    let at: number;
    if (o['at'] === undefined) at = prev ? prev.at + prev.gap : 0;
    else {
      const t = resolveTime(o['at'], { markers: known, layers: scope });
      if (typeof t === 'string') return `${where}.at: ${t}`;
      at = t;
    }
    if (prev && at < prev.at) return `${where} starts at ${at}ms, before the shot above it (${prev.at}ms). List shots in time order.`;
    for (const k of ['duration', 'stagger_ms', 'hold'] as const) {
      if (o[k] !== undefined && (typeof o[k] !== 'number' || (o[k] as number) < 0)) return `${where}.${k} must be a number of ms ≥ 0.`;
    }
    if (o['easing'] !== undefined && !isKnownEasing(o['easing'])) return `${where}.easing "${String(o['easing'])}" is unknown.`;
    if (o['order'] !== undefined && !isStaggerOrder(o['order'])) return `${where}.order must be one of: ${STAGGER_ORDERS.join(', ')}.`;
    const states = o['states'];
    if (!states || typeof states !== 'object' || Array.isArray(states)) return `${where}.states must be an object of layer id → state.`;

    const ids = Object.keys(states as object);
    const found = motionTargets(scope, ids);
    const missing = ids.filter(k => !found.some(l => l.id === k));
    if (missing.length) return `${where}: no layer ${missing.map(m => `"${m}"`).join(', ')} on this page.`;
    const order: StaggerOrder = isStaggerOrder(o['order']) ? o['order'] : 'forward';
    const ranks = staggerRanks(found, order);
    const stagger = typeof o['stagger_ms'] === 'number' ? o['stagger_ms'] : 0;
    for (const [j, layer] of found.entries()) {
      const read = readState((states as Record<string, unknown>)[layer.id], `${where}.states.${layer.id}`);
      if (typeof read === 'string') return read;
      targets.set(layer.id, layer);
      const duration = read.duration ?? (typeof o['duration'] === 'number' ? o['duration'] : undefined);
      const easing = read.easing ?? (typeof o['easing'] === 'string' ? o['easing'] : undefined);
      const change: StateChange = {
        at: at + stagger * (ranks[j] ?? j) + (read.delay ?? 0),
        state: read.state,
        ...(duration !== undefined ? { duration } : {}),
        ...(easing !== undefined ? { easing } : {}),
      };
      changes.set(layer.id, [...(changes.get(layer.id) ?? []), change]);
    }
    shots.push({ id, at, layers: found.map(l => l.id) });
    known[id] = at;
    prev = { at, gap: typeof o['hold'] === 'number' ? o['hold'] : DEFAULT_GAP };
  }
  return { shots, changes, targets };
}
