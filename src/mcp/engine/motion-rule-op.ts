/**
 * op:sequence as_rule (phase 3, S4) — a step stored as the layer's motion RULE
 * (`animation.rule`: preset, at, duration…) instead of the keyframes it spells.
 * The resolver compiles it into the same track the keyframe path writes
 * (renderer/resolve-motion.ts), so exports, frames and the editor play it the
 * same; the file keeps five lines where the track kept twenty, and re-timing
 * is one number. A later call's entrance takes the place of the one before it,
 * as withoutKind does for written tracks.
 */

import type { Layer } from '../../schema/types';
import type { AnimationSpec, EasingFunction, MotionRule } from '../../animation/types';
import { PRESET_KIND, type MotionPreset } from './motion-presets';
import { compileRules } from '../../renderer/resolve-motion';
import type { SourceScope } from '../../scripting/formula-source';

export interface RuleStep { preset: MotionPreset; at: number; duration?: number; easing?: string; distance?: number }

const kindOf = (r: MotionRule): string | undefined => PRESET_KIND[r.preset as MotionPreset];
const rulesOf = (a: AnimationSpec | undefined): MotionRule[] => (a?.rule === undefined ? [] : Array.isArray(a.rule) ? a.rule : [a.rule]);

/**
 * The layer's animation with this step among its rules, the track they compile
 * to and whether an earlier rule of the same kind gave way — or why not.
 */
export function addRule(layer: Layer, step: RuleStep, replaceKind: boolean, scope: SourceScope):
  { animation: AnimationSpec; track: AnimationSpec; replaced: boolean } | string {
  const anim = (layer as Layer & { animation?: AnimationSpec }).animation;
  if (anim?.keyframes?.length && anim.rule === undefined) {
    return `"${layer.id}" already has a written track, which a rule would replace`;
  }
  const had = rulesOf(anim);
  const kind = PRESET_KIND[step.preset];
  const kept = replaceKind ? had.filter(r => kindOf(r) !== kind) : had;
  const rule: MotionRule = {
    preset: step.preset, at: step.at,
    ...(step.duration ? { duration: step.duration } : {}),
    ...(step.easing ? { easing: step.easing as EasingFunction } : {}),
    ...(step.distance !== undefined ? { distance: step.distance } : {}),
  };
  const rules = [...kept, rule];
  // Stored in time order when every start is a number; a formula start keeps its place.
  if (rules.every(r => typeof r.at === 'number')) rules.sort((a, b) => (a.at as number) - (b.at as number));
  const stored = rules.length === 1 ? rules[0] : rules;
  if (!stored) return 'no rule to store';
  const track = compileRules(stored, scope);
  if (typeof track === 'string') return `"${layer.id}": ${track}`;
  return { animation: { ...(anim ?? {}), rule: stored }, track, replaced: kept.length < had.length };
}
