/**
 * The scene timeline as text — what `animation(op:timeline)` returns.
 *
 * The old view drew keyframe diamonds against the LONGEST single track, so a
 * staggered entrance at 800ms looked like it fired at 0, a loop and a
 * one-shot were indistinguishable, and nothing said how long the scene was.
 * This one is a Gantt: each track is a bar from its delay to its end, with
 * `◆` at keyframes, `∞` for loops, `░` for a script component playing, and a
 * ruler in ms across the top. An endless loop runs to the end of the piece.
 */

import type { Layer } from '../../schema/types';
import type { AnimationSpec, TimeMarkers } from '../../animation/types';
import { windowOf } from '../../animation/lifespan';

export interface SceneTrack {
  layer_id: string;
  label: string;
  kind: 'loop' | 'one-shot' | 'script';
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  keyframes: number;
  channels: string[];
  easing?: string;
  anchor?: string;
  /** A loop with no set number of passes: it plays to the end of the piece. */
  endless?: boolean;
}

const META = new Set(['t', 'easing', 'hold', 'ambient']);

/** Flatten a layer tree into scene tracks, in document order. */
export function sceneTracks(layers: Layer[]): SceneTrack[] {
  const out: SceneTrack[] = [];
  const visit = (l: Layer): void => {
    const anim = (l as Layer & { animation?: AnimationSpec }).animation;
    const frames = anim?.keyframes;
    if (frames && frames.length > 0) {
      const pb = anim.playback;
      const span = Math.max(...frames.map(k => k.t)) - Math.min(...frames.map(k => k.t));
      const duration = pb?.duration ?? (span > 0 ? span : 1000);
      const start = Math.max(0, pb?.delay ?? 0);
      const loop = pb?.loop === true;
      const cycles = loop ? (pb?.iterations && pb.iterations > 0 ? pb.iterations : (pb?.direction === 'alternate' ? 2 : 1)) : 1;
      const channels = new Set<string>();
      for (const k of frames) for (const key of Object.keys(k)) if (!META.has(key) && k[key] !== undefined) channels.add(key);
      out.push({
        layer_id: l.id,
        label: (l as { label?: string }).label ?? l.id,
        kind: loop ? 'loop' : 'one-shot',
        start_ms: start,
        end_ms: start + duration * cycles,
        duration_ms: duration,
        keyframes: frames.length,
        channels: [...channels],
        ...(pb?.easing ? { easing: String(pb.easing) } : {}),
        ...(pb?.anchor ? { anchor: pb.anchor } : {}),
        ...(loop && !(pb?.iterations && pb.iterations > 0) ? { endless: true } : {}),
      });
    }
    // A script component draws on the scene clock: its own duration, or the whole piece.
    if (l.type === 'script') {
      const s = l as Layer & { duration?: unknown; loop?: unknown };
      const d = typeof s.duration === 'number' && s.duration > 0 ? s.duration : 0;
      out.push({ layer_id: l.id, label: (l as { label?: string }).label ?? l.id, kind: 'script', start_ms: 0, end_ms: d, duration_ms: d,
        keyframes: 0, channels: ['drawn'], ...(s.loop === true || d === 0 ? { endless: true } : {}) });
    }
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) for (const k of kids) visit(k);
  };
  for (const l of layers) visit(l);
  return out;
}

/** Every layer that exists for only part of the scene, and when. */
export function lifeWindowList(layers: Layer[]): Array<{ layer_id: string; in: number; out?: number }> {
  const out: Array<{ layer_id: string; in: number; out?: number }> = [];
  const visit = (ls: Layer[]): void => {
    for (const l of ls) {
      const w = windowOf(l);
      if (w) out.push({ layer_id: l.id, in: Math.round(w.in), ...(Number.isFinite(w.out) ? { out: Math.round(w.out) } : {}) });
      const kids = (l as Layer & { layers?: Layer[] }).layers;
      if (Array.isArray(kids)) visit(kids);
    }
  };
  visit(layers);
  return out;
}

/** Longest one-shot end, or the longest loop cycle when nothing is one-shot. */
export function sceneLength(tracks: SceneTrack[]): number {
  return tracks.reduce((m, t) => Math.max(m, t.end_ms), 0);
}

export function renderSceneASCII(layers: Layer[], tracks: SceneTrack[], width = 56, markers: TimeMarkers = {}, length = 0): string {
  if (tracks.length === 0) return '(no animated layers)';
  // The piece's own length (op:scene length_ms) — found live: scene_ms said 8400 and the drawing 6000.
  const total = Math.max(1, sceneLength(tracks), length, ...Object.values(markers));
  const col = (ms: number): number => Math.min(width - 1, Math.max(0, Math.round((ms / total) * (width - 1))));

  // Ruler: tick every ~quarter, labelled in ms.
  const ruler = Array<string>(width).fill(' ');
  for (let q = 0; q <= 4; q++) {
    const ms = Math.round((total * q) / 4);
    const label = `${ms}`;
    const c = Math.min(width - label.length, col(ms));
    for (let i = 0; i < label.length; i++) ruler[c + i] = label[i];
  }
  const lines: string[] = [`Scene ${total}ms · ${tracks.length} track${tracks.length === 1 ? '' : 's'}`, `${''.padEnd(14)}${ruler.join('')}`];
  // Markers under the ruler: ▼ at each, its name after it where there is room.
  const marks = Object.entries(markers).sort((a, b) => a[1] - b[1]);
  if (marks.length) {
    const row = Array<string>(width).fill(' ');
    for (const [name, ms] of marks) {
      const c = col(ms);
      row[c] = '▼';
      for (let i = 0; i < name.length && c + 1 + i < width && row[c + 1 + i] === ' '; i++) row[c + 1 + i] = name[i] ?? ' ';
    }
    lines.push(`${'markers'.padEnd(14)}${row.join('')}`);
  }

  const frameTimes = (id: string): number[] => {
    let found: number[] = [];
    const visit = (l: Layer): void => {
      if (l.id === id) {
        const a = (l as Layer & { animation?: AnimationSpec }).animation;
        found = (a?.keyframes ?? []).map(k => k.t + (a?.playback?.delay ?? 0));
      }
      const kids = (l as Layer & { layers?: Layer[] }).layers;
      if (Array.isArray(kids)) for (const k of kids) visit(k);
    };
    for (const l of layers) visit(l);
    return found;
  };

  for (const t of tracks) {
    const bar = Array<string>(width).fill('·');
    const a = col(t.start_ms), b = col(t.endless ? total : Math.min(t.end_ms, total));
    for (let i = a; i <= b; i++) bar[i] = t.kind === 'script' ? '░' : t.kind === 'loop' ? '∞' : '═';
    for (const ms of frameTimes(t.layer_id)) bar[col(ms)] = '◆';
    const label = (t.label + ' ').padEnd(13).slice(0, 13);
    lines.push(`${label}|${bar.join('')}| ${t.channels.join(',')}`);
  }
  return lines.join('\n');
}
