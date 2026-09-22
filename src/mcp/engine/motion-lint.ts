/**
 * Time-aware composition lint — checks that look ACROSS the timeline.
 *
 * Every other check in Folio reads one frame. A continuous piece fails in
 * time: two headlines land on the same spot in shot 3, a card rests half off
 * the canvas after the camera moves, nothing moves for four seconds, nine
 * things move at once, a shot cuts away before its words can be read. The
 * engine measures; it never re-times anything itself — each note names the
 * layers and the moment so the model decides what to change.
 */

import type { Layer } from '../../schema/types';
import type { AnimationSpec, Keyframe, LayerLink } from '../../animation/types';
import { resolveTimeline } from '../../animation/timeline-resolve';
import { layersAt } from '../../export/gif-frames';
import { canvasBoxes, type CanvasBox } from '../../export/frame-cull';
import { buriedTexts, ancestry } from './motion-lint-buried';

export type LintKind = 'overlap' | 'off_canvas' | 'buried' | 'idle' | 'busy' | 'reading' | 'link';
export interface LintNote { kind: LintKind; note: string; at_ms?: number; shot?: string; layers?: string[] }
/** A named moment of the piece — a storyboard shot or a marker — and when the next one starts. */
export interface LintMark { id: string; at: number }

type Node = Layer & { animation?: AnimationSpec; layers?: Layer[]; link?: LayerLink };
interface Segment { id: string; unit: string; start: number; end: number }

const IDLE_MS = 2000;
const BUSY_UNITS = 4;
const WPM = 240;
/** The camera group (motion-camera-op.ts): it moves every layer, so it places none of them. */
const CAMERA_ID = '__camera';

/**
 * Every stretch of a one-shot track where the pose actually changes, on the
 * scene clock. `followers` are link wrappers: they move because their lead
 * does, so they are motion (not idle) but not a separate thing to follow.
 */
function segments(layers: Layer[], followers: Set<string>): { moves: Segment[]; drifts: Segment[]; loops: string[] } {
  const moves: Segment[] = [];
  const drifts: Segment[] = [];
  const loops: string[] = [];
  const values = (k: Keyframe): string => JSON.stringify(Object.entries(k).filter(([key]) => key !== 't' && key !== 'easing' && key !== 'hold' && key !== 'ambient').sort());
  const visit = (ls: Layer[], parent: string): void => {
    for (const l of ls as Node[]) {
      const a = l.animation;
      const frames = a?.keyframes;
      if (frames && frames.length > 1) {
        if (a?.playback?.loop) loops.push(l.id);
        else {
          const sorted = [...frames].sort((p, q) => p.t - q.t);
          const base = (a?.playback?.delay ?? 0) - (sorted[0]?.t ?? 0);
          // A loop a layer rests in (a storyboard state's `loop`) is ambient: not a move, not a break in a rest.
          if (sorted.some(k => k.ambient)) loops.push(l.id);
          for (let i = 0; i + 1 < sorted.length; i++) {
            const p = sorted[i], q = sorted[i + 1];
            if (!p || !q || p.hold || p.ambient || values(p) === values(q)) continue;
            const unit = followers.has(l.id) ? '' : gesture(parent, p, q);
            (isDrift(p, q) ? drifts : moves).push({ id: l.id, unit, start: base + p.t, end: base + q.t });
          }
        }
      }
      if (Array.isArray(l.layers)) visit(l.layers, l.id);
    }
  };
  visit(layers, '');
  return { moves, drifts, loops };
}

/**
 * What the eye counts as one thing moving. Siblings changing the same channels
 * over the same time are one gesture however far each goes (common fate: six
 * chips converging on a card read as one flight), and every pure fade at a
 * moment is one event — a fade is noticed, not followed. Found live: a
 * convergence and a scene clear each read as "six separate things".
 */
function gesture(parent: string, p: Keyframe, q: Keyframe): string {
  const a = p as unknown as Record<string, unknown>, b = q as unknown as Record<string, unknown>;
  const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter(k => k !== 't' && k !== 'easing' && k !== 'hold' && k !== 'ambient' && a[k] !== b[k]).sort();
  return changed.length === 1 && changed[0] === 'opacity' ? 'fade' : `${parent}|${changed.join(',')}|${q.t - p.t}`;
}

const DRIFT_PX_S = 60, DRIFT_SCALE_S = 0.05, DRIFT_DEG_S = 3, DRIFT_MIN_MS = 1500;
const DRIFT_KEYS = new Set(['x', 'y', 'scale', 'scale_x', 'scale_y', 'rotation']);

