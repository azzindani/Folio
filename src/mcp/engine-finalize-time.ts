/**
 * Layers placed for a MOMENT — the rescue passes leave them where they are.
 *
 * The rescue passes (reflow, un-stack, re-center, re-light) judge a design as
 * one still. A piece that moves shows its beats one after another in the same
 * space, so a cover headline and the payoff line that replaces it overlap on
 * paper and never on screen. Found on the one-shot proof piece (stop-forwarding,
 * 2026-09-26): 11 layers "healed" — the cover's second line pushed down, the
 * payoff shoved onto the desk. A layer whose time on screen is authored — an
 * in/out span, an entrance or exit rule, keyframes that fade it in or out — was
 * placed for its moment; the gate's motion review judges it at the moments it
 * is actually seen. Only in/out spans were honoured before, and by one pass.
 */

import type { Layer } from '../schema/types';
import { PRESET_KIND } from './engine/motion-presets';

type Timed = { in?: unknown; out?: unknown; locked?: unknown; animation?: { rule?: unknown; keyframes?: Array<{ opacity?: unknown }> } };

/** Below this a keyframed opacity means the layer is off screen at that key. */
const GONE = 0.05;

/** True when the layer appears or disappears over time by the author's hand. */
export function placedInTime(l: Layer): boolean {
  const o = l as unknown as Timed;
  if (o.in !== undefined || o.out !== undefined) return true;
  const rule = o.animation?.rule;
  const rules = rule === undefined ? [] : Array.isArray(rule) ? rule : [rule];
  const comesOrGoes = rules.some(r => {
    const kind = PRESET_KIND[(r as { preset?: unknown } | null)?.preset as keyof typeof PRESET_KIND];
    return kind === 'entrance' || kind === 'exit';
  });
  if (comesOrGoes) return true;
  return (o.animation?.keyframes ?? []).some(k => typeof k.opacity === 'number' && k.opacity < GONE);
}

/** The author's placement stands: locked, or placed for its moment. */
export function keepsItsPlace(l: Layer): boolean {
  return (l as unknown as Timed).locked === true || placedInTime(l);
}
