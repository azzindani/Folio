/**
 * Editing time on the ruler — a layer's in/out points and the shot markers.
 *
 * The timeline drew both but only op:span and op:markers could change them.
 * Here: drag a band edge to move a layer's in or out point (back to the start,
 * or out to the end, removes it — a layer that lives the whole scene shows its
 * handles at the ends of its row); drag a marker to move it, click it to jump,
 * double-click it to rename, right-click to remove; + (at the playhead) or a
 * double-click on the strip adds one. Every drag snaps to 0, the end, the playhead, the markers and the music's beats. Times
 * are written in each layer's OWN clock (a precomp child's in point is local),
 * and a marker is a label on the scene clock: moving one retimes nothing.
 */

import type { StateManager } from '../../editor/state';
import type { DesignSpec } from '../../schema/types';
import type { TimeMarkers } from '../../animation/types';
import type { RowTiming } from '../../editor/motion-pose';
import { fromSceneTime } from '../../animation/clock-time';
import { usableMarkerName } from '../../animation/marker-name';

export interface TimelineEditContext {
  state: StateManager;
  duration: () => number;
  playhead: () => number;
  rows: () => Map<string, RowTiming> | null;
  markers: () => TimeMarkers;
  /** Show a time while it is dragged (the panel's timecode). */
  preview: (ms: number) => void;
  seek: (ms: number) => void;
  /** The soundtrack's beats on this page's ruler — more snap points. */
  beats?: () => number[];
}

const SNAP_PX = 6;
const DRAG_PX = 3;
/** The shortest life a drag leaves a layer, ms. */
const MIN_LIFE = 50;

/** Scene ms under a pointer: snapped to the nearest snap point within SNAP_PX, else to 10 ms. */
export function msAt(clientX: number, area: { left: number; width: number }, duration: number, snaps: number[]): number {
  const w = Math.max(1, area.width);
  const px = Math.min(w, Math.max(0, clientX - area.left));
  let best: number | null = null, bestPx = SNAP_PX + 1;
  for (const s of snaps) {
    const d = Math.abs((s / Math.max(1, duration)) * w - px);
    if (d <= SNAP_PX && d < bestPx) { best = s; bestPx = d; }
  }
  return best ?? Math.round(((px / w) * duration) / 10) * 10;
}

/**
 * One edge of a layer's life, dragged to `scene` ms, as the field to write:
 * through the layer's clocks, kept MIN_LIFE clear of the other edge; at the
 * start (in) or the end (out) of the ruler the point is removed.
 */
export function edgePatch(edge: 'in' | 'out', scene: number, row: Pick<RowTiming, 'window' | 'clocks'>, duration: number): { in?: number; out?: number } {
  const w = row.window ?? { in: 0, out: Infinity };
  if (edge === 'in') {
    const t = Number.isFinite(w.out) ? Math.min(scene, w.out - MIN_LIFE) : scene;
    return { in: t <= 0 ? undefined : Math.round(fromSceneTime(t, row.clocks)) };
  }
  const t = Math.max(scene, w.in + MIN_LIFE);
  return { out: t >= duration ? undefined : Math.round(fromSceneTime(t, row.clocks)) };
}

/** The design with `markers` written where the MCP keeps them: the page on screen, else the poster root. */
export function withMarkers(design: DesignSpec, pageIndex: number, markers: TimeMarkers): DesignSpec {
  const sorted = Object.fromEntries(Object.entries(markers).sort((a, b) => a[1] - b[1]));
  const empty = Object.keys(sorted).length === 0;
  const put = <T extends { markers?: TimeMarkers }>(host: T): T => {
    const { markers: _old, ...rest } = host;
    void _old;
    return (empty ? rest : { ...rest, markers: sorted }) as T;
  };
  const pages = design.pages;
  if (pages && pages.length > 0) {
    const i = Math.min(Math.max(pageIndex, 0), pages.length - 1);
    return { ...design, pages: pages.map((p, j) => (j === i ? put(p) : p)) };
  }
  return put(design);
}

/** A marker name not yet taken: shot1, shot2, … */
export function freshMarkerName(markers: TimeMarkers): string {
  let n = Object.keys(markers).length + 1;
  while (`shot${n}` in markers) n++;
  return `shot${n}`;
}

/** Why `name` cannot be used, or null when it can. */
export function markerNameProblem(name: string, markers: TimeMarkers, current?: string): string | null {
  if (!usableMarkerName(name)) return 'Letters, digits, _ and - only, starting with a letter; not ending in -digits.';
  if (name !== current && name in markers) return `"${name}" is already a marker.`;
  return null;
}

function writeMarkers(ctx: TimelineEditContext, next: TimeMarkers): void {
  const { design, currentPageIndex } = ctx.state.get();
  if (!design) return;
  ctx.state.beginInteraction();   // one undo step
  ctx.state.set('design', withMarkers(design, currentPageIndex, next), false);
}

/**
 * Follow one pointer from `el` across `area`. Under DRAG_PX of travel it is a
 * click (`done(null)`); past it every move reports the snapped scene ms.
 * Shared with timeline-drag.ts.
 */
