// ❄ Freeze frame — hold the picture at the playhead for a while, and let everything after it move later.
//
// That ripples the whole scene (keys, in/out points, markers, sound), which only the engine does
// (animation(op:video, freeze)), so the edit is asked of the server (editor/clip-bridge.ts) and the design
// it writes comes back as one undo step. The hold is remembered between uses.

import type { StateManager } from '../../editor/state';
import type { Layer } from '../../schema/types';
import { summarize, type ClipLayer } from '../../animation/video-clip';
import { runClipOp } from '../../editor/clip-bridge';
import { motionHost } from '../../editor/motion-host';
import { showToast } from '../../utils/toast';

/** Shortest and longest hold the engine accepts, ms. */
export const MIN_HOLD_MS = 100, MAX_HOLD_MS = 10_000;
let hold = 1000;
export const holdMs = (): number => hold;
export const setHoldMs = (ms: number): void => { hold = Math.round(Math.min(MAX_HOLD_MS, Math.max(MIN_HOLD_MS, ms))); };

const videos = (layers: Layer[]): ClipLayer[] => layers.flatMap(l => {
  const kids = (l as ClipLayer).layers;
  return l.type === 'video' ? [l as ClipLayer] : Array.isArray(kids) ? videos(kids) : [];
});

/** The clip to freeze: the one asked for, else the selected clip, else the top clip playing under the playhead. */
export function clipToFreeze(state: StateManager, id: string | undefined, at: number): ClipLayer | null {
  const all = videos(state.getCurrentLayers());
  const named = id ? all.find(l => l.id === id) : state.getSelectedLayers().find(l => l.type === 'video') as ClipLayer | undefined;
  if (named) return named;
  return [...all].reverse().find(l => { const s = summarize(l); return at >= s.plays.from && (s.plays.until === null || at < s.plays.until); }) ?? null;
}

/** Freeze the clip at the playhead for the remembered hold. True when the design was changed. */
export async function freezeAtPlayhead(state: StateManager, layerId?: string): Promise<boolean> {
  const at = Math.round(motionHost()?.time ?? 0);
  const clip = clipToFreeze(state, layerId, at);
  if (!clip) { showToast('No clip is playing at the playhead.', 'info'); return false; }
  if (clip.video?.still) { showToast(`"${clip.id}" is already a freeze.`, 'info'); return false; }
  const r = await runClipOp(state, { layer_id: clip.id, freeze: { at, duration_ms: hold } });
  if (!r.ok) { showToast(r.error ?? 'The freeze did not happen.', 'warning'); return false; }
  showToast(`Held ${(hold / 1000).toFixed(1)}s at ${(at / 1000).toFixed(2)}s — everything after moved later.`, 'success');
  return true;
}