/**
 * A slow push or drift — only position and scale, a few pixels a second, held
 * for a while (a short nudge is a gesture, however small). The eye reads
 * through it, so it is no interruption of a rest; it is still motion, so it is
 * no idle stretch either. Found live: a camera easing 4% closer over
 * each 4.5 s hold made every shot "rest 0 ms" and every line "too short to read".
 * Position stays absolute (px/s), scale a ratio per second, rotation degrees per second.
 */
function isDrift(p: Keyframe, q: Keyframe): boolean {
  if (q.t - p.t < DRIFT_MIN_MS) return false;
  const secs = Math.max(0.001, (q.t - p.t) / 1000);
  const a = p as unknown as Record<string, unknown>, b = q as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 't' || key === 'easing' || key === 'hold' || key === 'ambient' || a[key] === b[key]) continue;
    if (!DRIFT_KEYS.has(key)) return false;
    const from = Number(a[key] ?? (key.startsWith('scale') ? 1 : 0)), to = Number(b[key] ?? (key.startsWith('scale') ? 1 : 0));
    // Scale is judged as a RATIO: deep in a zoom, scale 9.3 → 9.5 is the same
    // gentle push as 1 → 1.02 at the top, and an absolute threshold called it a
    // move (found live on a piece that dives to 13×).
    const rate = key.startsWith('scale') ? Math.abs(to / (from || 1) - 1) : Math.abs(to - from);
    const cap = key.startsWith('scale') ? DRIFT_SCALE_S : key === 'rotation' ? DRIFT_DEG_S : DRIFT_PX_S;
    if (rate / secs > cap) return false;
  }
  return true;
}

/** Moments where more separate things move than an eye can follow. */
function busyNotes(moves: Segment[], endMs: number): LintNote[] {
  const notes: LintNote[] = [];
  let lastNoted = -Infinity;
  for (let t = 0; t <= endMs; t += 100) {
    const active = moves.filter(m => m.unit && m.start <= t && t < m.end);
    const units = new Set(active.map(m => m.unit));
    if (units.size > BUSY_UNITS && t - lastNoted > 1000) {
      const ids = [...new Set(active.map(m => m.id))];
      notes.push({ kind: 'busy', at_ms: t, layers: ids.slice(0, 12),
        note: `${units.size} separate things move at ${t}ms (${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ', …' : ''}). The eye follows two or three: stagger them, or let some land first.` });
      lastNoted = t;
    }
  }
  return notes;
}

/** When a shot rests, and how long its new words need — a hold that long is reading, not idling. */
interface Rest { start: number; end: number; readMs: number }

/** Stretches with nothing moving, before the last motion ends (the final hold is the reading time). */
function idleNotes(moves: Segment[], loops: string[], rests: Rest[]): LintNote[] {
  const spans = [...moves].sort((a, b) => a.start - b.start);
  const notes: LintNote[] = [];
  let reach = 0;
  for (const s of spans) {
    const gap = s.start - reach;
    const reading = rests.find(r => r.start <= reach + 1 && reach < r.end);
    if (gap > IDLE_MS && gap > (reading ? reading.readMs + 1000 : 0)) {
      notes.push({ kind: 'idle', at_ms: Math.round(reach),
        note: `Nothing ${loops.length ? 'but loops ' : ''}moves from ${Math.round(reach)} to ${Math.round(s.start)}ms (${Math.round(s.start - reach)}ms). Hold on purpose, or bring the next beat forward.` });
    }
    reach = Math.max(reach, s.end);
  }
  return notes;
}

const words = (l: Layer): number => {
  const c = (l as unknown as { content?: { value?: unknown } }).content;
  return typeof c?.value === 'string' ? c.value.split(/\s+/).filter(Boolean).length : 0;
};
const area = (b: { width: number; height: number }): number => Math.max(0, b.width) * Math.max(0, b.height);
function overlapArea(a: CanvasBox['box'], b: CanvasBox['box']): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * A shot's rest: its longest stretch with nothing moving. Found live: sampling
 * "just before the next shot" caught a camera already panning to the next
 * section — every card of the shot read as off the frame.
 */
function quietest(moves: Segment[], from: number, until: number): { start: number; end: number } {
  const busy = moves.filter(m => m.end > from && m.start < until).sort((a, b) => a.start - b.start);
  let best = { start: until, end: until }, reach = from;
  for (const m of [...busy, { start: until, end: until }]) {
    if (m.start - reach > best.end - best.start) best = { start: reach, end: m.start };
    reach = Math.max(reach, m.end);
  }
  return best;
}

