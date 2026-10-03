// Which moment of a clip a video layer shows at scene time t.
//
// Pure and browser-safe: the flipbook (gif-frames layersAt) stamps it on every
// posed video layer, so an export frame, op:frame and the editor's scrub all
// ask the file for the same moment. The clip starts at the layer's `in` point
// (0 without one): before it the first frame shows, `speed` scales time,
// `duration_ms` ends the used part (held on its last frame, or repeated when
// `loop`), and `offset_ms` is where in the file the used part begins.

export interface VideoTiming {
  offset_ms?: number; duration_ms?: number; speed?: number; loop?: boolean;
  /** A freeze: the frame at offset_ms held for duration_ms of scene time (silent). */
  still?: boolean;
  /** A speed ramp: speed keys on the clip's own clock (ms since its in point), linear between, held outside. */
  ramp?: Array<{ at_ms: number; speed: number }>;
}

/** Fastest and slowest a ramp may run. */
export const MIN_SPEED = 0.1, MAX_SPEED = 8;
const clampSpeed = (v: number): number => Math.max(MIN_SPEED, Math.min(MAX_SPEED, v));

/** The ramp's keys, valid and in order; [] for a clip at one speed. */
export function rampKeys(v: VideoTiming | undefined): Array<{ at_ms: number; speed: number }> {
  if (!Array.isArray(v?.ramp)) return [];
  return v.ramp.filter(k => Number.isFinite(k?.at_ms) && Number.isFinite(k?.speed) && k.at_ms >= 0).map(k => ({ at_ms: k.at_ms, speed: clampSpeed(k.speed) })).sort((a, b) => a.at_ms - b.at_ms);
}

/** The clip's speed `local` ms after its in point. */
export function speedAt(v: VideoTiming | undefined, local: number): number {
  if (v?.still) return 0;
  const keys = rampKeys(v);
  if (!keys.length) return Number(v?.speed) > 0 ? Number(v?.speed) : 1;
  const i = keys.findIndex(k => k.at_ms > local);
  if (i === 0) return (keys[0] as { speed: number }).speed;
  if (i < 0) return (keys[keys.length - 1] as { speed: number }).speed;
  const a = keys[i - 1] as { at_ms: number; speed: number }, b = keys[i] as { at_ms: number; speed: number };
  return a.speed + ((b.speed - a.speed) * (local - a.at_ms)) / Math.max(1, b.at_ms - a.at_ms);
}

/** How far into its used part the clip has played `local` ms after its in point (file ms past offset_ms, before loop or end). */
export function fileOffsetAt(v: VideoTiming | undefined, local: number): number {
  const t = Math.max(0, local);
  if (v?.still) return 0;
  const keys = rampKeys(v);
  if (!keys.length) return t * (Number(v?.speed) > 0 ? Number(v?.speed) : 1);
  // The area under the speed curve: trapezoids between keys, rectangles before the first and after the last.
  const pts = [{ at: 0, s: speedAt(v, 0) }, ...keys.filter(k => k.at_ms > 0 && k.at_ms < t).map(k => ({ at: k.at_ms, s: k.speed })), { at: t, s: speedAt(v, t) }];
  let area = 0;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1] as { at: number; s: number }, b = pts[i] as { at: number; s: number }; area += ((a.s + b.s) / 2) * (b.at - a.at); }
  return area;
}

/** Scene ms the clip takes to play its used part: null when it never ends by itself (a loop, no length). A still holds for duration_ms. */
export function naturalLength(v: VideoTiming | undefined): number | null {
  const used = Number(v?.duration_ms) > 0 ? Number(v?.duration_ms) : null;
  if (used === null || v?.loop) return null;
  if (v?.still) return used;
  if (!rampKeys(v).length) return used / (Number(v?.speed) > 0 ? Number(v?.speed) : 1);
  // Invert the area: step along the ramp until the file part is used (exact enough at 1 ms).
  let lo = 0, hi = used / MIN_SPEED;
  for (let n = 0; n < 40 && hi - lo > 0.5; n++) { const mid = (lo + hi) / 2; if (fileOffsetAt(v, mid) < used) lo = mid; else hi = mid; }
  return hi;
}

export function videoSourceMs(t: number, inMs: number | undefined, v: VideoTiming | undefined): number {
  const offset = Math.max(0, Number(v?.offset_ms) || 0);
  // A still shows its one frame; a ramp plays the area under its speed curve.
  if (v?.still) return Math.round(offset);
  const used = Number(v?.duration_ms) > 0 ? Number(v?.duration_ms) : Infinity;
  let pos = fileOffsetAt(v, t - (Number(inMs) || 0));
  if (pos >= used) pos = v?.loop ? pos % used : used - 1;
  return Math.round(offset + Math.max(0, pos));
}

/**
 * How a clip's numbers change when one of its edges moves by a scene ms, `local` ms
 * after its in point: `file` = its file position (offset_ms), `length` = its duration_ms.
 * Both are the speed there — except a still, whose one frame never moves while its
 * duration_ms (the hold) grows ms for ms.
 */
export function edgeRates(v: VideoTiming | undefined, local: number): { file: number; length: number } {
  if (v?.still) return { file: 0, length: 1 };
  const s = speedAt(v, local);
  return { file: s, length: s };
}

/** The timing with its ramp keys moved by `byMs` (when its in point moves the other way): the curve stays on the same footage. */
export function shiftRamp<T extends VideoTiming>(v: T, byMs: number): T {
  const keys = rampKeys(v);
  if (!keys.length || byMs === 0) return v;
  const shifted = keys.map(k => ({ at_ms: Math.round(k.at_ms + byMs), speed: k.speed }));
  // A key that falls before the clip's start becomes the speed it starts at.
  const kept = shifted.filter(k => k.at_ms > 0);
  return { ...v, ramp: [{ at_ms: 0, speed: +speedAt(v, -byMs).toFixed(4) }, ...kept] };
}
