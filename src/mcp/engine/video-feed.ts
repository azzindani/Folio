// Footage for a raster export: one ClipStream per video layer, asked for each
// frame's moment BEFORE that frame's SVG is built, so the render finds the frame
// in video-frame.ts's cache instead of blocking the server on an ffmpeg seek.

import type { DesignSpec, Layer } from '../../schema/types';
import { ClipStream } from './video-stream';
import { frameRequest, primeVideoFrame, type FrameRequest } from './video-frame';
import { frameEdge, jpegFormat, rgbaFormat, type DecodeFormat } from './video-decode';
import type { FootageSlot } from './footage-bands';
import { probeVideo } from './asset-video';
import { cropWindow, resampleRegion } from '../../export/footage-crop';

function collect(layers: Layer[] | undefined, out: FrameRequest[]): void {
  for (const l of layers ?? []) {
    const req = frameRequest(l);
    if (req) out.push(req);
    collect((l as { layers?: Layer[] }).layers, out);
  }
}

/** Every video layer a frame draws, with its file, moment and box. */
export function frameRequests(spec: DesignSpec): FrameRequest[] {
  const out: FrameRequest[] = [];
  collect(spec.layers, out);
  for (const p of spec.pages ?? []) collect(p.layers, out);
  return out;
}

export class FootageFeed {
  private readonly streams = new Map<string, ClipStream>();
  private readonly sizes = new Map<string, { width: number; height: number } | null>();

  constructor(private readonly bin = 'ffmpeg') {}

  /** Decode every clip's frame for this frame of the export; how many clips it draws. A clip that gives none is left to the render's own fallback. */
  async prepare(spec: DesignSpec): Promise<number> {
    const reqs = frameRequests(spec);
    if (!reqs.length) return 0;
    await Promise.all(reqs.map(async r => {
      const edge = frameEdge(r.w, r.h);
      const jpeg = await this.stream(`${r.id}|${r.file}|${edge}`, r.file, () => jpegFormat(edge)).frameAt(r.ms);
      if (jpeg) primeVideoFrame(r.file, r.ms, r.w, r.h, jpeg);
    }));
    return reqs.length;
  }

  /** A plain clip's picture for this frame: straight-alpha RGBA of exactly w×h, fitted as its <image> would draw. */
  pixelsAt(slot: FootageSlot, w: number, h: number): Promise<Buffer | null> {
    if (slot.panned && slot.fit === 'cover') return this.pannedAt(slot, w, h);
    const c = slot.crop;
    const key = `${slot.req.id}|${slot.req.file}|${w}x${h}|${slot.fit}|${c.focus.map(v => v.toFixed(4)).join(',')}|${c.zoom.toFixed(4)}`;
    return this.stream(key, slot.req.file, () => rgbaFormat(w, h, slot.fit, c)).frameAt(slot.req.ms);
  }

  /**
   * A moving crop: the stream decodes the footage whole, large enough for the clip's
   * closest zoom but never past the file's own size, and each frame takes its window
   * (footage-crop.ts) — one decoder for the whole move instead of one per crop.
   */
  private async pannedAt(slot: FootageSlot, w: number, h: number): Promise<Buffer | null> {
    const file = this.sizeOf(slot.req.file);
    if (!file) return null;
    const cover = Math.max(w / file.width, h / file.height);
    const scale = Math.min(cover * slot.zoomMax, Math.max(cover, 1));
    const dw = Math.max(2, Math.round((file.width * scale) / 2) * 2), dh = Math.max(2, Math.round((file.height * scale) / 2) * 2);
    const key = `${slot.req.id}|${slot.req.file}|pan|${dw}x${dh}`;
    const frame = await this.stream(key, slot.req.file, () => rgbaFormat(dw, dh, 'fill', null)).frameAt(slot.req.ms);
    if (!frame) return null;
    const win = cropWindow(file.width, file.height, w, h, slot.crop.focus, slot.crop.zoom, dw / file.width);
    return resampleRegion(frame, dw, dh, win.rx, win.ry, win.rw, win.rh, w, h);
  }

  /** The file's frame size, probed once per export. */
  private sizeOf(file: string): { width: number; height: number } | null {
    if (!this.sizes.has(file)) {
      const p = probeVideo(file);
      this.sizes.set(file, p && p !== 'not-video' && p.width > 0 && p.height > 0 ? { width: p.width, height: p.height } : null);
    }
    return this.sizes.get(file) ?? null;
  }

  private stream(key: string, file: string, format: () => DecodeFormat): ClipStream {
    let stream = this.streams.get(key);
    if (!stream) {
      stream = new ClipStream(file, format(), this.bin);
      this.streams.set(key, stream);
    }
    return stream;
  }

  /** Clips decoded, and decoders started across them (a seek each). */
  stats(): { clips: number; seeks: number } {
    let seeks = 0;
    for (const s of this.streams.values()) seeks += s.starts;
    return { clips: this.streams.size, seeks };
  }

  close(): void {
    for (const s of this.streams.values()) s.close();
    this.streams.clear();
  }
}
