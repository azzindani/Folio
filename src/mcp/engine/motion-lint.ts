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

export type LintKind = 'overlap' | 'off_canvas' | 'idle' | 'busy' | 'reading' | 'link';
export interface LintNote { kind: LintKind; note: string; at_ms?: number; shot?: string; layers?: string[] }
/** A named moment of the piece — a storyboard shot or a marker — and when the next one starts. */
export interface LintMark { id: string; at: number }

type Node = Layer & { animation?: AnimationSpec; layers?: Layer[]; link?: LayerLink };
interface Segment { id: string; unit: string; start: number; end: number }

const IDLE_MS = 2000;
const BUSY_UNITS = 4;
const WPM = 240;

/**
 * Every stretch of a one-shot track where the pose actually changes, on the
 * scene clock. `followers` are link wrappers: they move because their lead
 * does, so they are motion (not idle) but not a separate thing to follow.
 */
function segments(layers: Layer[], followers: Set<string>): { moves: Segment[]; loops: string[] } {
  const moves: Segment[] = [];
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
            // A stagger is one gesture: siblings making the same move count as one thing moving.
            const unit = followers.has(l.id) ? '' : `${parent}|${values(p)}>${values(q)}|${q.t - p.t}`;
            moves.push({ id: l.id, unit, start: base + p.t, end: base + q.t });
          }
        }
      }
      if (Array.isArray(l.layers)) visit(l.layers, l.id);
    }
  };
  visit(layers, '');
  return { moves, loops };
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

/** Overlaps, edges and reading time, measured where each shot rests. */
function restNotes(layers: Layer[], canvas: { width: number; height: number }, marks: LintMark[], moves: Segment[], endMs: number, rests: Rest[]): LintNote[] {
  const notes: LintNote[] = [];
  const seenPairs = new Set<string>(), seenEdges = new Set<string>();
  let shownBefore = new Set<string>();
  const ordered = [...marks].sort((a, b) => a.at - b.at);
  ordered.forEach((mark, i) => {
    const until = Math.min(ordered[i + 1]?.at ?? endMs, endMs);
    if (until <= mark.at) return;
    const quiet = quietest(moves, mark.at, until);
    const landed = quiet.start;
    const t = Math.max(mark.at, quiet.end - 1);
    const texts = canvasBoxes(layersAt(layers, t)).filter(b => b.layer.type === 'text' && b.opacity > 0.3 && area(b.box) > 0);
    for (let p = 0; p < texts.length; p++) {
      for (let q = p + 1; q < texts.length; q++) {
        const A = texts[p], B = texts[q];
        if (!A || !B) continue;
        const key = [A.layer.id, B.layer.id].sort().join('+');
        if (seenPairs.has(key) || overlapArea(A.box, B.box) < 0.15 * Math.min(area(A.box), area(B.box))) continue;
        seenPairs.add(key);
        notes.push({ kind: 'overlap', shot: mark.id, at_ms: t, layers: [A.layer.id, B.layer.id],
          note: `In "${mark.id}", "${A.layer.id}" and "${B.layer.id}" rest on top of each other at ${t}ms. Move one, or hide it before the other lands.` });
      }
    }
    const shown = new Set(texts.filter(b => b.opacity > 0.5).map(b => b.layer.id));
    const fresh = texts.filter(b => shown.has(b.layer.id) && !shownBefore.has(b.layer.id));
    for (const b of texts) {
      const inside = overlapArea(b.box, { x: 0, y: 0, ...canvas }) / area(b.box);
      // Cut by the edge is always wrong. Wholly outside is where a camera left it —
      // unless it only just appeared, in which case it entered where no one sees it.
      const cut = inside > 0.02 && inside < 0.9;
      const unseen = inside <= 0.02 && fresh.includes(b);
      if ((cut || unseen) && !seenEdges.has(b.layer.id)) {
        seenEdges.add(b.layer.id);
        notes.push({ kind: 'off_canvas', shot: mark.id, at_ms: t, layers: [b.layer.id],
          note: `In "${mark.id}", "${b.layer.id}" rests ${Math.round((1 - inside) * 100)}% outside the frame at ${t}ms (box ${Math.round(b.box.x)},${Math.round(b.box.y)} ${Math.round(b.box.width)}×${Math.round(b.box.height)}).` });
      }
    }
    const count = fresh.reduce((n, b) => n + words(b.layer), 0);
    const need = Math.round((count / WPM) * 60000);
    const hold = quiet.end - quiet.start;
    rests.push({ start: mark.at, end: until, readMs: need });
    if (count > 0 && hold < need * 0.9) {
      notes.push({ kind: 'reading', shot: mark.id, at_ms: landed, layers: fresh.map(b => b.layer.id).slice(0, 8),
        note: `"${mark.id}" shows ${count} new word(s) and rests ${Math.max(0, hold)}ms after its last move lands; reading takes ~${need}ms at ${WPM} wpm.` });
    }
    shownBefore = shown;
  });
  return notes;
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
  const { moves, loops } = segments(resolveTimeline(layers), followers);
  const shots = marks.length ? marks : [{ id: 'piece', at: 0 }];
  const rests: Rest[] = [];
  const atRest = restNotes(layers, canvas, shots, moves, endMs, rests);
  return [
    ...linkNotes(layers),
    ...atRest,
    ...idleNotes(moves, loops, rests),
    ...busyNotes(moves, endMs),
  ].slice(0, 24);
}
