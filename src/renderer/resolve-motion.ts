/**
 * Motion rules (phase 3, S4) — a layer's motion stored as what it IS ("rise at
 * 1.2 s for 600 ms, fade out at 5.2 s") instead of the keyframes that spell it.
 * A rise is two frames and a playback block; a scene of forty moving layers
 * wrote them all out, and changing one beat meant rewriting the frames.
 *
 * Compiled here into the same keyframes and playback animation(op:sequence)
 * writes — expandPreset + mergeFragment — so everything after the resolver
 * (renderer, CSS, frames, lint, the editor's canvas) reads an ordinary track.
 * A number field may be a formula over the design's names, and in a gallery
 * over Index ("=Index * 120" staggers the cells). A rule that cannot compile is
 * not applied and is reported, like a formula.
 */

import type { Layer } from '../schema/types';
import type { AnimationSpec, MotionRule } from '../animation/types';
import { isKnownEasing } from '../animation/easing';
import { isFormula } from '../scripting/formula';
import { evalSource, type SourceScope, type SourceProblem } from '../scripting/formula-source';
import { expandPreset, isMotionPreset, PRESET_KIND, PRESET_NAMES } from '../mcp/engine/motion-presets';
import { mergeFragment, MergeError } from '../mcp/engine/motion-merge';

type Animated = Layer & { animation?: AnimationSpec; layers?: Layer[] };

/** A rule's number field, its formula evaluated. */
function numberOf(v: unknown, scope: SourceScope): number | string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : `${v} is not a number`;
  if (!isFormula(v)) return `"${String(v)}" is not a number or a "=…" formula`;
  const r = evalSource(v, scope);
  if (!r.ok) return r.error;
  return typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : `it gives ${String(r.value)}`;
}

/** The track a layer's rules spell, or why they spell none. */
export function compileRules(rule: MotionRule | MotionRule[], scope: SourceScope): AnimationSpec | string {
  const rules = Array.isArray(rule) ? rule : [rule];
  if (!rules.length) return 'the rule list is empty';
  let track: AnimationSpec | undefined;
  for (const [i, r] of rules.entries()) {
    const where = rules.length > 1 ? `rule ${i + 1}: ` : '';
    if (!isMotionPreset(r?.preset)) return `${where}preset "${String(r?.preset)}" is unknown (${PRESET_NAMES.slice(0, 12).join(', ')}…)`;
    if (r.easing !== undefined && !isKnownEasing(r.easing)) return `${where}easing "${String(r.easing)}" is unknown`;
    const nums: Record<string, number | undefined> = {};
    for (const k of ['at', 'duration', 'distance'] as const) {
      const v = numberOf(r[k], scope);
      if (typeof v === 'string') return `${where}${k}: ${v}`;
      nums[k] = v;
    }
    const frag = expandPreset(r.preset, {
      ...(nums['duration'] ? { duration: nums['duration'] } : {}), ...(r.easing ? { easing: r.easing } : {}),
      ...(nums['distance'] !== undefined ? { distance: nums['distance'] } : {}), delay: Math.max(0, nums['at'] ?? 0),
    });
    if (PRESET_KIND[r.preset] === 'loop' && rules.length > 1) return `${where}a loop (${r.preset}) is a layer's only motion — give it its own layer`;
    try {
      track = track ? mergeFragment(track, frag) : { keyframes: frag.keyframes, playback: frag.playback };
    } catch (e) {
      if (e instanceof MergeError) return `${where}${e.message}`;
      throw e;
    }
  }
  return track ?? 'the rule list is empty';
}

const hasRule = (l: Layer): boolean => (l as Animated).animation?.rule !== undefined;

/** The tree with every motion rule compiled into its track; the same array when there is none. */
export function resolveMotionRules(layers: Layer[], scope: SourceScope, problems?: SourceProblem[]): Layer[] {
  const out = layers.map((l): Layer => {
    const node = l as Animated;
    const kids = Array.isArray(node.layers) ? resolveMotionRules(node.layers, scope, problems) : undefined;
    let next: Animated = kids && kids !== node.layers ? { ...node, layers: kids } : node;
    const rule = hasRule(l) ? node.animation?.rule : undefined;
    if (rule !== undefined) {
      const track = compileRules(rule, scope);
      if (typeof track === 'string') {
        problems?.push({ layer_id: l.id, prop: 'animation.rule', formula: JSON.stringify(rule), error: track });
      } else {
        const { rule: _rule, keyframes: _k, playback: _p, ...rest } = node.animation ?? {};
        void _rule; void _k; void _p;
        next = { ...next, animation: { ...rest, ...track } };
      }
    }
    return next;
  });
  return out.every((l, i) => l === layers[i]) ? layers : out;
}

/** Whether anything under `layers` carries a motion rule. */
export const hasMotionRules = (layers: Layer[]): boolean =>
  layers.some(l => hasRule(l) || (Array.isArray((l as Animated).layers) && hasMotionRules((l as Animated).layers ?? [])));
