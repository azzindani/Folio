/**
 * Video files as project assets — footage for a video layer.
 *
 * Stored as they arrive, never transcoded. What the engine needs to know about
 * a clip — how long it runs, its frame size and rate, whether it carries sound
 * — ffprobe reads from the container header, the same way it reads audio
 * (asset-audio.ts). A host without ffprobe still stores the file, unmeasured.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';

export const VIDEO_EXT_KIND = { mp4: 'video', m4v: 'video', mov: 'video', webm: 'video' } as const;

export const VIDEO_MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/x-m4v': 'm4v', 'video/quicktime': 'mov', 'video/webm': 'webm',
};

export const isVideoExt = (ext: string): boolean => Object.prototype.hasOwnProperty.call(VIDEO_EXT_KIND, ext.toLowerCase());

/** Footage is heavier than artwork: its own cap, default 64 MiB. */
export function maxVideoBytes(): number {
  return parseInt(process.env['FOLIO_MAX_VIDEO_BYTES'] ?? '', 10) || 64 * 1024 * 1024;
}

export interface VideoProbe { duration_ms: number; width: number; height: number; fps?: number; has_audio: boolean }

/** "30000/1001" → 29.97. */
function rate(r: string | undefined): number | undefined {
  const [n, d] = String(r ?? '').split('/').map(Number);
  const v = d ? (n ?? 0) / d : n;
  return v && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : undefined;
}

/**
 * Read a clip's length, frame size and rate. null = ffprobe is not installed;
 * 'not-video' = ffprobe ran and found no video stream (an audio file, a still).
 */
export function probeVideo(file: string, bin = 'ffprobe'): VideoProbe | 'not-video' | null {
  const r = spawnSync(bin, [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate', '-of', 'json', file,
  ], { encoding: 'utf8', timeout: 20_000 });
  if (r.error) return null;
  if (r.status !== 0 || !r.stdout) return 'not-video';
  try {
    const j = JSON.parse(r.stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number; avg_frame_rate?: string }>;
    };
    const video = j.streams?.find(s => s.codec_type === 'video' && (s.width ?? 0) > 0);
    const seconds = Number(j.format?.duration);
    if (!video || !Number.isFinite(seconds) || seconds <= 0) return 'not-video';
    const fps = rate(video.avg_frame_rate);
    // A single-frame "video" (an image in a video container) has no motion to play.
    if (fps !== undefined && seconds * fps < 2) return 'not-video';
    return {
      duration_ms: Math.round(seconds * 1000), width: video.width ?? 0, height: video.height ?? 0,
      ...(fps ? { fps } : {}),
      has_audio: (j.streams ?? []).some(s => s.codec_type === 'audio'),
    };
  } catch {
    return 'not-video';
  }
}

/** Probe bytes that are not on disk yet — ffprobe needs a seekable file (an mp4 may keep its index at the end). */
export function probeVideoBytes(buf: Buffer, ext: string, bin = 'ffprobe'): VideoProbe | 'not-video' | null {
  const tmp = path.join(os.tmpdir(), `folio-probe-${randomBytes(6).toString('hex')}.${ext}`);
  try {
    fs.writeFileSync(tmp, buf);
    return probeVideo(tmp, bin);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
