// The frame of a clip a server render draws for a video layer.
//
// resvg cannot play a video, so before a design is rendered on the server each
// video layer gets the picture its file shows at that moment: `_video_file`
// (resolved by asset-resolve.ts) at `_video_ms` (stamped by the flipbook, or
// the clip's first used frame for a still render), as a JPEG data: URI in
// `_video_frame`. The renderer then draws it exactly like an image layer, so
// fit, crop, mask, focal, overlay and frame all apply to footage for free.
//
// One ffmpeg call per distinct moment, cached — a held frame or a repeated
// render costs nothing.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';

const cache = new Map<string, string | null>();
const MAX_CACHED = 240;
/** Longest edge of an extracted frame: the layer's box ×1.5, never past full HD. */
const MAX_EDGE = 1920;

function grab(file: string, ms: number, edge: number, bin: string, fromEnd: boolean): Buffer | null {
  const seek = fromEnd ? ['-sseof', '-0.25'] : ['-ss', (ms / 1000).toFixed(3)];
  const r = spawnSync(bin, [
    '-v', 'error', ...seek, '-i', file, '-frames:v', '1',
    '-vf', `scale=w=${edge}:h=${edge}:force_original_aspect_ratio=decrease`,
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', 'pipe:1',
  ], { timeout: 20_000, maxBuffer: 32 * 1024 * 1024 });
  return !r.error && r.status === 0 && r.stdout && r.stdout.length > 0 ? r.stdout : null;
}

/** The clip's picture at `ms`, as a data: URI. A moment past the end shows the
 *  last frame; null when the file cannot be read (or ffmpeg is missing). */
export function videoFrameUri(file: string, ms: number, boxW: number, boxH: number, bin = 'ffmpeg'): string | null {
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
  const edge = Math.max(16, Math.min(MAX_EDGE, Math.round(Math.max(boxW, boxH) * 1.5)));
  const key = `${file}|${mtime}|${Math.round(ms)}|${edge}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const jpeg = grab(file, ms, edge, bin, false) ?? (ms > 0 ? grab(file, ms, edge, bin, true) : null);
  const uri = jpeg ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : null;
  cache.set(key, uri);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value ?? key);
  return uri;
}

type VideoNode = Layer & { _video_file?: string; _video_ms?: number; _video_frame?: string; video?: { offset_ms?: number } };

function hasVideo(layers: Layer[] | undefined): boolean {
  return (layers ?? []).some(l => l.type === 'video' || hasVideo((l as { layers?: Layer[] }).layers));
}

function withFrames(layers: Layer[]): Layer[] {
  return layers.map(l => {
    const kids = (l as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) return { ...l, layers: withFrames(kids) } as Layer;
    const v = l as VideoNode;
    if (l.type !== 'video') return l;
    // No stored file (asset-resolve left a note): an empty frame draws the
    // image placeholder, where a <video> would draw nothing at all in resvg.
    if (!v._video_file) return { ...l, _video_frame: '' } as Layer;
    const ms = typeof v._video_ms === 'number' ? v._video_ms : Math.max(0, Number(v.video?.offset_ms) || 0);
    const w = typeof l.width === 'number' ? l.width : 640, h = typeof l.height === 'number' ? l.height : 360;
    const frame = videoFrameUri(v._video_file, ms, w, h);
    return { ...l, _video_frame: frame ?? '' } as Layer;
  });
}

/** The spec with every video layer's frame attached ('' when there is none to
 *  draw). The input is not changed; a spec without video comes back as is. */
export function withVideoFrames(spec: DesignSpec): DesignSpec {
  if (!hasVideo(spec.layers) && !(spec.pages ?? []).some(p => hasVideo(p.layers))) return spec;
  return {
    ...spec,
    ...(spec.layers ? { layers: withFrames(spec.layers) } : {}),
    ...(spec.pages ? { pages: spec.pages.map(p => ({ ...p, layers: withFrames(p.layers ?? []) })) } : {}),
  };
}
