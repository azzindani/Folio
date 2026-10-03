// Cuts on the beat — a main track's joins moved onto the music's grid.
//
// Pure arithmetic over clips already laid end to end: each join moves to the
// nearest beat (or bar line, every n beats) that keeps both clips at least
// MIN_CLIP_MS long and stays inside the footage each file has — the clip before
// a join needs file left after its used part to run later, the clip after needs
// file before its offset to start sooner. A join that cannot move stays, with
// the reason. Order and contents are the model's; only the timing is snapped.

import type { Layer } from '../schema/types';
import { clipPlays, JOIN_MS } from './clip-transition';
import { edgeRates, shiftRamp, type VideoTiming } from './video-time';

type Rates = { file: number; length: number };

export const MIN_CUT_CLIP_MS = 100;

type Clip = Layer & { in?: number; out?: number; video?: VideoTiming };
export interface BeatCutOptions {
  every?: number; max_shift_ms?: number; end?: boolean; fileMs?: Record<string, number | null | undefined>;
  /** Shot cuts in each clip's file (file clock, by clip id): a clip only runs on or starts sooner within its own shot, so no join flashes the next shot. */
  shots?: Record<string, number[] | undefined>;
}
export interface CutMove { between: [string, string]; from_ms: number; to_ms: number }
export interface CutKept { between: [string, string] | [string]; at_ms: number; reason: string }
export interface BeatCutPlan { track: string[]; patches: Map<string, Record<string, unknown>>; moved: CutMove[]; kept: CutKept[] }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The clips laid end to end around `id`, in play order — each starts within JOIN_MS of where the one before stops. */
export function trackAround(clips: Layer[], id: string): Layer[] {
  const self = clips.find(c => c.id === id && c.type === 'video');
  if (!self) return [];
  const joined = (a: Layer, b: Layer): boolean => { const u = clipPlays(a as Clip).until; return u !== null && Math.abs(clipPlays(b as Clip).from - u) <= JOIN_MS; };
  const track = [self];
  const free = (c: Layer): boolean => c.type === 'video' && !track.includes(c);
  for (let first = self; ;) {
    const prev = clips.find(c => free(c) && joined(c, first));
    if (!prev) break;
    track.unshift(prev); first = prev;
  }
  for (let last = self; ;) {
    const next = clips.find(c => free(c) && joined(last, c));
    if (!next) break;
    track.push(next); last = next;
  }
  return track;
}

/** Where each clip sits while joins move: its start, its end, and the file part it plays. */
interface Work { id: string; head: Rates; tail: Rates; from: number; until: number | null; offset: number; used: number | undefined; hasOut: boolean; loop: boolean; file: number | null; shots: number[] }

