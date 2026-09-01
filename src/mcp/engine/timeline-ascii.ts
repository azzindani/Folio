/**
 * The scene timeline as text — what `animation(op:timeline)` returns.
 *
 * The old view drew keyframe diamonds against the LONGEST single track, so a
 * staggered entrance at 800ms looked like it fired at 0, a loop and a
 * one-shot were indistinguishable, and nothing said how long the scene was.
 * This one is a Gantt: each track is a bar from its delay to its end, with
 * `◆` at keyframes, `∞` for loops, and a ruler in ms across the top.
 */

import type { Layer } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';

export interface SceneTrack {
  layer_id: string;
  label: string;
  kind: 'loop' | 'one-shot';
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  keyframes: number;
  channels: string[];
  easing?: string;
  anchor?: string;
}

const META = new Set(['t', 'easing', 'hold']);

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
      });
    }
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) for (const k of kids) visit(k);
  };
  for (const l of layers) visit(l);
  return out;
}

/** Longest one-shot end, or the longest loop cycle when nothing is one-shot. */
export function sceneLength(tracks: SceneTrack[]): number {
  return tracks.reduce((m, t) => Math.max(m, t.end_ms), 0);
}

export function renderSceneASCII(layers: Layer[], tracks: SceneTrack[], width = 56): string {
  if (tracks.length === 0) return '(no animated layers)';
  const total = Math.max(1, sceneLength(tracks));
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
    const a = col(t.start_ms), b = col(Math.min(t.end_ms, total));
    for (let i = a; i <= b; i++) bar[i] = t.kind === 'loop' ? '∞' : '═';
    for (const ms of frameTimes(t.layer_id)) bar[col(ms)] = '◆';
    const label = (t.label + ' ').padEnd(13).slice(0, 13);
    lines.push(`${label}|${bar.join('')}| ${t.channels.join(',')}`);
  }
  return lines.join('\n');
}
