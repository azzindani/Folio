// Pure helpers shared by the two ways a clip's picture is pulled out of its file:
// one moment at a time (video-frame.ts, a preview) and as a stream (video-stream.ts,
// an export). Both ask ffmpeg for MJPEG frames with `showinfo` timestamps and pick
// with ONE rule, so op:frame and the exported video show the same frame.

/** Frames a stream keeps ahead of its reader before ffmpeg is paused. */
export const STREAM_AHEAD = 24;
/** How far before a moment decoding starts, so the frame already showing at it is decoded too. */
export const SEEK_LEAD_MS = 250;
/** Timestamp slack: a frame at 33.3333 ms counts as showing at 33.333 ms. */
const EPS_MS = 0.5;

/**
 * The frame showing at `ms`: the latest one that starts at or before it, as a
 * player shows it. Before the first frame, the first. -1 when there is none.
 */
export function pickFrame(startsMs: readonly number[], ms: number): number {
  if (startsMs.length === 0) return -1;
  let best = 0;
  for (let i = 0; i < startsMs.length; i++) {
    if (showsAt(startsMs[i] ?? Infinity, ms)) best = i; else break;
  }
  return best;
}

/** Whether a frame starting at `startMs` has begun showing by `ms`. */
export function showsAt(startMs: number, ms: number): boolean {
  return startMs <= ms + EPS_MS;
}

/** Each `pts_time` a showinfo filter logged in `text`, in seconds, in order. */
export function showinfoTimes(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:(-?[0-9.]+(?:e-?\d+)?)/g)) {
    const s = Number(m[1]);
    if (Number.isFinite(s)) out.push(s);
  }
  return out;
}

/**
 * Where the JPEG starting at `start` ends (the index after its EOI), or -1 when
 * `buf` does not hold all of it yet. Walks the marker segments, then the scan
 * data — a bare FFD9 search is wrong because a quantisation table can hold it.
 */
export function jpegEnd(buf: Buffer, start = 0): number {
  if (buf.length < start + 4 || buf[start] !== 0xFF || buf[start + 1] !== 0xD8) return -1;
  let i = start + 2;
  while (i + 2 <= buf.length) {
    if (buf[i] !== 0xFF) return -1;
    const marker = buf[i + 1] ?? 0;
    if (marker === 0xD9) return i + 2;
    if (marker === 0xFF) { i++; continue; }
    if (i + 4 > buf.length) return -1;
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
    if (marker !== 0xDA) continue;
    // Entropy-coded data: FF00 is a stuffed byte, FFD0–FFD7 a restart; any other FFxx ends the scan.
    while (i + 1 < buf.length) {
      if (buf[i] === 0xFF) {
        const next = buf[i + 1] ?? 0;
        if (next !== 0x00 && (next < 0xD0 || next > 0xD7)) break;
        i += 2;
      } else i++;
    }
  }
  return -1;
}

/** Every complete JPEG at the front of `buf`, and what is left over. */
export function splitJpegs(buf: Buffer): { frames: Buffer[]; rest: Buffer } {
  const frames: Buffer[] = [];
  let at = 0;
  for (;;) {
    const end = jpegEnd(buf, at);
    if (end < 0) break;
    frames.push(buf.subarray(at, end));
    at = end;
  }
  return { frames, rest: at ? buf.subarray(at) : buf };
}

/** Longest edge a frame is decoded at: the layer's box ×1.5, never past full HD. */
export function frameEdge(boxW: number, boxH: number): number {
  return Math.max(16, Math.min(1920, Math.round(Math.max(boxW, boxH) * 1.5)));
}

/**
 * ffmpeg arguments: MJPEG frames from `seekMs` on, each logged by showinfo, one per
 * decoded frame. A limit is a `trim` BEFORE showinfo: an output-side -t/-frames
 * lets the graph log frames it then drops, and the log would no longer pair up.
 */
export function decodeArgs(file: string, seekMs: number, edge: number, limit?: { frames?: number; ms?: number }): string[] {
  const trim = limit?.frames ? `trim=end_frame=${limit.frames},` : limit?.ms ? `trim=duration=${(limit.ms / 1000).toFixed(3)},` : '';
  return [
    '-hide_banner', '-nostats', '-v', 'info',
    '-ss', (Math.max(0, seekMs) / 1000).toFixed(3), '-i', file, '-an', '-sn', '-dn',
    '-vf', `${trim}showinfo,scale=w=${edge}:h=${edge}:force_original_aspect_ratio=decrease`,
    '-fps_mode', 'passthrough', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', 'pipe:1',
  ];
}
