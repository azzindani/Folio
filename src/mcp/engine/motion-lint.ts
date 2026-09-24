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
import type { AnimationSpec, LayerLink } from '../../animation/types';
import { changedChannels, type ChannelChange } from '../../animation/keyframe-segments';
import { resolveTimeline } from '../../animation/timeline-resolve';
import { layersAt } from '../../export/gif-frames';
import { pivotOf } from '../../export/frame-pose';
import { parentBases, chainOf } from './motion-rig-stack';
import { canvasBoxes, type CanvasBox } from '../../export/frame-cull';
import { buriedTexts, ancestry } from './motion-lint-buried';
import { frameUnits, collisions, type Unit, type Spaces } from './motion-lint-collide';
import { crowdNotes, restlessNotes, readingLines, type ReadLine, type Shown } from './motion-lint-pace';

export type LintKind = 'overlap' | 'collision' | 'off_canvas' | 'buried' | 'idle' | 'busy' | 'reading' | 'link' | 'crowd' | 'restless';
export interface LintNote { kind: LintKind; note: string; at_ms?: number; shot?: string; layers?: string[]; /** reading: how much longer the words need, ms. */ short_ms?: number }
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
            const changed = changedChannels(sorted, i);
            if (!p || !q || p.hold || p.ambient || !changed.length) continue;
            // The pieces of one split line are one line, each behind its own mask or not (benchmark r5:
            // the letters of "DevNorth" rising in turn read as eight separate things moving).
            const of = (l as unknown as { split_of?: unknown }).split_of;
            const unit = followers.has(l.id) ? '' : gesture(typeof of === 'string' ? `split:${of}` : parent, changed, q.t - p.t);
            (isDrift(changed, q.t - p.t) ? drifts : moves).push({ id: l.id, unit, start: base + p.t, end: base + q.t });
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
function gesture(parent: string, changed: ChannelChange[], ms: number): string {
  const keys = changed.map(c => c.key).sort();
  return keys.length === 1 && keys[0] === 'opacity' ? 'fade' : `${parent}|${keys.join(',')}|${ms}`;
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
function isDrift(changed: ChannelChange[], ms: number): boolean {
  if (ms < DRIFT_MIN_MS) return false;
  const secs = Math.max(0.001, ms / 1000);
  for (const { key, from: a, to: b } of changed) {
    if (!DRIFT_KEYS.has(key)) return false;
    const from = Number(a), to = Number(b);
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

const said = (l: Layer): string => {
  const c = (l as unknown as { content?: { value?: unknown } }).content;
  return typeof c?.value === 'string' ? c.value : '';
};
/** The line a split piece belongs to — itself when whole. */
const blockOf = (l: Layer): string => {
  const of = (l as unknown as { split_of?: unknown }).split_of;
  return typeof of === 'string' ? of : l.id;
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

/** Drawn area × opacity at t: how much is on screen, from the boxes. */
const painted = (layers: Layer[], t: number): number =>
  canvasBoxes(layersAt(layers, t)).reduce((sum, b) => sum + area(b.box) * b.opacity, 0);

/**
 * Where a shot is judged: its longest still stretch — unless that is the
 * shot's pre-roll, before its first move, and the shot shows more at its end.
 * A piece that fades its lines in at 300 ms and stops at 900 has no rest after
 * them, and was judged on its empty opening frame: three lines flashed for a
 * frame and the lint called it clean (found live, A4).
 */
function restOf(layers: Layer[], moves: Segment[], from: number, until: number): { start: number; end: number } {
  const rest = quietest(moves, from, until);
  const first = moves.filter(m => m.end > from && m.start < until).reduce((at, m) => Math.min(at, m.start), Infinity);
  const preRoll = rest.start <= from && rest.end <= first && rest.end < until;
  return preRoll && painted(layers, until - 1) > painted(layers, rest.end - 1) ? { start: until, end: until } : rest;
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
  /** The fresh readable lines: new words to read — a split line as one, an echo not again. */
  reads: ReadLine[];
  /** Each drawn layer's box with the camera's transform taken out — where things really sit. */
  world: Map<string, CanvasBox>;
  /** This shot brought the layer in or moved it — itself or through a parent. */
  entered: (id: string) => boolean;
  buried: Array<{ text: string; under: string }>;
  /** The objects where the shot rests, in world space. */
  units: Unit[];
  /** The same objects on the screen, and which of them the camera carries. */
  spaces: Spaces;
}

/**
 * A line a viewer reads, and when it lands: its own motion, its parents' and a
 * camera move that brings it into view are done. Found live: a line landed at
 * 11.8 s while header chips kept arriving until 13.15 s — timed from the shot's
 * last move, it "had 0.05 s to be read".
 */
interface Landing { id: string; words: number; settle: number; x: number; y: number }

/**
 * A text's drawn size: its font size times whatever scales it on the way to the
 * canvas. Not its box's width over its layer's: the box is the INK, so a short
 * line in a wide box came out a third of its size and was never read (A4).
 */
function drawnSize(b: CanvasBox): number {
  const l = b.layer as unknown as { style?: { font_size?: number } };
  return (l.style?.font_size ?? 16) * (b.scale ?? 1);
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
    const quiet = restOf(layers, moves, mark.at, until);
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
    // A split line is readable while any of its pieces is.
    for (const b of texts) if (readable.has(b.layer.id)) readable.add(blockOf(b.layer));
    const freshIds = new Set(fresh.map(b => b.layer.id));
    const inShot = moves.filter(m => m.end > mark.at && m.start < until);
    const lastEnd = (ms: Segment[]): number => ms.reduce((at, m) => Math.max(at, m.end), mark.at);
    const reads = readingLines(fresh.filter(b => readable.has(b.layer.id)).map((b): Shown => {
      // The camera is an ancestor of everything and moves on its own schedule;
      // its part is judged below, by whether it was already moving when the line landed.
      const by = new Set([b.layer.id, ...(up.get(b.layer.id) ?? [])].filter(id => id !== CAMERA_ID));
      // Its moves up to the rest: an exit after it is the line leaving, not landing (benchmark r5:
      // a quote "landed" at 9450 ms — its own fade-out — and read as 3 s short).
      const own = lastEnd(inShot.filter(m => by.has(m.id) && m.start <= t));
      // A pan that starts after the line landed is the camera leaving, not arriving.
      const camera = lastEnd(inShot.filter(m => m.id === CAMERA_ID && m.start <= own));
      return { id: b.layer.id, text: said(b.layer), block: blockOf(b.layer), settle: Math.max(own, camera), x: b.box.x, y: b.box.y, entered: entered(b.layer.id) };
    }));
    views.push({
      mark, until, t, texts, fresh, readable, reads,
      entered,
      buried: buriedTexts(flat, id => entered(id) || freshIds.has(id)),
      units: frameUnits(flat, canvas),
      world,
      spaces: { screen: new Map(frameUnits(frame, canvas).map(u => [u.id, u])), carried: id => (up.get(id) ?? []).includes(CAMERA_ID), frame: frameBox },
    });
    shownBefore = shown;
  });
  return views;
}

/**
 * The same words at the same size — an RGB split, a drop echo, or a letter of
 * a split title over a ghost of the whole title. Their overlap IS the effect
 * (benchmark r2: a chromatic split read as 24 "rest on top of each other"
 * notes). "Ship it" on "Ship it now" is still two lines on one spot.
 */
function echoes(a: Layer, b: Layer): boolean {
  const said = (l: Layer): string => {
    const c = (l as unknown as { content?: { value?: unknown } }).content?.value;
    return typeof c === 'string' ? c.toLowerCase().replace(/\s+/g, ' ').trim() : '';
  };
  const size = (l: Layer): number => (l as unknown as { style?: { font_size?: number } }).style?.font_size ?? 0;
  const piece = (l: Layer): boolean => typeof (l as unknown as { split_of?: unknown }).split_of === 'string';
  const x = said(a), y = said(b), sa = size(a), sb = size(b);
  if (!x || !y || !sa || !sb || Math.abs(sa - sb) > 0.1 * Math.max(sa, sb)) return false;
  return x === y || (piece(a) && y.includes(x)) || (piece(b) && x.includes(y));
}

/** Overlaps, edges, buried text and reading time, measured where each shot rests. */
function restNotes(layers: Layer[], canvas: { width: number; height: number }, marks: LintMark[], moves: Segment[], endMs: number, rests: Rest[]): LintNote[] {
  const notes: LintNote[] = [];
  const seenPairs = new Set<string>(), seenEdges = new Set<string>(), seenBuried = new Set<string>();
  const views = shotViews(layers, canvas, marks, moves, endMs);
  // Where everything was before anything moved — the camera's own pose left out, as at rest.
  const authored = frameUnits(layers.map(l => (l.id === CAMERA_ID ? ({ ...l, transform: undefined } as Layer) : l)), canvas);
  for (const v of views) {
    const { mark, t, texts } = v;
    for (const c of collisions(v.units, authored, v.entered, v.spaces)) {
      const key = [c.under, c.over].sort().join('+');
      if (seenPairs.has(key) || v.buried.some(b => b.text === c.under && b.under === c.over)) continue;
      seenPairs.add(key);
      notes.push({ kind: 'collision', shot: mark.id, at_ms: t, layers: [c.over, c.under],
        note: `In "${mark.id}", "${c.over}" comes to rest over ${Math.round(c.share * 100)}% of "${c.under}" at ${t}ms (of the smaller one) — they were apart as authored, so the motion cut one into the other. Move one clear, tuck it wholly behind or inside on purpose, or take one away before the other lands.` });
    }
    for (let p = 0; p < texts.length; p++) {
      for (let q = p + 1; q < texts.length; q++) {
        const A = texts[p], B = texts[q];
        if (!A || !B) continue;
        const key = [A.layer.id, B.layer.id].sort().join('+');
        const a = v.world.get(A.layer.id)?.box ?? A.box, b = v.world.get(B.layer.id)?.box ?? B.box;
        if (seenPairs.has(key) || overlapArea(a, b) < 0.15 * Math.min(area(a), area(b)) || echoes(A.layer, B.layer)) continue;
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
  const crowd = crowdNotes(views.map(v => ({ shot: v.mark.id, lines: v.reads })));
  return [...notes, ...readingNotes(views, endMs, rests), ...crowd];
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
      seen.note = { kind: 'reading', shot: r.shot, at_ms: r.settle, layers: seen.cut, short_ms: Math.round(late),
        note: `In "${r.shot}", "${r.id}" (${r.words} words, ~${need}ms at ${WPM} wpm) lands at ${r.settle}ms${start > r.settle ? `, is reached at ${start}ms after the lines before it` : ''} and leaves readable view at ${r.leave}ms — ${Math.round(late)}ms short.` };
    }
    worst.set(r.shot, seen);
  }
  return [...worst.values()].map(w => ({ ...w.note, layers: w.cut.slice(0, 8),
    note: w.cut.length > 1 ? `${w.note.note} ${w.cut.length - 1} more line(s) in this shot are cut short too.` : w.note.note }));
}

/** Links whose target is missing or does not move — the follower would sit still — and children turning about where their parent no longer is. */
function linkNotes(layers: Layer[]): LintNote[] {
  const ids = new Map<string, Node>();
  const index = (ls: Layer[]): void => { for (const l of ls as Node[]) { ids.set(l.id, l); if (Array.isArray(l.layers)) index(l.layers); } };
  index(layers);
  const notes: LintNote[] = [];
  for (const l of ids.values()) {
    if (!l.link) continue;
    // Name the layer the author linked, not the wrappers the ops made around it.
    let inner: Node = l;
    while (/_link\d*$/.test(inner.id) && inner.layers?.length === 1 && inner.layers[0]) inner = inner.layers[0] as Node;
    const who = inner.id;
    const target = ids.get(l.link.to);
    if (!target) notes.push({ kind: 'link', layers: [who], note: `"${who}" follows "${l.link.to}", which is not on this page.` });
    else if (!target.animation?.keyframes?.length && !target.link) notes.push({ kind: 'link', layers: [who, target.id], note: `"${who}" follows "${target.id}", which has no motion — so it never moves.` });
    else if (l.link.pivot) {
      // A parent's own pivot is read live; an anchor was measured when parented, a wrapper's when it was made.
      const pb = target.animation?.playback, was = l.link.pivot;
      const now = pb?.pivot ? null : target.link?.pivot ?? pivotOf(target, pb?.anchor);
      if (now && Math.hypot(now.x - was.x, now.y - was.y) > 1) notes.push({ kind: 'link', layers: [who, target.id],
        note: `"${who}" turns about (${was.x}, ${was.y}), where "${target.id}"'s anchor was when parented — it is now at (${Math.round(now.x)}, ${Math.round(now.y)}). Run op:parent again to re-seat it.` });
    }
  }
  // A parent that has since been parented, linked or wiggled moves in ways its child does not ride yet.
  for (const base of parentBases(layers)) {
    const who = base.layers?.[0]?.id ?? base.id, to = base.link?.to ?? '';
    if (chainOf(layers, base).inStep || notes.some(n => n.layers?.[0] === who)) continue;
    notes.push({ kind: 'link', layers: [who, to], note: `"${to}" rides motion "${who}" does not — it was parented, linked or wiggled after "${who}" was parented to it. Run op:parent on "${who}" again.` });
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
    ...restlessNotes(moves),
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
    const rest = restOf(layers, moves, m.at, until);
    const still = quietest([...moves, ...drifts], m.at, until);
    return [{ shot: m.id, at: m.at, until, t: Math.max(m.at, rest.end - 1), rest_ms: rest.end - rest.start, still_ms: still.end - still.start }];
  });
}
