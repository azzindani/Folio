// diagnose_design {review:true} on a page that MOVES — measure what the viewer
// sees at each shot's rest, not the page as authored.
//
// A camera world's authored frame is its top-left corner, which no viewer ever
// sees; a storyboarded page's authored state is only shot 0. So each shot is
// posed at the moment the lint judges it (its rest) and measured like a still.
// Two more facts come from time itself: how long each shot is truly STILL
// (nothing moving, a slow camera drift included) and how the camera frames the
// shots — found live (2026-09-20): eight framings of one size at even steps
// read as a slide deck scrolled, and a camera that never stopped left the
// headline sliding while it was being read. Neither was caught by a check.

import type { DesignSpec, Layer, Page } from '../../schema/types';
import { layersAt, animationDuration } from '../../export/gif-frames';
import { stampScripts } from '../../scripting/script-frames';
import { canvasBoxes } from '../../export/frame-cull';
import { shotMarks } from './motion-time';
import { shotRests, type ShotRest } from './motion-lint';
import { measureEntries, pageEntries, type PageLayout, type Box, type Component } from './layout-review';
import type { Balance } from './layout-measure';
import { readingTimes, readingNotes, type ReadingTime } from './layout-reading';

export interface ShotLayout {
  shot: string;
  /** Where the shot starts, and the moment it is measured at (its rest). */
  at: number;
  t: number;
  rest_ms: number;
  still_ms: number;
  /** World px across the frame at the rest — the camera's framing size. */
  framing_px?: number;
  ink: number;
  occupied: number;
  empty: Array<Box & { share: number }>;
  balance: Balance['offset'] | null;
  /** The largest things in frame, measured where the camera puts them. */
  components: Component[];
  notes: string[];
}

export interface MotionReview {
  scene_ms: number; shots: ShotLayout[];
  /** Texts on screen too briefly to read (layout-reading.ts). */
  reading?: ReadingTime[];
  notes: string[];
}

const MAX_SHOTS = 16;
/** Under this share of the frame inked, a posed moment shows nothing. */
const BLANK_INK = 0.005;
const CAMERA_ID = '__camera';
/** Under this, a shot never holds still long enough to settle the eye. */
const STILL_MIN_MS = 1000;

/** The camera's zoom at a posed moment (motion-camera-op.ts), if there is a camera. */
export function cameraZoom(layers: Layer[]): number | null {
  for (const l of layers) {
    if (l.id === CAMERA_ID) {
      const pose = (l as { _frame_pose?: { scale_x?: number } })._frame_pose;
      return typeof pose?.scale_x === 'number' && pose.scale_x > 0 ? pose.scale_x : 1;
    }
    const kids = (l as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) {
      const z = cameraZoom(kids);
      if (z !== null) return z;
    }
  }
  return null;
}

