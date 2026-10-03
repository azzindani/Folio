// The Transition section — how this clip ENTERS from the clip ending where it starts (animation/clip-transition.ts).
// A transition belongs to the join, so it needs a clip before this one on the track; the rules (the range, the
// colour, what a join is) are the engine's own, via animation/clip-edit.ts.

import type { ClipLayer } from '../../animation/video-clip';
import { predecessorOf, DEFAULT_TRANSITION_MS, MIN_TRANSITION_MS, MAX_TRANSITION_MS, type ClipTransition, type ClipTransitionType } from '../../animation/clip-transition';
import { siblingsOf, writeClip, type ClipEnv } from './clip-commit';
import { bindClip, block, colour, disable, note, pick, range, type ClipSet, type Section } from './clip-controls';

const TYPES: ReadonlyArray<readonly [string, string]> = [['', 'None — a hard cut'], ['crossfade', 'Crossfade'], ['dip', 'Dip to colour'], ['wipe', 'Wipe'], ['push', 'Push']];
const SIDES: ReadonlyArray<readonly [string, string]> = [['left', 'Toward the left'], ['right', 'Toward the right'], ['up', 'Upward'], ['down', 'Downward']];

/** What the file should hold: only the keys this type reads (a colour belongs to a dip, a direction to a wipe or push). */
export function cleanTransition(t: ClipTransition): ClipTransition {
  const out: ClipTransition = { type: t.type };
  if (t.duration_ms !== undefined) out.duration_ms = t.duration_ms;
  if (t.type === 'dip' && t.color) out.color = t.color;
  if ((t.type === 'wipe' || t.type === 'push') && t.direction) out.direction = t.direction;
  return out;
}

export function transitionSection(layer: ClipLayer, env: ClipEnv): Section {
  const t = layer.video?.transition;
  const joined = predecessorOf(siblingsOf(env.state.getCurrentLayers(), env.layerId).filter(l => l.id !== layer.id), layer) !== null;
  const dim = (html: string, on: boolean): string => (on ? html : disable(html));
  const type = t?.type ?? '';
  const usable = joined && !!t;
  const body = (joined || t ? pick('type', 'Enters with', TYPES, type) : disable(pick('type', 'Enters with', TYPES, type)))
    + dim(range('duration', 'Length', t?.duration_ms ?? DEFAULT_TRANSITION_MS, MIN_TRANSITION_MS, MAX_TRANSITION_MS, 50, 0, ' ms'), usable)
    + (type === 'dip' ? dim(colour('color', 'Dip colour', (t?.color ?? '#000000').toLowerCase()), usable) : '')
    + (type === 'wipe' || type === 'push' ? dim(pick('direction', 'Direction', SIDES, t?.direction ?? 'left'), usable) : '')
    + (t && layer.animation?.keyframes?.length ? note('This clip has motion of its own: the export plays the transition over it, but the preview here does not show it.') : '')
    + note(joined ? 'Plays over the cut: the clip before keeps playing and this one starts early, from its own footage. The cut itself stays put.'
      : 'No clip ends where this one starts. Lay clips end to end on the track — then they can join.');

  const write = (change: Omit<Partial<ClipTransition>, 'type'> & { type?: string }): void => {
    const now = (env.state.findLayer(env.layerId) as ClipLayer | undefined)?.video?.transition;
    if (change.type === '') { writeClip(env, { clip_transition: null }); return; }
    const next = { ...now, ...change, type: (change.type ?? now?.type ?? 'crossfade') as ClipTransitionType };
    writeClip(env, { clip_transition: cleanTransition(next) });
  };
  const set: ClipSet = (key, value) => {
    if (key === 'type') write({ type: String(value) });
    else if (key === 'duration') write({ duration_ms: Math.round(Number(value)) });
    else if (key === 'color') write({ color: String(value) });
    else if (key === 'direction') write({ direction: String(value) as ClipTransition['direction'] });
  };
  return { html: block('Transition', body, !t), bind: root => bindClip(root, env, set) };
}
