/**
 * A sound file's beat map, measured once per version of the file.
 *
 * ffmpeg decodes to mono 11 025 Hz float PCM — rhythm lives well under 5 kHz,
 * and it is a quarter of 44.1 kHz's samples — and beat-detect.ts does the math.
 * Maps are cached by path, size and mtime, so a soundtrack is analysed the
 * first time someone asks about it, not on every call.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import { detectBeats, type BeatMap } from '../../export/beat-detect';

const RATE = 11_025;
/** Ten minutes of float PCM at this rate is ~26 MB; a soundtrack for a ≤60 s video is far less. */
const MAX_SECONDS = 600;
const DECODE_TIMEOUT_MS = 60_000;
const KEEP = 16;
const cache = new Map<string, BeatMap>();

function decodeMono(file: string, bin: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-i', file, '-t', String(MAX_SECONDS), '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), DECODE_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => { chunks.push(d); });
    child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-1000); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`ffmpeg could not decode the file (exit ${String(code)})${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
        return;
      }
      const all = Buffer.concat(chunks);
      const out = new Float32Array(Math.floor(all.byteLength / 4));
      for (let i = 0; i < out.length; i++) out[i] = all.readFloatLE(i * 4);
      resolve(out);
    });
  });
}

/** Tempo, beats and onsets of a file on disk, ms from the start of the file. */
export async function analyzeAudioFile(file: string, bin = 'ffmpeg'): Promise<BeatMap> {
  const st = fs.statSync(file);
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const map = detectBeats(await decodeMono(file, bin), RATE);
  cache.set(key, map);
  for (const old of cache.keys()) {
    if (cache.size <= KEEP) break;
    cache.delete(old);
  }
  return map;
}