export function follow(e: PointerEvent, el: HTMLElement, area: HTMLElement, ctx: Pick<TimelineEditContext, 'duration' | 'preview'>, snaps: number[],
  move: (ms: number) => void, done: (ms: number | null) => void, offsetPx = 0): void {
  e.preventDefault();
  e.stopPropagation();
  const rect = area.getBoundingClientRect();
  const x0 = e.clientX;
  let ms: number | null = null;
  try { el.setPointerCapture(e.pointerId); } catch { /* a synthetic event has no live pointer */ }
  const onMove = (ev: PointerEvent): void => {
    if (ms === null && Math.abs(ev.clientX - x0) < DRAG_PX) return;
    // `offsetPx`: the grip's distance from what is placed — a bar is dropped by its start, not by where it was held.
    ms = msAt(ev.clientX - offsetPx, rect, ctx.duration(), snaps);
    el.classList.add('tl-dragging');
    ctx.preview(ms);
    move(ms);
  };
  const end = (ev: PointerEvent): void => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
    el.classList.remove('tl-dragging');
    try { el.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
    // A cancelled gesture (the page scrolled it away) is neither a drag nor a click.
    if (ev.type !== 'pointercancel') done(ms);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/** A small text field over the strip at `leftPct`; Enter commits a valid name, Escape or blur cancels. */
function nameField(strip: HTMLElement, leftPct: number, value: string, markers: TimeMarkers, current: string | undefined, commit: (name: string) => void): void {
  strip.querySelectorAll('.tl-marker-input').forEach(n => n.remove());
  const input = document.createElement('input');
  input.className = 'tl-marker-input';
  input.value = value;
  input.style.left = `${leftPct}%`;
  let closed = false;
  const close = (): void => { closed = true; input.remove(); };
  input.addEventListener('keydown', ev => {
    ev.stopPropagation();   // Space and Delete belong to the field, not the editor's shortcuts
    if (ev.key === 'Escape') { close(); return; }
    if (ev.key !== 'Enter') return;
    const name = input.value.trim();
    const problem = markerNameProblem(name, markers, current);
    if (problem) { input.title = problem; input.classList.add('tl-invalid'); return; }
    close();
    commit(name);
  });
  input.addEventListener('blur', () => { if (!closed) close(); });
  strip.appendChild(input);
  input.focus();
  input.select();
}

export function bindTimelineEdits(body: HTMLElement, ctx: TimelineEditContext): void {
  const markerTimes = (except?: string): number[] => [...Object.entries(ctx.markers()).filter(([n]) => n !== except).map(([, t]) => t), ...(ctx.beats?.() ?? [])];

  body.querySelectorAll<HTMLElement>('.tl-life-h').forEach(h => {
    const area = h.closest<HTMLElement>('.tl-track-area');
    const id = h.dataset['layerId'] ?? '';
    const edge = h.dataset['edge'] === 'out' ? 'out' : 'in';
    // Never "add a keyframe here" — that is what a click on the track underneath means.
    h.addEventListener('click', e => e.stopPropagation());
    h.addEventListener('pointerdown', e => {
      const row = ctx.rows()?.get(id);
      if (!area || !row) return;
      const shift = edge === 'in' ? 0 : 7;
      follow(e, h, area, ctx, [0, ctx.duration(), ctx.playhead(), ...markerTimes()],
        ms => { h.style.left = `calc(${(ms / Math.max(1, ctx.duration())) * 100}% - ${shift}px)`; },
        ms => { if (ms !== null) ctx.state.updateLayers(new Map([[id, edgePatch(edge, ms, row, ctx.duration())]]), true); });
    });
  });

  const strip = body.querySelector<HTMLElement>('.tl-marker-area');
  if (!strip) return;
  body.querySelectorAll<HTMLElement>('.tl-marker').forEach(m => {
    const name = m.dataset['name'] ?? '';
    m.addEventListener('click', e => e.stopPropagation());
    m.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      follow(e, m, strip, ctx, [0, ctx.playhead(), ...markerTimes(name)],
        ms => { m.style.left = `${(ms / Math.max(1, ctx.duration())) * 100}%`; },
        ms => {
          const markers = ctx.markers();
          if (ms === null) ctx.seek(markers[name] ?? 0);
          else writeMarkers(ctx, { ...markers, [name]: ms });
        });
    });
    m.addEventListener('dblclick', e => {
      e.stopPropagation();
      const markers = ctx.markers();
      nameField(strip, ((markers[name] ?? 0) / Math.max(1, ctx.duration())) * 100, name, markers, name, next => {
        if (next === name) return;
        const { [name]: at, ...rest } = markers;
        writeMarkers(ctx, { ...rest, [next]: at ?? 0 });
      });
    });
    m.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      const { [name]: _gone, ...rest } = ctx.markers();
      void _gone;
      writeMarkers(ctx, rest);
    });
  });
  // The reliable way in: a marker at the playhead, whatever the labels cover.
  body.querySelector<HTMLElement>('.tl-marker-add')?.addEventListener('click', () => {
    const markers = ctx.markers();
    const at = Math.round(ctx.playhead());
    nameField(strip, (at / Math.max(1, ctx.duration())) * 100, freshMarkerName(markers), markers, undefined,
      name => writeMarkers(ctx, { ...ctx.markers(), [name]: at }));
  });
  strip.addEventListener('dblclick', e => {
    if (e.target !== strip) return;
    const markers = ctx.markers();
    const at = msAt(e.clientX, strip.getBoundingClientRect(), ctx.duration(), [0, ctx.playhead(), ...markerTimes()]);
    nameField(strip, (at / Math.max(1, ctx.duration())) * 100, freshMarkerName(markers), markers, undefined,
      name => writeMarkers(ctx, { ...ctx.markers(), [name]: at }));
  });
}
