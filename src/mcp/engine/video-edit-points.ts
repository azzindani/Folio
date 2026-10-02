// Where a clip changes — the edit points a cut lands on, measured, not guessed.
//
// No model: ffmpeg's scdet scores how much each frame differs from the one
// before (a hard cut scores high), and astats reads the sound's level. The model
// gets the shot cuts on the file clock and a coarse activity curve — which
// stretch moves, which is loud — and decides what to keep and where to cut.

import { spawn } from 'child_process';

/** scdet score (0–100) at which a frame starts a new shot. */
export const SHOT_SCORE = 10;
/** Two cuts closer than this are one (a flash frame, a whip pan). */
const MIN_SHOT_MS = 300;
const MAX_SHOTS = 40;
/** Activity buckets: at least this long, and never more than MAX_BUCKETS across the window. */
const BUCKET_MS = 500;
const MAX_BUCKETS = 40;

export interface Reading { ms: number; v: number }
export interface Activity { bucket_ms: number; motion: number[]; loud_db: Array<number | null> }
export interface EditPoints { shots: number[]; activity: Activity; shots_dropped?: number }

const span = (fromMs: number, toMs: number): string[] =>
  ['-hide_banner', '-nostats', '-v', 'error', '-ss', (fromMs / 1000).toFixed(3), '-t', (Math.max(1, toMs - fromMs) / 1000).toFixed(3)];

/** Every frame's scdet reading (mafd + score), printed per frame. Scaled down first: a cut is just as plain at 160 px. */
export function motionArgs(file: string, fromMs: number, toMs: number): string[] {
  return [...span(fromMs, toMs), '-i', file, '-an', '-sn', '-dn',
    '-vf', `scale=160:-2,scdet=threshold=${SHOT_SCORE},metadata=mode=print:file='pipe\\:1'`, '-f', 'null', '-'];
}

/** The sound's RMS level per BUCKET_MS of audio (8 kHz is plenty for a level). */
export function loudArgs(file: string, fromMs: number, toMs: number, bucketMs = BUCKET_MS): string[] {
  const n = Math.round((8000 * bucketMs) / 1000);
  return [...span(fromMs, toMs), '-i', file, '-vn', '-sn', '-dn',
    '-af', `aresample=8000,asetnsamples=n=${n}:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file='pipe\\:1'`,
    '-f', 'null', '-'];
}

/** One metadata key per printed frame, on the file clock (`fromMs` + the frame's pts_time). `-inf` reads as NaN. */
export function parseFrames(out: string, fromMs: number, key: string): Reading[] {
  const r: Reading[] = [];
  let t: number | null = null;
  for (const line of out.split('\n')) {
    const pts = /pts_time:(-?[0-9.]+)/.exec(line);
    if (pts) { t = fromMs + Number(pts[1]) * 1000; continue; }
    if (t !== null && line.startsWith(`${key}=`)) r.push({ ms: Math.round(t), v: Number(line.slice(key.length + 1)) });
  }
  return r;
}

/** Frames that start a new shot, merged within MIN_SHOT_MS (the sharper kept), strongest MAX_SHOTS by time. */
export function shotCuts(scores: Reading[]): { cuts: number[]; dropped: number } {
  const hits: Reading[] = [];
  for (const s of scores) {
    if (!(s.v >= SHOT_SCORE)) continue;
    const last = hits[hits.length - 1];
    if (last && s.ms - last.ms < MIN_SHOT_MS) { if (s.v > last.v) hits[hits.length - 1] = s; continue; }
    hits.push(s);
  }
  const kept = hits.length > MAX_SHOTS ? [...hits].sort((a, b) => b.v - a.v).slice(0, MAX_SHOTS) : hits;
  return { cuts: kept.map(h => h.ms).sort((a, b) => a - b), dropped: hits.length - kept.length };
}

/** Bucket length for a window: BUCKET_MS, longer when the window would need more than MAX_BUCKETS. */
export function bucketFor(fromMs: number, toMs: number): number {
  const span = Math.max(1, toMs - fromMs);
  return Math.max(BUCKET_MS, Math.ceil(span / MAX_BUCKETS / BUCKET_MS) * BUCKET_MS);
}

/** Mean of the readings in each bucket of [fromMs, toMs); null where a bucket holds none. */
export function bucketMeans(points: Reading[], fromMs: number, toMs: number, bucket: number): Array<number | null> {
  const n = Math.max(1, Math.ceil((toMs - fromMs) / bucket));
  const sum = new Array<number>(n).fill(0), count = new Array<number>(n).fill(0);
  for (const p of points) {
    const k = Math.floor((p.ms - fromMs) / bucket);
    if (k < 0 || k >= n || !Number.isFinite(p.v)) continue;
    sum[k] = (sum[k] ?? 0) + p.v; count[k] = (count[k] ?? 0) + 1;
  }
  return sum.map((s, k) => ((count[k] ?? 0) > 0 ? Math.round((s / (count[k] ?? 1)) * 10) / 10 : null));
}

/** Below this the sound reads as silence (astats gives -inf for digital silence). */
const FLOOR_DB = -90;

/** ffmpeg's stdout, collected — the readings are text lines, a few hundred KB at most. */
function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [], err: Buffer[] = [];
    p.stdout.on('data', (c: Buffer) => out.push(c));
    p.stderr.on('data', (c: Buffer) => err.push(c));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(Buffer.concat(err).toString('utf8').trim().split('\n').pop() || `ffmpeg exited ${String(code)}`))));
  });
}

/** Shot cuts and the activity curve of [fromMs, toMs) of a clip, on the file clock. */
export async function editPoints(file: string, fromMs: number, toMs: number, hasAudio: boolean, bin = 'ffmpeg'): Promise<EditPoints> {
  const bucket = bucketFor(fromMs, toMs);
  const [motionOut, loudOut] = await Promise.all([
    run(bin, motionArgs(file, fromMs, toMs)),
    hasAudio ? run(bin, loudArgs(file, fromMs, toMs, bucket)).catch(() => '') : Promise.resolve(''),
  ]);
  const scores = parseFrames(motionOut, fromMs, 'lavfi.scd.score');
  const { cuts, dropped } = shotCuts(scores.filter(s => s.ms > fromMs));
  // Movement WITHIN shots: the frame a cut lands on differs from the last by everything.
  const cutFrames = new Set(scores.filter(s => s.v >= SHOT_SCORE).map(s => s.ms));
  const mafd = parseFrames(motionOut, fromMs, 'lavfi.scd.mafd').filter(r => !cutFrames.has(r.ms));
  const motion = bucketMeans(mafd, fromMs, toMs, bucket).map(v => v ?? 0);
  const levels = parseFrames(loudOut, fromMs, 'lavfi.astats.Overall.RMS_level').map(r => ({ ms: r.ms, v: Number.isFinite(r.v) ? Math.max(FLOOR_DB, r.v) : FLOOR_DB }));
  const loud = hasAudio && levels.length ? bucketMeans(levels, fromMs, toMs, bucket) : motion.map(() => null);
  return { shots: cuts, activity: { bucket_ms: bucket, motion, loud_db: loud }, ...(dropped ? { shots_dropped: dropped } : {}) };
}
