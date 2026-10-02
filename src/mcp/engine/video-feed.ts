// Footage for a raster export: one ClipStream per video layer, asked for each
// frame's moment BEFORE that frame's SVG is built, so the render finds the frame
// in video-frame.ts's cache instead of blocking the server on an ffmpeg seek.

import type { DesignSpec, Layer } from '../../schema/types';
import { ClipStream } from './video-stream';
import { frameRequest, primeVideoFrame, type FrameRequest } from './video-frame';
import { frameEdge } from './video-decode';

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

  /** Decode every clip's frame for this frame of the export. A clip that gives none is left to the render's own fallback. */
  async prepare(spec: DesignSpec): Promise<void> {
    const reqs = frameRequests(spec);
    if (!reqs.length) return;
    await Promise.all(reqs.map(async r => {
      const edge = frameEdge(r.w, r.h);
      const key = `${r.id}|${r.file}|${edge}`;
      let stream = this.streams.get(key);
      if (!stream) {
        stream = new ClipStream(r.file, edge, this.bin);
        this.streams.set(key, stream);
      }
      const jpeg = await stream.frameAt(r.ms);
      if (jpeg) primeVideoFrame(r.file, r.ms, r.w, r.h, jpeg);
    }));
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