/** The track's joins (and, with `end`, its last frame) snapped onto `grid`. */
export function planBeatCuts(track: Layer[], grid: number[], o: BeatCutOptions = {}): BeatCutPlan {
  const every = Math.max(1, Math.round(o.every ?? 1));
  const beats = every > 1 ? grid.filter((_, i) => i % every === 0) : grid;
  const maxShift = o.max_shift_ms ?? Infinity;
  const work: Work[] = track.map(l => {
    const c = l as Clip, p = clipPlays(c);
    // The rates at each edge (a ramp's speed there; a still holds its frame): video-time.ts edgeRates.
    return { id: l.id, head: edgeRates(c.video, 0), tail: edgeRates(c.video, (p.until ?? p.from) - p.from), from: p.from, until: p.until, offset: num(c.video?.offset_ms) ?? 0, used: num(c.video?.duration_ms), hasOut: num(c.out) !== undefined, loop: c.video?.loop === true, file: o.fileMs?.[l.id] ?? null, shots: o.shots?.[l.id] ?? [] };
  });
  const moved: CutMove[] = [], kept: CutKept[] = [];
  // Room in the file, and within the shot the edge sits in: the next cut after the clip's end, the last one at or before its start.
  const tailRoom = (w: Work): number => {
    if (w.loop || w.used === undefined) return Infinity;
    const end = w.offset + w.used;
    const shotEnd = Math.min(w.file ?? Infinity, ...w.shots.filter(c => c > end + 1));
    return w.tail.file > 0 ? Math.max(0, (shotEnd - end) / w.tail.file) : Infinity;
  };
  const headRoom = (w: Work): number => (w.head.file > 0 ? (w.offset - Math.max(0, ...w.shots.filter(c => c <= w.offset + 1))) / w.head.file : Infinity);
  const endsIn = (w: Work): string => (w.shots.some(c => c > w.offset + (w.used ?? 0) + 1 && c < (w.file ?? Infinity)) ? 'cuts to another shot' : 'ends');
  const near = (at: number): number[] => beats.filter(b => Math.abs(b - at) <= maxShift).sort((p, q) => Math.abs(p - at) - Math.abs(q - at)).slice(0, 4);

  for (let k = 0; k + 1 < work.length; k++) {
    const A = work[k] as Work, B = work[k + 1] as Work;
    const cut = B.from, bEnd = B.until ?? Infinity;
    let why = 'no beat near it';
    const to = near(cut).find(b => {
      if (b - A.from < MIN_CUT_CLIP_MS || bEnd - b < MIN_CUT_CLIP_MS) { why = `a clip would be shorter than ${MIN_CUT_CLIP_MS}ms`; return false; }
      if (b > cut && b - cut > tailRoom(A)) { why = `"${A.id}" can run on only ${Math.round(tailRoom(A))}ms before its file ${endsIn(A)}`; return false; }
      if (b < cut && cut - b > headRoom(B)) { why = `"${B.id}" can start only ${Math.round(headRoom(B))}ms sooner before its file ${B.shots.some(c => c <= B.offset + 1) ? 'shows the shot before' : 'begins'}`; return false; }
      return true;
    });
    if (to === undefined) { kept.push({ between: [A.id, B.id], at_ms: Math.round(cut), reason: why }); continue; }
    const d = to - cut;
    if (d === 0) continue;
    if (A.used !== undefined) A.used += d * A.tail.length;
    A.until = to;
    B.from = to; B.offset += d * B.head.file;
    if (B.used !== undefined) B.used -= d * B.head.length;
    moved.push({ between: [A.id, B.id], from_ms: Math.round(cut), to_ms: Math.round(to) });
  }
  const Z = work[work.length - 1];
  if (o.end !== false && Z && Z.until !== null) {
    const end = Z.until;
    const to = near(end).find(b => b - Z.from >= MIN_CUT_CLIP_MS && (b <= end || b - end <= tailRoom(Z)));
    if (to === undefined) kept.push({ between: [Z.id], at_ms: Math.round(end), reason: 'no beat it can end on' });
    else if (to !== end) {
      if (Z.used !== undefined) Z.used += (to - end) * Z.tail.length;
      moved.push({ between: [Z.id, Z.id], from_ms: Math.round(end), to_ms: Math.round(to) });
      Z.until = to;
    }
  }
  return { track: work.map(w => w.id), patches: patchesOf(track as Clip[], work), moved, kept };
}

/** What changed per clip: in, out (when it had one), offset and length. */
function patchesOf(track: Clip[], work: Work[]): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  track.forEach((c, i) => {
    const w = work[i] as Work, p = clipPlays(c);
    if (w.from === p.from && w.until === p.until && w.offset === (num(c.video?.offset_ms) ?? 0)) return;
    out.set(c.id, {
      in: Math.round(w.from), ...(w.hasOut && w.until !== null ? { out: Math.round(w.until) } : {}),
      video: shiftRamp({ ...(c.video ?? {}), offset_ms: Math.round(w.offset), ...(w.used !== undefined ? { duration_ms: Math.max(1, Math.round(w.used)) } : {}) }, p.from - w.from),
    });
  });
  return out;
}
