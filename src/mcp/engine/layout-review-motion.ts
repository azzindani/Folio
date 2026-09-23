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
import { readMarkers } from './motion-time';
import { shotRests } from './motion-lint';
import { measureEntries, pageEntries, type PageLayout, type Box, type Component } from './layout-review';
import type { Balance } from './layout-measure';

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

export interface MotionReview { scene_ms: number; shots: ShotLayout[]; notes: string[] }

const MAX_SHOTS = 16;
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

/** One moving page: every shot posed at its rest and measured. Null when nothing moves. */
export function reviewMotionPage(spec: DesignSpec, page: Page | undefined, layers: Layer[], projectDir: string): MotionReview | null {
  const end = animationDuration(layers);
  if (end <= 0) return null;
  const W = spec.document?.width ?? 0;
  const marks = Object.entries(readMarkers(spec, page)).map(([id, at]) => ({ id, at: Number(at) })).filter(m => Number.isFinite(m.at));
  const rests = shotRests(layers, marks, end).slice(0, MAX_SHOTS);
  const posed = rests.map(r => ({ id: r.shot, layers: layersAt(layers, r.t) }));
  const measured = measureEntries(spec, posed, projectDir);
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
  const notes = timeNotes(shots, W);
  if (marks.length > MAX_SHOTS) notes.push(`Measured the first ${MAX_SHOTS} of ${marks.length} shots.`);
  return { scene_ms: end, shots, notes };
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