/** What a shot shows where it rests — measured once, so a later shot can look back at it. */
interface ShotView {
  mark: LintMark; until: number; t: number;
  /** Visible text on the canvas — text under an opaque layer painted after it is not visible. */
  texts: CanvasBox[];
  /** Shown now, not in the shot before. */
  fresh: CanvasBox[];
  /** Shown, inside the frame and drawn large enough to be read, not glanced at. */
  readable: Set<string>;
  /** The fresh readable lines: new words to read. */
  reads: Landing[];
  /** Each drawn layer's box with the camera's transform taken out — where things really sit. */
  world: Map<string, CanvasBox>;
  /** This shot brought the layer in or moved it — itself or through a parent. */
  entered: (id: string) => boolean;
  buried: Array<{ text: string; under: string }>;
}

/**
 * A line a viewer reads, and when it lands: its own motion, its parents' and a
 * camera move that brings it into view are done. Found live: a line landed at
 * 11.8 s while header chips kept arriving until 13.15 s — timed from the shot's
 * last move, it "had 0.05 s to be read".
 */
interface Landing { id: string; words: number; settle: number; x: number; y: number }

/** A text's drawn size: its font size times whatever scales it on the way to the canvas. */
function drawnSize(b: CanvasBox): number {
  const l = b.layer as unknown as { style?: { font_size?: number }; width?: number };
  const size = l.style?.font_size ?? 16;
  return typeof l.width === 'number' && l.width > 0 ? size * (b.box.width / l.width) : size;
}

function shotViews(layers: Layer[], canvas: { width: number; height: number }, marks: LintMark[], moves: Segment[], endMs: number): ShotView[] {
  const views: ShotView[] = [];
  const frameBox = { x: 0, y: 0, ...canvas };
  // Under 1/40 of the frame's height a line is a label or a data texture — glanced at, not read in turn.
  const minRead = canvas.height / 40;
  const windows = new Map<string, number>();
  const index = (ls: Layer[]): void => {
    for (const l of ls as Node[]) {
      const at = (l as unknown as { in?: unknown }).in;
      if (typeof at === 'number') windows.set(l.id, at);
      if (Array.isArray(l.layers)) index(l.layers);
    }
  };
  // Resolved: a clock on a parent shifts its children's in-points.
  index(resolveTimeline(layers));
  let shownBefore = new Set<string>();
  const ordered = [...marks].sort((a, b) => a.at - b.at);
  ordered.forEach((mark, i) => {
    const until = Math.min(ordered[i + 1]?.at ?? endMs, endMs);
    if (until <= mark.at) return;
    const quiet = quietest(moves, mark.at, until);
    const t = Math.max(mark.at, quiet.end - 1);
    const frame = layersAt(layers, t);
    const up = ancestry(frame);
    const moved = new Set(moves.filter(m => m.id !== CAMERA_ID && m.end > mark.at && m.start < until).map(m => m.id));
    const self = (id: string): boolean => moved.has(id) || ((windows.get(id) ?? -1) >= mark.at && (windows.get(id) ?? Infinity) < until);
    const entered = (id: string): boolean => self(id) || (up.get(id) ?? []).some(self);
    // Overlap and burial are judged in WORLD space, with the camera's own
    // transform neutralised. Every layer shares that transform, so it cannot
    // make two of them overlap — but a TILTED camera inflates each axis-aligned
    // box (found live: a 2.6° tilt made two stacked headlines "rest on top of
    // each other"). Edges and readability still use the screen boxes.
    const flat = frame.map(l => (l.id === CAMERA_ID ? ({ ...l, transform: undefined } as Layer) : l));
    const hidden = new Set(buriedTexts(flat, () => true).map(b => b.text));
    const world = new Map(canvasBoxes(flat).map(b => [b.layer.id, b]));
    const texts = canvasBoxes(frame).filter(b => b.layer.type === 'text' && b.opacity > 0.3 && area(b.box) > 0 && !hidden.has(b.layer.id));
    const shown = new Set(texts.filter(b => b.opacity > 0.5).map(b => b.layer.id));
    const fresh = texts.filter(b => shown.has(b.layer.id) && !shownBefore.has(b.layer.id));
    const readable = new Set(texts.filter(b => shown.has(b.layer.id) && overlapArea(b.box, frameBox) / area(b.box) >= 0.9 && drawnSize(b) >= minRead).map(b => b.layer.id));
    const freshIds = new Set(fresh.map(b => b.layer.id));
    const inShot = moves.filter(m => m.end > mark.at && m.start < until);
    const lastEnd = (ms: Segment[]): number => ms.reduce((at, m) => Math.max(at, m.end), mark.at);
    const reads = fresh.filter(b => readable.has(b.layer.id)).map((b): Landing => {
      // The camera is an ancestor of everything and moves on its own schedule;
      // its part is judged below, by whether it was already moving when the line landed.
      const by = new Set([b.layer.id, ...(up.get(b.layer.id) ?? [])].filter(id => id !== CAMERA_ID));
      const own = lastEnd(inShot.filter(m => by.has(m.id)));
      // A pan that starts after the line landed is the camera leaving, not arriving.
      const camera = lastEnd(inShot.filter(m => m.id === CAMERA_ID && m.start <= own));
      return { id: b.layer.id, words: words(b.layer), settle: Math.max(own, camera), x: b.box.x, y: b.box.y };
    });
    views.push({
      mark, until, t, texts, fresh, readable, reads,
      entered,
      buried: buriedTexts(flat, id => entered(id) || freshIds.has(id)),
      world,
    });
    shownBefore = shown;
  });
  return views;
}

