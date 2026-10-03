/**
 * The clip track — footage edited the way a video editor edits it.
 *
 * A video layer's row shows the clip as a block from where it starts playing to
 * where it stops, with a grip on each end: drag the start to skip (or bring
 * back) footage — in point, file offset and length move together, so the frames
 * that stay keep their place — and the end to change its length. ✂ Split cuts
 * the clip under the playhead in two (S); Del takes a clip off its main track and
 * closes the gap. Edges snap to the playhead, markers, beats and the other clips'
 * edges. Every edit goes through the same arithmetic animation(op:video) uses
 * (animation/video-clip.ts) and is one undo step.
 */

import type { StateManager } from '../../editor/state';
import type { Layer } from '../../schema/types';
import type { TimeMarkers } from '../../animation/types';
import type { RowTiming } from '../../editor/motion-pose';
import { fromSceneTime, toSceneTime } from '../../animation/clock-time';
import { summarize, trimClip, splitClip, type ClipLayer } from '../../animation/video-clip';
import { predecessorOf, DEFAULT_TRANSITION_MS, type ClipTransition } from '../../animation/clip-transition';
import { follow } from './timeline-edit';
import { writeClip } from './clip-commit';
import { openBlock } from './clip-controls';
import { lookHTML, type ClipLook } from './timeline-filmstrip';

/** A clip that starts where another ends — a join — with the transition into it, if any. */
export interface ClipJoin { transition?: ClipTransition }
/** What dresses a clip block beyond the clip itself: the join into it, and the shot cuts measured in its footage (scene ms). */
export interface ClipExtras { join?: ClipJoin; shots?: number[] }
export type ExtrasOf = (l: Layer) => ClipExtras | undefined;

/** Every join in the tree: for each list of layers, the video layers that start where another one in it stops. */
export function clipJoins(layers: Layer[]): Map<string, ClipJoin> {
  const out = new Map<string, ClipJoin>();
  const walk = (list: Layer[]): void => {
    for (const l of list) {
      if (l.type === 'video' && predecessorOf(list, l)) {
        const t = (l as ClipLayer).video?.transition;
        out.set(l.id, t ? { transition: t } : {});
      }
      const kids = (l as Layer & { layers?: Layer[] }).layers;
      if (Array.isArray(kids)) walk(kids);
    }
  };
  walk(layers);
  return out;
}

const TYPE_NAME: Record<string, string> = { crossfade: 'Crossfade', dip: 'Dip to colour', wipe: 'Wipe', push: 'Push' };

/** The marker on a join: filled when a transition plays over it, hollow when the cut is hard. Click opens it (see bindClipJoins). */
function joinMarkup(l: Layer, join: ClipJoin, left: number): string {
  const t = join.transition;
  const title = t ? `${TYPE_NAME[t.type] ?? t.type} · ${t.duration_ms ?? DEFAULT_TRANSITION_MS} ms — click to edit it`
    : 'A hard cut — click to add a crossfade';
  return `<div class="tl-join${t ? ' tl-join-on' : ''}" data-layer-id="${esc(l.id)}" role="button" tabindex="0" aria-label="${esc(title)}" title="${esc(title)}"`
    + ` style="position:absolute;top:50%;left:${left}%"></div>`;
}

/** A clip block's thumbnails and waveform, asked for with how much of the ruler the block spans (%). */
export type LookFor = (l: Layer, widthPct: number) => ClipLook | undefined;

export interface ClipEditContext {
  state: StateManager;
  duration: () => number;
  playhead: () => number;
  rows: () => Map<string, RowTiming> | null;
  markers: () => TimeMarkers;
  preview: (ms: number) => void;
  beats?: () => number[];
  /** Shot cuts measured in a clip's footage, scene ms — its edges snap to them. */
  shots?: (id: string) => number[];
}

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const pct = (ms: number, duration: number): number => (Math.max(0, ms) / Math.max(1, duration)) * 100;

