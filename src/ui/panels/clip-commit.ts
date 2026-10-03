// How the Clip inspector writes a clip — through animation/clip-edit.ts, the rules animation(op:video)
// follows, so a value either accepts the other accepts. One undo step per gesture: a slider drag is one
// step however many `input` events it fires.

import type { StateManager } from '../../editor/state';
import type { Layer } from '../../schema/types';
import { editClip, type TimingEdits, type LookEdits } from '../../animation/clip-edit';
import type { ClipLayer } from '../../animation/video-clip';
import { showToast } from '../../utils/toast';

/** The clip being edited, and how the panel redraws once an edit is done. */
export interface ClipEnv { state: StateManager; layerId: string; refresh(): void }

/** What the inspector can change: the engine's own edits, and the layer's fit (not part of `video`). */
export type ClipChange = TimingEdits & LookEdits & { fit?: string | null };

let gesturing = false;
/** True from a drag's first write to its last: the panel must not rebuild itself under the pointer. */
export const isClipGesture = (): boolean => gesturing;

/** The layers of the list the clip sits in — a transition joins it to the clip ending where it starts. */
export function siblingsOf(layers: Layer[], id: string): ClipLayer[] {
  if (layers.some(l => l.id === id)) return layers as ClipLayer[];
  for (const l of layers) {
    const kids = (l as ClipLayer).layers;
    const hit = Array.isArray(kids) ? siblingsOf(kids, id) : [];
    if (hit.length) return hit;
  }
  return [];
}

const DEFAULTS: Record<string, unknown> = { speed: 1, volume: 1, muted: false, loop: false };

/** The `video` block without keys that only restate a default, so the file stays as a person would write it. */
export function tidy(v: ClipLayer['video']): ClipLayer['video'] | undefined {
  const out = Object.fromEntries(Object.entries(v ?? {}).filter(([k, val]) => val !== undefined && DEFAULTS[k] !== val));
  return Object.keys(out).length ? out : undefined;
}

/** Start a drag: one undo snapshot now, none for the writes that follow. */
export function beginGesture(env: ClipEnv): void {
  if (gesturing) return;
  gesturing = true;
  env.state.beginInteraction();
}

/** End a drag and let the panel redraw with what it wrote. */
export function endGesture(env: ClipEnv): void {
  if (!gesturing) return;
  gesturing = false;
  env.refresh();
}

/** Write a change to the clip. False — and the reason shown — when the engine's rules refuse it. */
export function writeClip(env: ClipEnv, change: ClipChange): boolean {
  const layer = env.state.findLayer(env.layerId) as ClipLayer | undefined;
  if (!layer || layer.type !== 'video') return false;
  const { fit, ...edits } = change;
  const done = editClip(layer, edits, siblingsOf(env.state.getCurrentLayers(), env.layerId));
  if ('error' in done) { showToast(done.error, 'warning'); return false; }
  const patch: Record<string, unknown> = { video: tidy(done.video) };
  if (fit !== undefined) patch['fit'] = fit === null || fit === 'cover' ? undefined : fit;
  // updateLayers (not updateLayer): a key set to undefined is removed, as a tidied default must be.
  env.state.updateLayers(new Map([[env.layerId, patch]]), !gesturing);
  return true;
}