/** Overlaps, edges, buried text and reading time, measured where each shot rests. */
function restNotes(layers: Layer[], canvas: { width: number; height: number }, marks: LintMark[], moves: Segment[], endMs: number, rests: Rest[]): LintNote[] {
  const notes: LintNote[] = [];
  const seenPairs = new Set<string>(), seenEdges = new Set<string>(), seenBuried = new Set<string>();
  const views = shotViews(layers, canvas, marks, moves, endMs);
  for (const v of views) {
    const { mark, t, texts } = v;
    for (let p = 0; p < texts.length; p++) {
      for (let q = p + 1; q < texts.length; q++) {
        const A = texts[p], B = texts[q];
        if (!A || !B) continue;
        const key = [A.layer.id, B.layer.id].sort().join('+');
        const a = v.world.get(A.layer.id)?.box ?? A.box, b = v.world.get(B.layer.id)?.box ?? B.box;
        if (seenPairs.has(key) || overlapArea(a, b) < 0.15 * Math.min(area(a), area(b))) continue;
        seenPairs.add(key);
        notes.push({ kind: 'overlap', shot: mark.id, at_ms: t, layers: [A.layer.id, B.layer.id],
          note: `In "${mark.id}", "${A.layer.id}" and "${B.layer.id}" rest on top of each other at ${t}ms. Move one, or hide it before the other lands.` });
      }
    }
    for (const b of texts) {
      const inside = overlapArea(b.box, { x: 0, y: 0, ...canvas }) / area(b.box);
      // Cut by the edge is always wrong. Wholly outside is where a camera left it, or
      // scenery waiting for the camera — unless this shot brought it in, where no one sees it.
      const cut = inside > 0.02 && inside < 0.9;
      const unseen = inside <= 0.02 && v.fresh.includes(b) && v.entered(b.layer.id);
      if ((cut || unseen) && !seenEdges.has(b.layer.id)) {
        seenEdges.add(b.layer.id);
        notes.push({ kind: 'off_canvas', shot: mark.id, at_ms: t, layers: [b.layer.id],
          note: `In "${mark.id}", "${b.layer.id}" rests ${Math.round((1 - inside) * 100)}% outside the frame at ${t}ms (box ${Math.round(b.box.x)},${Math.round(b.box.y)} ${Math.round(b.box.width)}×${Math.round(b.box.height)}).` });
      }
    }
    for (const b of v.buried) {
      if (seenBuried.has(b.text)) continue;
      seenBuried.add(b.text);
      notes.push({ kind: 'buried', shot: mark.id, at_ms: t, layers: [b.text, b.under],
        note: `In "${mark.id}", "${b.text}" lands under "${b.under}", which is painted over it at ${t}ms — it is there but cannot be seen. Give it (or its group) a z above "${b.under}", or move one of them.` });
    }
  }
  return [...notes, ...readingNotes(views, endMs, rests)];
}

/**
 * Whether each line can be read before it leaves readable view. A viewer reads
 * one line at a time, in the order they land, so a line is read from the later
 * of its landing and the end of the line before — a build of four lines is read
 * as it builds, and a question stays readable into the shot that answers it.
 */