/** Where a clip plays on the scene clock: [from, until), until at the end of the scene when it is unknown. */
export function clipSpan(l: Layer, row: Pick<RowTiming, 'clocks'> | undefined, duration: number): { from: number; until: number } {
  const s = summarize(l as ClipLayer);
  const clocks = row?.clocks ?? [];
  return { from: toSceneTime(s.plays.from, clocks), until: s.plays.until === null ? duration : toSceneTime(s.plays.until, clocks) };
}

/** A tick on the block at each shot cut inside it (scene ms → % of the block). */
function shotTicks(shots: number[] | undefined, from: number, until: number): string {
  const span = Math.max(1, until - from);
  return (shots ?? []).filter(ms => ms > from && ms < until)
    .map(ms => `<i class="tl-shot" style="left:${(((ms - from) / span) * 100).toFixed(3)}%" title="${esc(`A shot cut at ${(ms / 1000).toFixed(2)}s`)}"></i>`).join('');
}

/** A video row's clip block with its two trim grips, dressed with its footage and sound when `look` gives them. */
export function clipMarkup(l: Layer, row: RowTiming | undefined, duration: number, trackH: number, look?: LookFor, extras?: ClipExtras): string {
  const { from, until } = clipSpan(l, row, duration);
  const s = summarize(l as ClipLayer);
  const file = `file ${(s.file.from / 1000).toFixed(1)}–${s.file.to === null ? 'end' : `${(s.file.to / 1000).toFixed(1)}s`}${s.speed !== 1 ? ` at ${s.speed}×` : ''}`;
  const left = pct(from, duration), width = Math.max(0.6, pct(until, duration) - left);
  const grip = (edge: 'start' | 'end'): string =>
    `<div class="tl-clip-h" data-edge="${edge}" data-layer-id="${esc(l.id)}" title="${esc(edge === 'start' ? 'Drag to skip footage at the start (or bring it back)' : 'Drag to change where the clip ends')}"`
    + ` style="${edge === 'start' ? 'left:0' : 'right:0'}"></div>`;
  return `<div class="tl-clip" data-layer-id="${esc(l.id)}" title="${esc(`${l.id} — ${file}`)}"`
    + ` style="position:absolute;top:3px;height:${trackH - 6}px;left:${left}%;width:${width}%">`
    + `${lookHTML(look?.(l, width))}${shotTicks(extras?.shots, from, until)}<span class="tl-clip-label">${esc(file)}</span>${grip('start')}${grip('end')}</div>`
    + (extras?.join ? joinMarkup(l, extras.join, left) : '');
}

/** The clip trimmed so `edge` lands on scene time `ms` — through the clip's clocks. */
export function trimmedAt(l: Layer, edge: 'start' | 'end', ms: number, row: Pick<RowTiming, 'clocks'> | undefined): Partial<ClipLayer> {
  const t = trimClip(l as ClipLayer, edge, fromSceneTime(ms, row?.clocks ?? []));
  return edge === 'start' ? { in: t.in, video: t.video } : { video: t.video, ...(typeof t.out === 'number' ? { out: t.out } : {}) };
}

