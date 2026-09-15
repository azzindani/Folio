/**
 * Multi-scene timing — a deck's pages played one after another as one piece.
 *
 * Each page is a scene with its own timeline (every motion op takes page_id).
 * This decides when each scene is on screen; scene-compose.ts renders a moment.
 *
 *  • A scene lasts until its last motion ends, plus a hold — or exactly
 *    `page.auto_advance` ms when the page sets one.
 *  • A page's `transition` plays as it ENTERS: its scene starts on the frame the
 *    transition starts, so incoming entrances animate while the wipe or slide
 *    runs, and the outgoing scene rests on its final pose underneath.
 *  • The engine does not decide how long a viewer needs. It measures words on
 *    screen against a reading rate and WARNS when a scene is too short — the
 *    model chooses whether that matters.
 */

import type { DesignSpec, Layer, PageTransitionType } from '../schema/types';
import { oneShotDuration } from './gif-frames';

export const DEFAULT_HOLD_MS = 1500;
export const DEFAULT_TRANSITION_MS = 400;
/** Comfortable on-screen reading rate for short copy, words per minute. */
const READ_WPM = 240;

export interface SceneTransition { type: PageTransitionType; duration_ms: number; easing?: string }

export interface PlannedScene {
  index: number;
  page_id: string;
  start_ms: number;
  length_ms: number;
  /** When the scene's own motion finishes, ms from its start. */
  motion_ms: number;
  words: number;
  /** Time to read `words` at READ_WPM. */
  read_ms: number;
  /** Transition INTO this scene; null for the first scene and for a cut. */
  transition: SceneTransition | null;
}

export interface ScenePlan { scenes: PlannedScene[]; total_ms: number; warnings: string[] }

/** A moment of the piece: the scene on screen and, mid-transition, the one leaving. */
export interface SceneMoment {
  scene: PlannedScene;
  local_ms: number;
  from?: { scene: PlannedScene; local_ms: number; progress: number };
}

/** Words of copy across a layer tree — every text layer, groups descended. */
export function countWords(layers: Layer[]): number {
  let words = 0;
  const visit = (l: Layer): void => {
    const o = l as unknown as Record<string, unknown>;
    if (l.type === 'text') {
      const content = o['content'] as { value?: unknown } | undefined;
      const text = typeof content?.value === 'string' ? content.value : typeof o['text'] === 'string' ? o['text'] : '';
      words += (text.match(/\S+/g) ?? []).length;
    }
    const kids = o['layers'];
    if (Array.isArray(kids)) for (const k of kids as Layer[]) visit(k);
  };
  for (const l of layers) visit(l);
  return words;
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export function planScenes(spec: DesignSpec, opts: { hold_ms?: number } = {}): ScenePlan {
  const hold = Math.max(0, opts.hold_ms ?? DEFAULT_HOLD_MS);
  const scenes: PlannedScene[] = [];
  const warnings: string[] = [];
  let cursor = 0;

  (spec.pages ?? []).forEach((page, index) => {
    const layers = page.layers ?? [];
    // Endless loops never finish, so only motion that ends decides when the scene's motion is done.
    const motion = oneShotDuration(layers);
    const auto = typeof page.auto_advance === 'number' && page.auto_advance > 0 ? page.auto_advance : undefined;
    const length = Math.max(1, auto ?? motion + hold);
    const words = countWords(layers);
    const read = Math.round((words / READ_WPM) * 60_000);
    const t = index > 0 ? page.transition : undefined;
    const transition = t && t.type !== 'none'
      ? { type: t.type, duration_ms: Math.min(length, Math.max(0, t.duration ?? DEFAULT_TRANSITION_MS)), ...(t.easing ? { easing: String(t.easing) } : {}) }
      : null;

    scenes.push({ index, page_id: page.id, start_ms: cursor, length_ms: length, motion_ms: motion, words, read_ms: read, transition });
    if (words > 0 && length < read) {
      warnings.push(`Scene "${page.id}" is on screen ${secs(length)} but carries ${words} words (~${secs(read)} to read). ` +
        'Lengthen it with animation(op:scene, length_ms), pass hold_ms, or cut copy.');
    }
    if (auto !== undefined && auto < motion) {
      warnings.push(`Scene "${page.id}" ends at ${auto}ms but its motion runs to ${motion}ms — the last ${motion - auto}ms is cut off.`);
    }
    cursor += length;
  });

  return { scenes, total_ms: cursor, warnings };
}

/** Which scene is on screen at global time t (clamped to the piece). */
export function sceneAt(plan: ScenePlan, t: number): SceneMoment {
  const { scenes } = plan;
  if (scenes.length === 0) throw new Error('sceneAt: the plan has no scenes.');
  const at = Math.min(Math.max(0, t), plan.total_ms);
  let i = scenes.length - 1;
  while (i > 0 && scenes[i].start_ms > at) i--;
  const scene = scenes[i];
  const local = at - scene.start_ms;
  const tr = scene.transition;
  if (i > 0 && tr && tr.duration_ms > 0 && local < tr.duration_ms) {
    const prev = scenes[i - 1];
    return { scene, local_ms: local, from: { scene: prev, local_ms: prev.length_ms + local, progress: local / tr.duration_ms } };
  }
  return { scene, local_ms: local };
}
