// The Speed section — a speed that changes over the clip (a ramp: slow into a moment and back out), and the
// freeze frame. Ramp keys sit on the clip's own clock; the file is played at the area under the curve
// (animation/video-time.ts), the canvas plays it at the speed it has now, the export integrates the same line.

import type { ClipLayer } from '../../animation/video-clip';
import { rampKeys, speedAt, MIN_SPEED, MAX_SPEED } from '../../animation/video-time';
import { fromSceneTime } from '../../animation/clock-time';
import { motionHost } from '../../editor/motion-host';
import { writeClip, type ClipEnv } from './clip-commit';
import { bindClip, block, button, note, num, type ClipSet, type Section } from './clip-controls';
import { freezeAtPlayhead, holdMs, setHoldMs, MIN_HOLD_MS, MAX_HOLD_MS } from './clip-freeze';

/** A key within this of another IS that key — adding at the playhead edits it rather than stacking one beside it. */
const SNAP_MS = 40;
type Key = { at_ms: number; speed: number };
const round = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;

/** The speed curve as a small picture: time across, speed up on a log scale (0.1× at the bottom, 8× at the top). */
export function rampGraph(keys: Key[], span: number): string {
  const W = 200, H = 44, y = (s: number): number => H - ((Math.log2(s) - Math.log2(MIN_SPEED)) / (Math.log2(MAX_SPEED) - Math.log2(MIN_SPEED))) * H;
  const x = (t: number): number => (t / Math.max(1, span)) * W;
  const pts = keys.length ? [{ at_ms: 0, speed: keys[0]?.speed ?? 1 }, ...keys, { at_ms: span, speed: keys[keys.length - 1]?.speed ?? 1 }] : [];
  const line = pts.map(k => `${x(k.at_ms).toFixed(1)},${y(k.speed).toFixed(1)}`).join(' ');
  return `<svg class="clip-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Speed over the clip">`
    + `<line x1="0" x2="${W}" y1="${y(1).toFixed(1)}" y2="${y(1).toFixed(1)}" class="clip-graph-base"/>`
    + `<polyline points="${line}" class="clip-graph-line"/>${keys.map(k => `<circle cx="${x(k.at_ms).toFixed(1)}" cy="${y(k.speed).toFixed(1)}" r="2.5" class="clip-graph-key"/>`).join('')}</svg>`;
}

/** How long the clip plays, scene ms: the graph's width. */
const spanOf = (keys: Key[]): number => Math.max(1000, (keys[keys.length - 1]?.at_ms ?? 0) * 1.25);

/** The clip's own clock at the playhead: scene time with any precomp clocks taken off, minus where the clip starts. */
function localNow(layer: ClipLayer): number {
  const p = motionHost();
  return Math.max(0, Math.round(fromSceneTime(p?.time ?? 0, p?.rows()?.get(layer.id)?.clocks ?? []) - (Number(layer.in) || 0)));
}

export function rampSection(layer: ClipLayer, env: ClipEnv): Section {
  const keys = rampKeys(layer.video);
  const still = layer.video?.still === true;
  const rows = keys.map((k, i) =>
    `<div class="clip-row"><input type="number" class="clip-input" data-prop="clip.ramp-at:${i}" data-clip="ramp-at:${i}" min="0" step="0.05" value="${round(k.at_ms / 1000, 3)}" aria-label="Key ${i + 1} time (s)">`
    + `<span class="clip-unit">s</span><input type="number" class="clip-input" data-prop="clip.ramp-speed:${i}" data-clip="ramp-speed:${i}" min="${MIN_SPEED}" max="${MAX_SPEED}" step="0.05" value="${round(k.speed, 3)}" aria-label="Key ${i + 1} speed">`
    + `<span class="clip-unit">×</span><button type="button" class="btn btn-sm" data-clip-act="ramp-del:${i}" title="Remove this key">×</button></div>`).join('');
  const html = block('Speed ramp & freeze',
    (keys.length ? rampGraph(keys, spanOf(keys)) + rows : note(still ? 'A freeze has no speed to ramp.' : 'One speed for the whole clip. Add keys to slow into a moment and back out.'))
    + `<div class="clip-row"><span class="prop-label"></span>${button('ramp-add', '◆ Speed key here', 'Add a key at the playhead, at the speed there', still)}${button('ramp-clear', 'Clear', 'Back to one speed', !keys.length)}</div>`
    + (keys.length ? note('With keys, the speed in the Clip section no longer applies — the curve is the speed.') : '')
    + num('hold', 'Hold', holdMs(), MIN_HOLD_MS, MAX_HOLD_MS, 100, 'ms')
    + `<div class="clip-row"><span class="prop-label"></span>${button('freeze', '❄ Freeze at playhead', 'Hold this frame, and move everything after it later', still)}</div>`
    + note('Freeze opens time at the playhead: the frame is held and the rest of the scene moves later (one undo step).'), !keys.length);

  const write = (next: Key[]): void => { writeClip(env, { ramp: next.length ? next : null }); };
  const set: ClipSet = (key, value) => {
    if (key === 'hold') { setHoldMs(value as number); return; }
    const l = env.state.findLayer(env.layerId) as ClipLayer | undefined;
    const m = /^ramp-(at|speed):(\d+)$/.exec(key);
    if (!l || !m) return;
    const now = rampKeys(l.video), i = Number(m[2]);
    if (!now[i]) return;
    now[i] = m[1] === 'at' ? { ...now[i], at_ms: Math.max(0, Math.round((value as number) * 1000)) } : { ...now[i], speed: value as number };
    write(now.sort((a, b) => a.at_ms - b.at_ms));
  };
  return {
    html,
    bind: root => bindClip(root, env, set, act => {
      const l = env.state.findLayer(env.layerId) as ClipLayer | undefined;
      if (!l) return;
      if (act === 'ramp-clear') write([]);
      else if (act.startsWith('ramp-del:')) write(rampKeys(l.video).filter((_, i) => i !== Number(act.slice(9))));
      else if (act === 'ramp-add') {
        const now = rampKeys(l.video), at = localNow(l), here = round(speedAt(l.video, at), 3);
        const kept = now.filter(k => Math.abs(k.at_ms - at) > SNAP_MS);
        // The first key also pins the start, so the ramp begins at the speed the clip had.
        write([...(!now.length && at > SNAP_MS ? [{ at_ms: 0, speed: here }] : []), ...kept, { at_ms: at, speed: here }].sort((a, b) => a.at_ms - b.at_ms));
      } else if (act === 'freeze') {
        const b = root.querySelector<HTMLButtonElement>('[data-clip-act="freeze"]');
        if (b) { b.disabled = true; b.textContent = 'Freezing…'; }
        void freezeAtPlayhead(env.state, env.layerId).then(() => env.refresh());
      }
    }),
  };
}

