// Where a clip's sound stops — the dead air a cut removes.
//
// No speech-to-text: ffmpeg's silencedetect finds the spans quieter than a level
// for longer than a minimum, on the file's own clock (the clock op:video's
// offset_ms / duration_ms and its cut spans use). The model decides what to cut;
// this only measures.

import { spawn } from 'child_process';

export type Span = [number, number];

/** Quieter than this many dB below full scale counts as silence. */
export const SILENCE_DB = -35;
/** Shorter pauses are speech rhythm, not dead air. */
export const SILENCE_MIN_MS = 400;

export function silenceArgs(file: string, fromMs: number, toMs: number, db = SILENCE_DB, minMs = SILENCE_MIN_MS): string[] {
  return [
    '-hide_banner', '-nostats', '-v', 'info', '-ss', (fromMs / 1000).toFixed(3), '-t', (Math.max(1, toMs - fromMs) / 1000).toFixed(3),
    '-i', file, '-vn', '-sn', '-dn', '-af', `silencedetect=n=${db}dB:d=${(minMs / 1000).toFixed(3)}`, '-f', 'null', '-',
  ];
}

/** Silent spans from silencedetect's log, on the file clock; one still open at the end closes at `toMs`. */
export function parseSilence(log: string, fromMs: number, toMs: number): Span[] {
  const spans: Span[] = [];
  let open: number | null = null;
  for (const m of log.matchAll(/silence_(start|end):\s*(-?[0-9.]+)/g)) {
    const ms = Math.round(fromMs + Number(m[2]) * 1000);
    if (m[1] === 'start') open = Math.max(fromMs, ms);
    else if (open !== null) { spans.push([open, Math.min(toMs, ms)]); open = null; }
  }
  if (open !== null && open < toMs) spans.push([open, toMs]);
  return spans.filter(([a, b]) => b > a);
}

/** The silent spans of [fromMs, toMs) of a file's sound. */
export function detectSilence(file: string, fromMs: number, toMs: number, bin = 'ffmpeg', db = SILENCE_DB, minMs = SILENCE_MIN_MS): Promise<Span[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, silenceArgs(file, fromMs, toMs, db, minMs), { stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    p.stderr.on('data', (c: Buffer) => { log += c.toString(); });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(parseSilence(log, fromMs, toMs)) : reject(new Error(log.trim().split('\n').slice(-1)[0] ?? `ffmpeg exited ${String(code)}`))));
  });
}
