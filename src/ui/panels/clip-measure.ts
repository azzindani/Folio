// What the footage's shots and silences are, as the editor knows them.
//
// Measured on the server (editor/server-clip-measure.ts: ffmpeg) over the part of the file a clip plays, and
// kept here, on the FILE clock, so a trim only hides what it cuts off — nothing is measured twice. The scene
// clock comes from the same arithmetic the engine cuts by (animation/video-clip.ts summarize): a clip at one
// speed maps linearly; a ramp or a freeze has no single mapping, so it shows no ticks.

import type { StateManager } from '../../editor/state';
import type { Layer } from '../../schema/types';
import { summarize, splitClip, type ClipLayer } from '../../animation/video-clip';
import { rampKeys } from '../../animation/video-time';
import { measureClip } from '../../editor/clip-bridge';

type Span = [number, number];
interface Known { src: string; from: number; to: number; shots: number[]; silences: Span[] }

const known = new Map<string, Known>();
const listeners = new Set<() => void>();

/** Called whenever something new has been measured — the timeline redraws its ticks. */
export function onMeasured(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** True when a clip's speed has one mapping between its file and the scene. */
const linear = (l: ClipLayer): boolean => !l.video?.still && rampKeys(l.video).length === 0;

/** The measured shots and silences of the part the clip plays now — null until measured, or when a trim has since brought in footage never measured. */
export function measuredFor(l: ClipLayer): { shots: number[]; silences: Span[] } | null {
  const k = known.get(l.id);
  const s = summarize(l);
  if (!k || k.src !== l.src || s.file.from < k.from || (s.file.to ?? Infinity) > k.to) return null;
  return {
    shots: k.shots.filter(ms => ms > s.file.from && ms < (s.file.to ?? Infinity)),
    silences: k.silences.map(([a, b]): Span => [Math.max(a, s.file.from), Math.min(b, s.file.to ?? b)]).filter(([a, b]) => b > a),
  };
}

/** File-clock moments of a clip as scene ms (empty when the clip's speed has no single mapping). */
export function sceneTimes(l: ClipLayer, fileMs: number[]): number[] {
  if (!linear(l)) return [];
  const s = summarize(l);
  return fileMs.map(ms => Math.round(s.plays.from + (ms - s.file.from) / s.speed));
}

/** The shot cuts of a clip on the scene clock, for ticks and snap points. */
export function shotsOnScene(l: Layer): number[] {
  const m = measuredFor(l as ClipLayer);
  return m ? sceneTimes(l as ClipLayer, m.shots) : [];
}

/** Ask the server to measure the clip; the reason as a string when it cannot. */
export async function measure(state: StateManager, l: ClipLayer): Promise<string | null> {
  const r = await measureClip(state, l.id);
  if ('error' in r) return r.error;
  known.set(l.id, { src: l.src ?? '', from: r.from, to: r.to, shots: r.shots, silences: r.silences });
  listeners.forEach(fn => fn());
  return null;
}

/** Every layer id in the tree. */
function ids(layers: Layer[], into = new Set<string>()): Set<string> {
  for (const l of layers) { into.add(l.id); const k = (l as ClipLayer).layers; if (Array.isArray(k)) ids(k, into); }
  return into;
}

/** The clip cut at each moment (scene ms): first piece keeps the id, the rest are `<id>_2`, `_3`… A moment outside the clip is skipped. */
export function splitAt(state: StateManager, l: ClipLayer, at: number[]): ClipLayer[] {
  const used = ids(state.getCurrentLayers());
  const pieces: ClipLayer[] = [];
  let rest = l, n = 2;
  for (const t of [...at].sort((a, b) => a - b)) {
    while (used.has(`${l.id}_${n}`)) n++;
    const id = `${l.id}_${n}`;
    const halves = splitClip(rest, t, id);
    if (halves.length !== 2 || !halves[0] || !halves[1]) continue;
    used.add(id); pieces.push(halves[0]); rest = halves[1];
  }
  return [...pieces, rest];
}
