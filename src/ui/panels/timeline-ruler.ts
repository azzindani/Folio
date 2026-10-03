// The ruler: the top row of the sequence view. Marks follow the zoom (timeline-zoom.ts), a click or drag on it
// moves the playhead (`.tl-scrub-area` — the name the panel's drag and the specs look for).

import { rulerTicks } from './timeline-zoom';
import { HEADER_W } from './timeline-track-view';

/** The ruler row for a scene of `duration` ms drawn at `pxPerMs`. Sticky to the top of the sheet; its label cell sticks to the left. */
export function rulerHTML(duration: number, pxPerMs: number): string {
  const span = Math.max(1, duration);
  const marks = rulerTicks(duration, pxPerMs).map(t => {
    const left = `left:${((t.ms / span) * 100).toFixed(4)}%`;
    return `<i class="tl-tick${t.label ? ' tl-tick-major' : ''}" style="${left}"></i>`
      + (t.label ? `<span class="tl-tick-label" style="${left}">${t.label}</span>` : '');
  }).join('');
  return `<div class="tl-ruler-row"><div class="tl-label tl-ruler-label" style="width:${HEADER_W}px"></div>`
    + `<div class="tl-scrub-area" title="Click or drag to move the playhead">${marks}<i class="tl-ruler-head"></i></div></div>`;
}
