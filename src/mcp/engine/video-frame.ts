// The frame of a clip a server render draws for a video layer.
//
// resvg cannot play a video, so before a design is rendered on the server each
// video layer gets the picture its file shows at that moment: `_video_file`
// (resolved by asset-resolve.ts) at `_video_ms` (stamped by the flipbook, or
// the clip's first used frame for a still render), as a JPEG data: URI in
// `_video_frame`. The renderer then draws it exactly like an image layer, so
// fit, crop, mask, focal, overlay and frame all apply to footage for free.
//
// A preview decodes one moment here (cached — a held frame or a repeated render
// costs nothing). An export primes the same cache from one stream per clip
// (video-feed.ts), so this never blocks it. Both pick the frame with pickFrame.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import { decodeArgs, cropDecodeArgs, fitFilter, frameEdge, pickFrame, showinfoTimes, splitJpegs, SEEK_LEAD_MS } from './video-decode';
import { cropAt, hasCrop, type ClipCrop } from '../../animation/clip-crop';
import { colorOf, colorFilter } from '../../animation/clip-color';
import type { ClipFit } from './video-decode';
import { videoFit } from '../../renderer/layer-renderers-video';

/** How a cut grab looks: the crop inside the footage, the fit, and the grade (ffmpeg filters). */
export interface FrameLook { crop?: ClipCrop | null; fit?: ClipFit; grade?: string | null }
/** A grab already fitted to its box (capped at 1920 px), cropped and graded by ffmpeg. */
interface Cut { w: number; h: number; crop: ClipCrop | null; fit: ClipFit; grade: string | null }
const cutOf = (boxW: number, boxH: number, look: FrameLook): Cut => {
  const k = Math.min(1, 1920 / Math.max(boxW, boxH, 1));
  return { w: Math.max(2, Math.round(boxW * k)), h: Math.max(2, Math.round(boxH * k)), crop: look.crop ?? null, fit: look.fit ?? 'cover', grade: look.grade ?? null };
};
const cutKey = (c: Cut | null): string =>
  (c ? `|${c.w}x${c.h}|${c.fit}|${c.crop ? `${c.crop.focus.map(v => v.toFixed(4)).join(',')}|${c.crop.zoom.toFixed(4)}` : ''}|${c.grade ?? ''}` : '');

const cache = new Map<string, string | null>();
const MAX_CACHED = 240;