function readingNotes(views: ShotView[], endMs: number, rests: Rest[]): LintNote[] {
  const lines: Array<Landing & { shot: string; leave: number }> = [];
  views.forEach((v, i) => {
    for (const r of v.reads) {
      const gone = views.slice(i + 1).find(w => !w.readable.has(r.id));
      lines.push({ ...r, shot: v.mark.id, leave: gone?.mark.at ?? endMs });
    }
    rests.push({ start: v.mark.at, end: v.until, readMs: Math.round((v.reads.reduce((n, r) => n + r.words, 0) / WPM) * 60000) });
  });
  lines.sort((a, b) => a.settle - b.settle || a.y - b.y || a.x - b.x);
  const worst = new Map<string, { cut: string[]; note: LintNote; late: number }>();
  let free = 0;
  for (const r of lines) {
    const need = Math.round((r.words / WPM) * 60000);
    const start = Math.max(free, r.settle), done = start + need, late = done - r.leave;
    // A line the viewer cannot finish is dropped when it leaves; the next line is not blamed for it.
    free = late > 0 ? Math.max(free, Math.min(done, r.leave)) : done;
    if (late <= Math.max(250, need * 0.1)) continue;
    const seen = worst.get(r.shot) ?? { cut: [], late: 0, note: { kind: 'reading', note: '' } };
    seen.cut.push(r.id);
    if (late > seen.late) {
      seen.late = late;
      seen.note = { kind: 'reading', shot: r.shot, at_ms: r.settle, layers: seen.cut,
        note: `In "${r.shot}", "${r.id}" (${r.words} words, ~${need}ms at ${WPM} wpm) lands at ${r.settle}ms${start > r.settle ? `, is reached at ${start}ms after the lines before it` : ''} and leaves readable view at ${r.leave}ms — ${Math.round(late)}ms short.` };
    }
    worst.set(r.shot, seen);
  }
  return [...worst.values()].map(w => ({ ...w.note, layers: w.cut.slice(0, 8),
    note: w.cut.length > 1 ? `${w.note.note} ${w.cut.length - 1} more line(s) in this shot are cut short too.` : w.note.note }));
}

/** Links whose target is missing or does not move — the follower would sit still. */
function linkNotes(layers: Layer[]): LintNote[] {
  const ids = new Map<string, Node>();
  const index = (ls: Layer[]): void => { for (const l of ls as Node[]) { ids.set(l.id, l); if (Array.isArray(l.layers)) index(l.layers); } };
  index(layers);
  const notes: LintNote[] = [];
  for (const l of ids.values()) {
    if (!l.link) continue;
    const target = ids.get(l.link.to);
    if (!target) notes.push({ kind: 'link', layers: [l.id], note: `"${l.id}" follows "${l.link.to}", which is not on this page.` });
    else if (!target.animation?.keyframes?.length && !target.link) notes.push({ kind: 'link', layers: [l.id, target.id], note: `"${l.id}" follows "${target.id}", which has no motion — so it never moves.` });
  }
  return notes;
}

/**
 * Every time-aware note for a page. `marks` are the shots (or markers) the
 * piece is told in; without any, the whole piece is one shot.
 */
export function lintComposition(layers: Layer[], canvas: { width: number; height: number }, marks: LintMark[], endMs: number): LintNote[] {
  const followers = new Set<string>();
  const find = (ls: Layer[]): void => { for (const l of ls as Node[]) { if (l.link) followers.add(l.id); if (Array.isArray(l.layers)) find(l.layers); } };
  find(layers);
  const { moves, drifts, loops } = segments(resolveTimeline(layers), followers);
  const shots = marks.length ? marks : [{ id: 'piece', at: 0 }];
  const rests: Rest[] = [];
  const atRest = restNotes(layers, canvas, shots, moves, endMs, rests);
  return [
    ...linkNotes(layers),
    ...atRest,
    ...idleNotes([...moves, ...drifts], loops, rests),
    ...busyNotes(moves, endMs),
  ].slice(0, 24);
}

/** Where one shot rests, for measuring it (layout-review-motion.ts). */
export interface ShotRest {
  shot: string;
  /** The shot's own span on the scene clock. */
  at: number;
  until: number;
  /** The moment the shot is judged at: the end of its rest. */
  t: number;
  /** Its rest as the lint reads it — a slow camera drift does not break it. */
  rest_ms: number;
  /** Its longest stretch with NOTHING moving, drift included. */
  still_ms: number;
}

/** Each shot's rest — the same moment the lint judges it at. */
export function shotRests(layers: Layer[], marks: LintMark[], endMs: number): ShotRest[] {
  const { moves, drifts } = segments(resolveTimeline(layers), new Set());
  const shots = marks.length ? [...marks].sort((a, b) => a.at - b.at) : [{ id: 'piece', at: 0 }];
  return shots.flatMap((m, i) => {
    const until = Math.min(shots[i + 1]?.at ?? endMs, endMs);
    if (until <= m.at) return [];
    const rest = quietest(moves, m.at, until);
    const still = quietest([...moves, ...drifts], m.at, until);
    return [{ shot: m.id, at: m.at, until, t: Math.max(m.at, rest.end - 1), rest_ms: rest.end - rest.start, still_ms: still.end - still.start }];
  });
}
