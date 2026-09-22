// Which moment of a clip a video layer shows at scene time t.
//
// Pure and browser-safe: the flipbook (gif-frames layersAt) stamps it on every
// posed video layer, so an export frame, op:frame and the editor's scrub all
// ask the file for the same moment. The clip starts at the layer's `in` point
// (0 without one): before it the first frame shows, `speed` scales time,
// `duration_ms` ends the used part (held on its last frame, or repeated when
// `loop`), and `offset_ms` is where in the file the used part begins.

export interface VideoTiming { offset_ms?: number; duration_ms?: number; speed?: number; loop?: boolean }

export function videoSourceMs(t: number, inMs: number | undefined, v: VideoTiming | undefined): number {
  const offset = Math.max(0, Number(v?.offset_ms) || 0);
  const speed = Number(v?.speed) > 0 ? Number(v?.speed) : 1;
  const used = Number(v?.duration_ms) > 0 ? Number(v?.duration_ms) : Infinity;
  let pos = Math.max(0, t - (Number(inMs) || 0)) * speed;
  if (pos >= used) pos = v?.loop ? pos % used : used - 1;
  return Math.round(offset + Math.max(0, pos));
}
