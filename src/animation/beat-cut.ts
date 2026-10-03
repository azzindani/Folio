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

export const MIN_CUT_CLIP_MS = 100;

type Clip = Layer & { in?: number; out?: number; video?: { offset_ms?: number; duration_ms?: number; speed?: number; loop?: boolean } };
export interface BeatCutOptions { every?: number; max_shift_ms?: number; end?: boolean; fileMs?: Record<string, number | null | undefined> }
export interface CutMove { between: [string, string]; from_ms: number; to_ms: number }
export interface CutKept { between: [string, string] | [string]; at_ms: number; reason: string }
export interface BeatCutPlan { track: string[]; patches: Map<string, Record<string, unknown>>; moved: CutMove[]; kept: CutKept[] }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const speedOf = (c: Clip): number => ((num(c.video?.speed) ?? 0) > 0 ? (num(c.video?.speed) ?? 1) : 1);

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
interface Work { id: string; speed: number; from: number; until: number | null; offset: number; used: number | undefined; hasOut: boolean; loop: boolean; file: number | null }

/** The track's joins (and, with `end`, its last frame) snapped onto `grid`. */
export function planBeatCuts(track: Layer[], grid: number[], o: BeatCutOptions = {}): BeatCutPlan {
  const every = Math.max(1, Math.round(o.every ?? 1));
  const beats = every > 1 ? grid.filter((_, i) => i % every === 0) : grid;
  const maxShift = o.max_shift_ms ?? Infinity;
  const work: Work[] = track.map(l => {
    const c = l as Clip, p = clipPlays(c);
    return { id: l.id, speed: speedOf(c), from: p.from, until: p.until, offset: num(c.video?.offset_ms) ?? 0, used: num(c.video?.duration_ms), hasOut: num(c.out) !== undefined, loop: c.video?.loop === true, file: o.fileMs?.[l.id] ?? null };
  });
  const moved: CutMove[] = [], kept: CutKept[] = [];
  const tailRoom = (w: Work): number => (w.loop || w.file === null || w.used === undefined ? Infinity : Math.max(0, (w.file - w.offset - w.used) / w.speed));
  const headRoom = (w: Work): number => w.offset / w.speed;
  const near = (at: number): number[] => beats.filter(b => Math.abs(b - at) <= maxShift).sort((p, q) => Math.abs(p - at) - Math.abs(q - at)).slice(0, 4);

  for (let k = 0; k + 1 < work.length; k++) {
    const A = work[k] as Work, B = work[k + 1] as Work;
    const cut = B.from, bEnd = B.until ?? Infinity;
    let why = 'no beat near it';
    const to = near(cut).find(b => {
      if (b - A.from < MIN_CUT_CLIP_MS || bEnd - b < MIN_CUT_CLIP_MS) { why = `a clip would be shorter than ${MIN_CUT_CLIP_MS}ms`; return false; }
      if (b > cut && b - cut > tailRoom(A)) { why = `"${A.id}" has only ${Math.round(tailRoom(A))}ms of file left to run on`; return false; }
      if (b < cut && cut - b > headRoom(B)) { why = `"${B.id}" has only ${Math.round(headRoom(B))}ms of file before its start`; return false; }
      return true;
    });
    if (to === undefined) { kept.push({ between: [A.id, B.id], at_ms: Math.round(cut), reason: why }); continue; }
    const d = to - cut;
    if (d === 0) continue;
    if (A.used !== undefined) A.used += d * A.speed;
    A.until = to;
    B.from = to; B.offset += d * B.speed;
    if (B.used !== undefined) B.used -= d * B.speed;
    moved.push({ between: [A.id, B.id], from_ms: Math.round(cut), to_ms: Math.round(to) });
  }
  const Z = work[work.length - 1];
  if (o.end !== false && Z && Z.until !== null) {
    const end = Z.until;
    const to = near(end).find(b => b - Z.from >= MIN_CUT_CLIP_MS && (b <= end || b - end <= tailRoom(Z)));
    if (to === undefined) kept.push({ between: [Z.id], at_ms: Math.round(end), reason: 'no beat it can end on' });
    else if (to !== end) {
      if (Z.used !== undefined) Z.used += (to - end) * Z.speed;
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
      video: { ...(c.video ?? {}), offset_ms: Math.round(w.offset), ...(w.used !== undefined ? { duration_ms: Math.max(1, Math.round(w.used)) } : {}) },
    });
  });
  return out;
}
