/**
 * The timeline's rows as HTML, on the scene clock the export plays.
 *
 * A row used to be keyframe diamonds at their raw `t`: a track delayed by a
 * stagger drew at 0, a precomp child drew on its local clock, a layer with an
 * in/out window drew no window at all, and a link follower drew nothing. Here a
 * row carries, from the resolved timeline (RowTiming): the keyframes where they
 * PLAY, the band a windowed layer is on screen, the stretch its track moves
 * (dashed while it loops) and, for a follower, the leader's keys it replays.
 */

import type { DesignSpec, Layer } from '../../schema/types';
import type { Keyframe, TimeMarkers } from '../../animation/types';
import type { RowTiming } from '../../editor/motion-pose';

export const TRACK_H = 32;       // px per track row
export const HEADER_W = 120;     // px left-side label area
export const KF_RADIUS = 5;      // keyframe diamond half-size

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

/**
 * A timecode, always `s.mmm`.
 *
 * Round FIRST. This only ever saw whole milliseconds from the scrub slider
 * until the player started driving it from requestAnimationFrame, which hands
 * over fractional times: 163.799999976 % 1000 padded to three characters is
 * already three, so it printed verbatim and the readout became
 * "0.163.799999976s" — two decimal points, thirteen digits, and wide enough to
 * shove the rest of the toolbar out of the panel.
 */
export function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0));
  return `${Math.floor(total / 1000)}.${String(total % 1000).padStart(3, '0')}s`;
}

/** The markers of the page on screen — a page's own, else the design's. */
export function markersOf(design: DesignSpec | null, pageIndex: number): TimeMarkers {
  if (!design) return {};
  const page = design.pages?.[pageIndex];
  return (page?.markers ?? design.markers ?? {}) as TimeMarkers;
}

/** A position on the ruler, % of the scene. */
const at = (ms: number, duration: number): number => Math.max(0, Math.min(1, ms / Math.max(1, duration))) * 100;

const diamond = (left: number, extra: string, attrs: string, title: string): string =>
  `<div ${attrs} title="${esc(title)}" style="position:absolute;left:calc(${left.toFixed(3)}% - ${KF_RADIUS}px);`
  + `top:${TRACK_H / 2 - KF_RADIUS}px;width:${KF_RADIUS * 2}px;height:${KF_RADIUS * 2}px;box-sizing:border-box;`
  + `border-radius:2px;transform:rotate(45deg);${extra}"></div>`;