/** Facts about the piece's time: shots that never hold still, framings that repeat. */
export function timeNotes(shots: ShotLayout[], canvasW: number): string[] {
  const out: string[] = [];
  const restless = shots.filter(s => s.still_ms < STILL_MIN_MS);
  if (restless.length) {
    out.push(`${restless.length} of ${shots.length} shot(s) never hold still for ${STILL_MIN_MS} ms (a camera drift counts as motion): ${restless.slice(0, 6).map(s => `"${s.shot}" ${s.still_ms} ms`).join(', ')}.`);
  }
  const framed = shots.filter(s => typeof s.framing_px === 'number');
  if (framed.length >= 3) {
    const bucket = new Map<number, number>();
    for (const s of framed) {
      const k = Math.round((s.framing_px ?? 0) / (canvasW * 0.05));
      bucket.set(k, (bucket.get(k) ?? 0) + 1);
    }
    const [k, n] = [...bucket.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
    if (n >= 3 && n / framed.length >= 0.6) {
      out.push(`${n} of ${framed.length} shots are framed at the same size (~${Math.round(k * canvasW * 0.05)} world px across).`);
    }
  }
  return out;
}

const LOOP_SAMPLES = 12;

/** The moment in [from, until) that paints the most — drawn area × opacity, from the boxes, no render. */
export function fullestAt(layers: Layer[], from: number, until: number): number {
  let best = until - 1, most = -1;
  for (let i = 0; i < LOOP_SAMPLES; i++) {
    const t = Math.round(from + ((until - 1 - from) * i) / (LOOP_SAMPLES - 1));
    const painted = canvasBoxes(layersAt(layers, t)).reduce((sum, b) => sum + b.box.width * b.box.height * b.opacity, 0);
    if (painted > most + 1) { most = painted; best = t; }
  }
  return best;
}

/** One moving page: every shot posed at its rest and measured. Null when nothing moves. */
export function reviewMotionPage(spec: DesignSpec, page: Page | undefined, layers: Layer[], projectDir: string): MotionReview | null {
  const motionEnd = animationDuration(layers);
  if (motionEnd <= 0) return null;
  // A page held on screen for a set time (op:scene length_ms) rests after its
  // motion lands. Measured over the motion alone, every scene of a 30 s
  // explainer "never held still", and one scene's rest fell in a 50 ms gap
  // between two entrances (benchmark r2).
  const held = page?.auto_advance;
  const end = typeof held === 'number' && held > 0 ? held : motionEnd;
  const W = spec.document?.width ?? 0;
  const marks = shotMarks(spec, layers, page);
  // A shot that rests from start to end moves only in loops — a sprout that grows,
  // sways and folds away every 6 s rests the whole shot — and its last frame is
  // not what it holds: the one-shot benchmark (r4) measured the frame the hero
  // had folded away. Such a shot is measured at its fullest moment instead.
  const rests = shotRests(layers, marks, end).slice(0, MAX_SHOTS)
    .map(r => (r.rest_ms >= r.until - r.at - 1 ? { ...r, t: fullestAt(layers, r.at, r.until) } : r));
  // Posed at the shot's moment, script components included (their frame for that time — close-out C4).
  const pose = (t: number): Layer[] => stampScripts(layersAt(layers, t), t);
  const posed = rests.map(r => ({ id: r.shot, layers: pose(r.t) }));
  const measured = measureEntries(spec, posed, projectDir);
  // A shot whose only still moment comes before anything has entered measured
  // a blank frame and called a full scene "100% empty" (found on a 7-scene
  // promo). Such a shot is measured at its last frame instead, and says so.
  // Also a shot whose still stretch is its opening — the first frames, content
  // still arriving (a promo scene read "71% empty" at 299 ms): candidates are
  // re-measured at their last frame and replaced if that frame is fuller.
  const opening = (r: ShotRest): boolean => r.t + 1 - r.rest_ms <= r.at;
  const blankAt = rests.flatMap((r, i) => (((measured[i]?.ink ?? 0) < BLANK_INK || opening(r)) && r.until - 1 > r.t ? [i] : []));
  if (blankAt.length) {
    const again = blankAt.map(i => ({ id: rests[i]?.shot, layers: pose((rests[i]?.until ?? 1) - 1) }));
    const remeasured = measureEntries(spec, again, projectDir);
    blankAt.forEach((i, j) => {
      const r = rests[i], m = remeasured[j], pose = again[j];
      const before = measured[i]?.ink ?? 0;
      if (!r || !m || !pose || m.ink < BLANK_INK || (before >= BLANK_INK && m.ink < before * 2)) return;
      const why = before < BLANK_INK ? 'shows nothing yet' : `comes before its content has arrived (ink ${before} vs ${m.ink})`;
      measured[i] = { ...m, notes: [`Its only still moment (${r.rest_ms} ms at ${r.t} ms) ${why} — measured at its last frame, ${r.until - 1} ms.`, ...m.notes] };
      rests[i] = { ...r, t: r.until - 1 };
      posed[i] = pose;
    });
  }
  const shots: ShotLayout[] = rests.map((r, i) => {
    const m: PageLayout | undefined = measured[i];
    const zoom = cameraZoom(posed[i]?.layers ?? []);
    return {
      shot: r.shot, at: r.at, t: r.t, rest_ms: r.rest_ms, still_ms: r.still_ms,
      ...(zoom !== null && W > 0 ? { framing_px: Math.round(W / zoom) } : {}),
      ink: m?.ink ?? 0, occupied: m?.occupied ?? 0,
      empty: (m?.empty ?? []).slice(0, 2),
      balance: m?.balance?.offset ?? null,
      components: (m?.components ?? []).slice(0, 3),
      notes: m?.notes ?? [],
    };
  });
  const H = spec.document?.height ?? 0;
  const short = readingTimes(layers, end, W, H).filter(r => r.on_ms > 0 && r.on_ms < r.needs_ms);
  const notes = [...timeNotes(shots, W), ...readingNotes(short)];
  if (marks.length > MAX_SHOTS) notes.push(`Measured the first ${MAX_SHOTS} of ${marks.length} shots.`);
  return { scene_ms: end, shots, ...(short.length ? { reading: short } : {}), notes };
}

/** Add `motion` to each reviewed page that moves (diagnose_design review:true). */
export function withMotion(review: PageLayout[], spec: DesignSpec, projectDir: string, pageId?: string): Array<PageLayout & { motion?: MotionReview }> {
  const entries = pageEntries(spec, pageId);
  return review.map((r, i) => {
    const e = entries[i];
    if (!e) return r;
    const page = spec.pages?.find(p => p.id === e.id);
    const motion = reviewMotionPage(spec, page, e.layers, projectDir);
    return motion ? { ...r, motion } : r;
  });
}
