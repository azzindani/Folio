/**
 * Audio files as project assets — the soundtrack and sound cues of a video.
 *
 * The bytes are stored as they arrive, never transcoded. What the engine needs
 * to know about a file is how long it plays, and ffprobe (installed beside the
 * ffmpeg the video export already needs) reads that from the container header.
 * A host without ffprobe still stores the file, just without a duration.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';

export const AUDIO_EXT_KIND = {
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio', flac: 'audio',
} as const;

export const AUDIO_MIME_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
  'audio/flac': 'flac', 'audio/x-flac': 'flac',
};

export const isAudioExt = (ext: string): boolean => Object.prototype.hasOwnProperty.call(AUDIO_EXT_KIND, ext.toLowerCase());

export interface AudioProbe { duration_ms: number; channels?: number; sample_rate?: number }

/**
 * Read a file's length and layout. null = ffprobe is not installed (nothing is
 * known); 'not-audio' = ffprobe ran and found no audio stream in it.
 */
export function probeAudio(file: string, bin = 'ffprobe'): AudioProbe | 'not-audio' | null {
  const r = spawnSync(bin, [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'format=duration:stream=channels,sample_rate', '-of', 'json', file,
  ], { encoding: 'utf8', timeout: 15_000 });
  if (r.error) return null;
  if (r.status !== 0 || !r.stdout) return 'not-audio';
  try {
    const j = JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: Array<{ channels?: number; sample_rate?: string }> };
    const stream = j.streams?.[0];
    const seconds = Number(j.format?.duration);
    if (!stream || !Number.isFinite(seconds) || seconds <= 0) return 'not-audio';
    const rate = Number(stream.sample_rate);
    return {
      duration_ms: Math.round(seconds * 1000),
      ...(stream.channels ? { channels: stream.channels } : {}),
      ...(rate > 0 ? { sample_rate: rate } : {}),
    };
  } catch {
    return 'not-audio';
  }
}

/** Probe bytes that are not on disk yet — ffprobe needs a seekable file (an m4a keeps its index at the end). */
export function probeAudioBytes(buf: Buffer, ext: string, bin = 'ffprobe'): AudioProbe | 'not-audio' | null {
  const tmp = path.join(os.tmpdir(), `folio-probe-${randomBytes(6).toString('hex')}.${ext}`);
  try {
    fs.writeFileSync(tmp, buf);
    return probeAudio(tmp, bin);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