function grab(file: string, ms: number, edge: number, bin: string, cut: Cut | null = null): Buffer | null {
  const seekMs = Math.max(0, ms - SEEK_LEAD_MS);
  const limit = { ms: ms - seekMs + 100 };
  const args = cut ? cropDecodeArgs(file, seekMs, cut.w, cut.h, cut.crop, limit, cut.fit, cut.grade) : decodeArgs(file, seekMs, edge, limit);
  const r = spawnSync(bin, args, { timeout: 20_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0 || !r.stdout?.length) return null;
  const { frames } = splitJpegs(r.stdout);
  const starts = showinfoTimes(r.stderr.toString()).slice(0, frames.length).map(s => seekMs + s * 1000);
  return frames[pickFrame(starts, ms)] ?? null;
}

/** The file's last frame — what a moment past its end shows. */
function grabLast(file: string, edge: number, bin: string, cut: Cut | null = null): Buffer | null {
  const r = spawnSync(bin, ['-v', 'error', '-sseof', '-0.25', '-i', file, '-frames:v', '1',
    '-vf', cut ? fitFilter(cut.w, cut.h, cut.fit, cut.crop, cut.grade) : `scale=w=${edge}:h=${edge}:force_original_aspect_ratio=decrease`,
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', 'pipe:1'], { timeout: 20_000, maxBuffer: 32 * 1024 * 1024 });
  return !r.error && r.status === 0 && r.stdout && r.stdout.length > 0 ? r.stdout : null;
}

function keyFor(file: string, ms: number, edge: number): string | null {
  try { return `${file}|${fs.statSync(file).mtimeMs}|${Math.round(ms)}|${edge}`; } catch { return null; }
}

function remember(key: string, jpeg: Buffer | null): string | null {
  const uri = jpeg ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : null;
  cache.set(key, uri);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value ?? key);
  return uri;
}

/** The clip's picture at `ms`, as a data: URI. A moment past the end shows the
 *  last frame; null when the file cannot be read (or ffmpeg is missing). */
export function videoFrameUri(file: string, ms: number, boxW: number, boxH: number, bin = 'ffmpeg', look: FrameLook | null = null): string | null {
  const edge = frameEdge(boxW, boxH);
  // A cropped or graded clip's frame comes cut to its box by ffmpeg: the renderer draws it unscaled.
  const cut = look && (look.crop || look.grade) ? cutOf(boxW, boxH, look) : null;
  const base = keyFor(file, ms, edge);
  if (!base) return null;
  const key = base + cutKey(cut);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  return remember(key, grab(file, ms, edge, bin, cut) ?? (ms > 0 ? grabLast(file, edge, bin, cut) : null));
}

/** Store a frame decoded elsewhere (an export's stream) where videoFrameUri finds it. */
export function primeVideoFrame(file: string, ms: number, boxW: number, boxH: number, jpeg: Buffer): void {
  const key = keyFor(file, ms, frameEdge(boxW, boxH));
  if (key) remember(key, jpeg);
}

type VideoNode = Layer & { _video_file?: string; _video_ms?: number; _video_frame?: string; _video_cut?: boolean; video?: { offset_ms?: number } };

/** What a video layer needs drawn: its file, the moment and its box. Null without a stored file. */
export interface FrameRequest { id: string; file: string; ms: number; w: number; h: number; crop?: ClipCrop; grade?: string; fit?: ClipFit }

export function frameRequest(l: Layer): FrameRequest | null {
  const v = l as VideoNode;
  if (l.type !== 'video' || !v._video_file) return null;
  const ms = typeof v._video_ms === 'number' ? v._video_ms : Math.max(0, Number(v.video?.offset_ms) || 0);
  const w = typeof l.width === 'number' ? l.width : 640, h = typeof l.height === 'number' ? l.height : 360;
  // Only a covering clip pans: contain and fill show the whole frame.
  const fit = videoFit((l as Layer & { fit?: unknown }).fit);
  const crop = fit === 'cover' && hasCrop(l) ? cropAt(l, ms) : undefined;
  // A clip drawn at its own size (fit none) is never cut: the renderer places it.
  const color = fit === 'none' ? null : colorOf(l);
  const grade = color && fit !== 'none' ? { grade: colorFilter(color, (l as Layer & { _video_lut?: string })._video_lut), fit } : null;
  return { id: l.id, file: v._video_file, ms, w, h, ...(crop ? { crop } : {}), ...(grade ?? {}) };
}

function hasVideo(layers: Layer[] | undefined): boolean {
  return (layers ?? []).some(l => l.type === 'video' || hasVideo((l as { layers?: Layer[] }).layers));
}

function withFrames(layers: Layer[]): Layer[] {
  return layers.map(l => {
    const kids = (l as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) return { ...l, layers: withFrames(kids) } as Layer;
    if (l.type !== 'video') return l;
    // No stored file (asset-resolve left a note): an empty frame draws the
    // image placeholder, where a <video> would draw nothing at all in resvg.
    const req = frameRequest(l);
    const look: FrameLook | null = req && (req.crop || req.grade) ? { crop: req.crop ?? null, grade: req.grade ?? null, fit: req.fit ?? 'cover' } : null;
    const frame = req ? videoFrameUri(req.file, req.ms, req.w, req.h, 'ffmpeg', look) : null;
    return { ...l, _video_frame: frame ?? '', ...(look && frame ? { _video_cut: true } : {}) } as Layer;
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