/** One layer's row. `timing` is absent until the sampler loads; the row then draws keyframes at their raw t. */
export function trackHTML(layer: Layer, timing: RowTiming | undefined, duration: number, depth: number): string {
  const keyframes = (layer.animation?.keyframes ?? []) as Keyframe[];
  const parts: string[] = [];

  const w = timing?.window;
  if (w) {
    const out = Number.isFinite(w.out) ? w.out : duration;
    parts.push(`<div class="tl-window" title="${esc(`on screen ${fmtMs(w.in)} – ${Number.isFinite(w.out) ? fmtMs(w.out) : 'end'}`)}"`
      + ` style="position:absolute;top:3px;bottom:3px;left:${at(w.in, duration)}%;width:${Math.max(0.4, at(out, duration) - at(w.in, duration))}%;`
      + 'background:var(--color-accent);opacity:.14;border-radius:3px;pointer-events:none"></div>');
  }
  // In/out handles (timeline-edit.ts): on the band's edges, or waiting at the ends of a row that lives the whole scene.
  if (timing) {
    const inIdle = !w || w.in <= 0, outIdle = !w || !Number.isFinite(w.out);
    const handle = (edge: 'in' | 'out', pct: number, idle: boolean, title: string): string =>
      `<div class="tl-life-h${idle ? ' tl-idle' : ''}" data-edge="${edge}" data-layer-id="${esc(layer.id)}" title="${esc(title)}"`
      + ` style="left:calc(${pct}% - ${edge === 'in' ? 0 : 7}px)"></div>`;
    parts.push(
      handle('in', w ? at(w.in, duration) : 0, inIdle, `${layer.id} appears${inIdle ? ' from the start' : ` at ${fmtMs(w?.in ?? 0)}`} — drag to set its in point; back to the start removes it`),
      handle('out', w && Number.isFinite(w.out) ? at(w.out, duration) : 100, outIdle, `${layer.id} ${outIdle ? 'stays to the end' : `leaves at ${fmtMs(w?.out ?? 0)}`} — drag to set its out point; out to the end removes it`),
    );
  }

  if (timing && timing.end > timing.start) {
    const end = Number.isFinite(timing.end) ? timing.end : duration;
    const fill = timing.loop
      ? 'repeating-linear-gradient(90deg,var(--color-accent) 0 4px,transparent 4px 8px)'
      : 'var(--color-accent)';
    parts.push(`<div class="tl-span${timing.loop ? ' tl-loop' : ''}" style="position:absolute;top:${TRACK_H / 2 - 1}px;height:2px;`
      + `left:${at(timing.start, duration)}%;width:${at(end, duration) - at(timing.start, duration)}%;background:${fill};opacity:.45;pointer-events:none"></div>`);
  }

  keyframes.forEach((kf, i) => {
    const ease = String((kf as unknown as Record<string, unknown>)['easing'] ?? '');
    const scene = timing?.keys[i] ?? kf.t;
    const shift = Math.abs(scene - kf.t) > 0.5 ? ` (plays at ${fmtMs(scene)})` : '';
    parts.push(diamond(at(scene, duration), `background:${ease ? 'var(--color-text)' : 'var(--color-accent)'};cursor:pointer`,
      `class="tl-keyframe" data-layer-id="${esc(layer.id)}" data-t="${kf.t}" data-easing="${esc(ease)}"`,
      `${fmtMs(kf.t)}${shift}${ease ? ` · ${ease}` : ''} — click to set easing, right-click to delete`));
  });

  // A follower owns no keyframes: it replays its leader's, a beat late. Hollow, and not editable here.
  const link = timing?.link;
  for (const g of timing?.ghosts ?? []) {
    parts.push(diamond(at(g, duration), 'border:1.5px solid var(--color-accent);background:transparent;pointer-events:none',
      'class="tl-ghost"', link ? `follows ${link.to} +${link.lag}ms` : fmtMs(g)));
  }

  const badges = [timing?.loop ? '⟲' : '', link ? `↳ ${link.to}` : '', timing?.clocks.length ? '⏱' : ''].filter(Boolean).join(' ');
  return `
      <div class="tl-track" style="display:flex;height:${TRACK_H}px;border-bottom:1px solid var(--color-border)">
        <div style="width:${HEADER_W}px;flex-shrink:0;display:flex;align-items:center;gap:4px;
                    padding:0 8px 0 ${8 + depth * 12}px;font-size:11px;color:var(--color-text);overflow:hidden;white-space:nowrap"
             title="${esc(layer.id)}${link ? ` — follows ${esc(link.to)} +${link.lag}ms` : ''}">
          ${depth ? '<span style="opacity:.45">└</span>' : ''}<span style="overflow:hidden;text-overflow:ellipsis">${esc(layer.id)}</span>${badges ? `<span style="opacity:.5">${esc(badges)}</span>` : ''}
        </div>
        <div class="tl-track-area" data-layer-id="${esc(layer.id)}"
          style="flex:1;position:relative;cursor:crosshair;background:var(--color-surface-2)">
          ${parts.join('')}
        </div>
      </div>`;
}

/**
 * The shot strip: every marker on the ruler (click jumps, drag moves,
 * double-click renames, right-click removes). Drawn even with no markers —
 * double-clicking the strip is how the first one is added.
 */
export function markerStripHTML(markers: TimeMarkers, duration: number): string {
  const entries = Object.entries(markers)
    .filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]))
    .sort((a, b) => a[1] - b[1]);
  const hint = entries.length ? '' : '<span class="tl-marker-hint">double-click to mark a shot</span>';
  const ticks = entries.map(([name, ms]) =>
    `<button type="button" class="tl-marker" data-name="${esc(name)}" data-ms="${ms}" title="${esc(`${name} · ${fmtMs(ms)} — click to jump, drag to move, double-click to rename, right-click to remove`)}"`
    + ` style="position:absolute;left:${at(ms, duration)}%;top:0;bottom:0;border:0;border-left:2px solid var(--color-text-muted);`
    + 'background:none;padding:0 0 0 3px;font-size:10px;line-height:20px;color:var(--color-text-muted);cursor:pointer;white-space:nowrap">'
    + `${esc(name)}</button>`).join('');
  return `
      <div class="tl-markers" style="display:flex;height:20px;border-bottom:1px solid var(--color-border)">
        <div style="width:${HEADER_W}px;flex-shrink:0;display:flex;align-items:center;padding:0 8px;font-size:10px;color:var(--color-text-muted)">Shots</div>
        <div class="tl-marker-area" title="Double-click to add a shot marker" style="flex:1;position:relative;overflow:hidden">${hint}${ticks}</div>
      </div>`;
}