/** A unique id for the second half of a cut. */
function nextId(state: StateManager, base: string): string {
  let n = 2;
  while (state.findLayer(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Cut `id` (or the topmost clip under the playhead) at the playhead. False when no clip plays there. */
export function splitAtPlayhead(state: StateManager, playhead: number, rows: Map<string, RowTiming> | null, id?: string): boolean {
  const candidates = id ? [state.findLayer(id)] : [...flatVideo(state.getCurrentLayers())].reverse();
  for (const l of candidates) {
    if (!l || l.type !== 'video') continue;
    const row = rows?.get(l.id);
    const halves = splitClip(l as ClipLayer, fromSceneTime(playhead, row?.clocks ?? []), nextId(state, l.id));
    if (halves.length === 2) { state.replaceLayer(l.id, halves as Layer[]); return true; }
  }
  return false;
}

/** Every clip in the tree, groups opened. */
export function flatVideo(layers: Layer[]): Layer[] {
  return layers.flatMap(l => {
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    return l.type === 'video' ? [l] : Array.isArray(kids) ? flatVideo(kids) : [];
  });
}

export function bindClipEdits(body: HTMLElement, ctx: ClipEditContext): void {
  const snaps = (id: string): number[] => [0, ctx.duration(), ctx.playhead(), ...Object.values(ctx.markers()), ...(ctx.beats?.() ?? []),
    ...clipEdges(ctx.state.getCurrentLayers(), id, ctx.rows(), ctx.duration()), ...(ctx.shots?.(id) ?? [])];
  body.querySelectorAll<HTMLElement>('.tl-clip-h').forEach(h => {
    const area = h.closest<HTMLElement>('.tl-track-area');
    const block = h.closest<HTMLElement>('.tl-clip');
    const id = h.dataset['layerId'] ?? '';
    const edge = h.dataset['edge'] === 'end' ? 'end' : 'start';
    h.addEventListener('click', e => e.stopPropagation());
    h.addEventListener('pointerdown', e => {
      const layer = ctx.state.findLayer(id);
      if (!area || !block || !layer) return;
      const row = ctx.rows()?.get(id);
      const span = clipSpan(layer, row, ctx.duration());
      follow(e, h, area, ctx, snaps(id),
        ms => {
          const a = edge === 'start' ? ms : span.from, b = edge === 'end' ? ms : span.until;
          block.style.left = `${pct(Math.min(a, b), ctx.duration())}%`;
          block.style.width = `${Math.max(0.6, pct(Math.max(a, b), ctx.duration()) - pct(Math.min(a, b), ctx.duration()))}%`;
        },
        ms => { if (ms !== null) ctx.state.updateLayers(new Map([[id, trimmedAt(layer, edge, ms, row) as Record<string, unknown>]]), true); });
    });
  });
}

/** Click a join: the clip after it is selected and its Transition section opens — a hard cut first gets a crossfade (one undo step). */
export function bindClipJoins(body: HTMLElement, ctx: ClipEditContext): void {
  body.querySelectorAll<HTMLElement>('.tl-join').forEach(m => {
    const id = m.dataset['layerId'] ?? '';
    const go = (): void => {
      const layer = ctx.state.findLayer(id) as ClipLayer | undefined;
      if (!layer) return;
      if (!layer.video?.transition) writeClip({ state: ctx.state, layerId: id, refresh: () => undefined }, { clip_transition: { type: 'crossfade' } });
      openBlock('Transition');
      ctx.state.set('selectedLayerIds', [id], false);
      document.querySelector<HTMLElement>('.rpanel-tab[data-tab="properties"]')?.click();
    };
    m.addEventListener('pointerdown', e => e.stopPropagation());
    m.addEventListener('click', e => { e.stopPropagation(); go(); });
    m.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

/** Clips laid end to end (each starts within a frame of where the last one stops) — the main track a clip may belong to. */
const SEAM_MS = 40;

export function mainTrackOf(clips: Layer[], id: string): Layer[] {
  const sorted = [...clips].sort((a, b) => summarize(a as ClipLayer).plays.from - summarize(b as ClipLayer).plays.from);
  const runs: Layer[][] = [];
  // A clip joins the run that ends where it starts — a picture-in-picture between two cuts does not break the track.
  for (const c of sorted) {
    const from = summarize(c as ClipLayer).plays.from;
    const run = runs.find(r => {
      const end = summarize(r[r.length - 1] as ClipLayer).plays.until;
      return end !== null && Math.abs(from - end) <= SEAM_MS;
    });
    if (run) run.push(c); else runs.push([c]);
  }
  return runs.find(r => r.some(c => c.id === id)) ?? [];
}

/**
 * The clip `id` dropped with its start at scene `dropMs`. On a main track it goes
 * before the first clip whose middle lies past the drop, and the run is laid end to
 * end again from where it began; alone, it simply moves. Patches in/out only — what plays of each file is untouched.
 */
export function moveClip(clips: Layer[], id: string, dropMs: number): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const run = mainTrackOf(clips, id);
  const moved = run.find(c => c.id === id) ?? clips.find(c => c.id === id);
  if (!moved) return out;
  const len = (c: Layer): number => { const s = summarize(c as ClipLayer); return Math.max(1, (s.plays.until ?? s.plays.from) - s.plays.from); };
  const place = (c: Layer, at: number): void => {
    const s = summarize(c as ClipLayer);
    if (Math.round(at) === s.plays.from) return;
    out.set(c.id, { in: Math.max(0, Math.round(at)), ...(typeof (c as ClipLayer).out === 'number' ? { out: Math.max(0, Math.round(at + len(c))) } : {}) });
  };
  if (run.length < 2) { place(moved, Math.max(0, dropMs)); return out; }
  const start = summarize(run[0] as ClipLayer).plays.from;
  const others = run.filter(c => c.id !== id);
  // It goes before the first clip whose middle (where it stands now) lies past the drop.
  const index = others.filter(c => summarize(c as ClipLayer).plays.from + len(c) / 2 < dropMs).length;
  const order = [...others.slice(0, index), moved, ...others.slice(index)];
  let at = start;
  for (const c of order) { place(c, at); at += len(c); }
  return out;
}

/**
 * Clips taken off their main track with the gap closed — a video editor's ripple delete.
 * The in/out patches that move the rest of each run up by what left it; a clip alone on
 * its track leaves its gap (nothing follows it). Only the track moves: what plays of
 * each file is untouched, and the rest of the scene keeps its times.
 */
export function rippleDelete(clips: Layer[], ids: readonly string[]): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const gone = new Set(ids), done = new Set<string>();
  for (const id of ids) {
    const run = mainTrackOf(clips, id);
    if (run.length < 2 || done.has(run[0]?.id ?? '')) continue;
    done.add(run[0]?.id ?? '');
    let shift = 0;
    for (const c of run) {
      const s = summarize(c as ClipLayer);
      if (gone.has(c.id)) { shift += Math.max(0, (s.plays.until ?? s.plays.from) - s.plays.from); continue; }
      if (!shift) continue;
      const out_ = (c as ClipLayer).out;
      out.set(c.id, { in: Math.max(0, s.plays.from - shift), ...(typeof out_ === 'number' ? { out: Math.max(0, out_ - shift) } : {}) });
    }
  }
  return out;
}

/** Where the other clips start and stop on the scene clock — what a clip's edges snap to. */
export function clipEdges(layers: Layer[], except: string, rows: Map<string, RowTiming> | null, duration: number): number[] {
  return flatVideo(layers).filter(l => l.id !== except).flatMap(l => {
    const { from, until } = clipSpan(l, rows?.get(l.id), duration);
    return [from, until];
  });
}

/** Drag a clip block by its body: reorder on its main track, or move it (timeline row clocks are ignored — top-level clips). */
export function bindClipMoves(body: HTMLElement, ctx: ClipEditContext): void {
  body.querySelectorAll<HTMLElement>('.tl-clip').forEach(block => {
    const area = block.closest<HTMLElement>('.tl-track-area');
    const id = block.dataset['layerId'] ?? '';
    block.addEventListener('click', e => e.stopPropagation());
    block.addEventListener('pointerdown', e => {
      if (e.button !== 0 || (e.target as HTMLElement).classList.contains('tl-clip-h') || !area) return;
      const grabPx = e.clientX - block.getBoundingClientRect().left;
      follow(e, block, area, ctx, [0, ctx.playhead(), ...Object.values(ctx.markers()), ...clipEdges(ctx.state.getCurrentLayers(), id, ctx.rows(), ctx.duration())],
        ms => { block.style.left = `${pct(ms, ctx.duration())}%`; },
        ms => {
          if (ms === null) return;
          const patches = moveClip(flatVideo(ctx.state.getCurrentLayers()), id, ms);
          if (patches.size) ctx.state.updateLayers(patches, true);
        }, grabPx);
    });
  });
}
