/**
 * The longest raster clip each format renders — shared by the MCP export and
 * the editor's scene length field, so neither lets through what the other
 * refuses. A bound on CPU time, not memory: frames stream to the encoder, and
 * a clip past ~150 frames renders as a background job. A GIF is a feed
 * flipbook of full palette frames, so it stops sooner than a video. Found
 * live: a flat 60 s cap left a 61.5 s promo with no way out as a video.
 */
export const MAX_CLIP_MS = { gif: 120_000, video: 600_000 } as const;

/** The longest clip `type` (gif | mp4 | webm) renders, ms. */
export function maxClipMs(type: string): number {
  return type === 'gif' ? MAX_CLIP_MS.gif : MAX_CLIP_MS.video;
}

/** A limit as a reader says it: "2 min", "10 min", "45s". */
export function clipLimitText(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000} min` : `${ms / 1000}s`;
}
