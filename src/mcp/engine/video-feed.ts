// Footage for a raster export: one ClipStream per video layer, asked for each
// frame's moment BEFORE that frame's SVG is built, so the render finds the frame
// in video-frame.ts's cache instead of blocking the server on an ffmpeg seek.

import type { DesignSpec, Layer } from '../../schema/types';
import { ClipStream } from './video-stream';
import { frameRequest, primeVideoFrame, type FrameRequest } from './video-frame';
import { frameEdge, jpegFormat, rgbaFormat, type DecodeFormat } from './video-decode';
import type { FootageSlot } from './footage-bands';

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
    const key = `${slot.req.id}|${slot.req.file}|${w}x${h}|${slot.fit}|${slot.focal?.join(',') ?? ''}`;
    return this.stream(key, slot.req.file, () => rgbaFormat(w, h, slot.fit, slot.focal)).frameAt(slot.req.ms);
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
