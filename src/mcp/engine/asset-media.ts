/**
 * Time-based assets — sound and footage — as the asset store sees them.
 *
 * Both are stored untouched and measured with ffprobe (asset-audio.ts,
 * asset-video.ts); neither is placed like an image. This is the part of adding
 * an asset that depends on that: the size cap, the probe that refuses a
 * mislabelled file before it can replace a good one, and the next step to hand
 * back. Split out of assets.ts, which sits at its line budget (§0.3).
 */

import type { NextAction } from '../types';
import { probeAudioBytes } from './asset-audio';
import { maxVideoBytes, probeVideoBytes } from './asset-video';

export interface MediaMeta { duration_ms: number; width?: number; height?: number; fps?: number; has_audio?: boolean }

/** The byte cap for a kind of asset, and what to say when a file is over it. */
export function assetCap(kind: string, artworkBytes: number): { bytes: number; hint: string } {
  return kind === 'video'
    ? { bytes: maxVideoBytes(), hint: 'Trim or re-encode the clip (a short H.264 mp4), or raise FOLIO_MAX_VIDEO_BYTES.' }
    : { bytes: artworkBytes, hint: 'Downscale/compress the image, or raise FOLIO_MAX_ASSET_BYTES.' };
}

/**
 * Measure a sound or a clip. null = not a time-based kind, or ffprobe is not
 * installed (stored unmeasured); `error` = the bytes are not what the name says.
 */
export function probeMedia(kind: string, buf: Buffer, ext: string): { meta: MediaMeta } | { error: string; hint: string } | null {
  if (kind === 'audio') {
    const p = probeAudioBytes(buf, ext);
    if (p === 'not-audio') return { error: 'has no audio stream', hint: 'Store an mp3, wav, m4a, aac, ogg, opus or flac file.' };
    return p ? { meta: { duration_ms: p.duration_ms } } : null;
  }
  if (kind === 'video') {
    const p = probeVideoBytes(buf, ext);
    if (p === 'not-video') return { error: 'has no video stream', hint: 'Store an mp4, m4v, mov or webm clip — a still belongs under images.' };
    return p ? { meta: p } : null;
  }
  return null;
}

interface MediaEntry { kind: string; path: string; id: string; duration_ms?: number; width?: number; height?: number }

/** The next step for a stored sound or clip — neither is an image layer. */
export function mediaNextAction(e: MediaEntry): NextAction | null {
  const secs = typeof e.duration_ms === 'number' ? ` (${(e.duration_ms / 1000).toFixed(1)} s)` : '';
  if (e.kind === 'audio') {
    return {
      tool: 'animation', params: { op: 'audio', design_path: '<your .design.yaml>', src: e.path }, remaining: 0,
      hint: `Sound stored${secs}. Put it under the whole piece with animation(op:audio, src:"${e.path}"), or start it with a scene by adding page_id.`,
    };
  }
  if (e.kind === 'video') {
    const w = e.width ?? 1280, h = e.height ?? 720;
    const k = Math.min(1, 960 / Math.max(w, h));
    const stub = { id: e.id, type: 'video', z: 21, pos: [120, 120, Math.round(w * k), Math.round(h * k)], src: e.path, fit: 'cover' };
    return {
      tool: 'add_layers', params: { design_path: '<your .design.yaml>', layers_shorthand: [stub] }, remaining: 0,
      hint: `Clip stored${secs}. Place it as a video layer — it plays from its in point; video:{offset_ms, duration_ms, speed, volume, muted, loop} trims and times it.`,
    };
  }
  return null;
}
