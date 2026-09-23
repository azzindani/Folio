// Long enough on screen to read (phase 2, A1b).
//
// The scene plan times a scene's words against the scene's length. But a
// scene is not read all at once: a line that fades in at 5.4 s of a 6 s scene,
// or a caption swapped out after 800 ms, can be unreadable in a scene that is
// long enough on paper. This walks the scene's clock and, for each text of a
// few words, finds the longest stretch it is actually on screen — at least half
// opaque, mostly inside the canvas — and holds it against the time its words
// take at the scene plan's reading rate. Numbers only; the fix (hold it longer,
// bring it in sooner, cut words) stays the model's call.
import type { Layer } from '../../schema/types';
import { layersAt } from '../../export/gif-frames';
import { drawnBox } from '../../export/frame-geometry';
import { READ_WPM, MONO, wordCount } from '../../export/scene-plan';
import { layerText } from '../../schema/layer-text';
import { IDENTITY, poseAffine, compose, mapBox, type Affine } from './layout-pose';

export interface ReadingTime { id: string; words: number; on_ms: number; needs_ms: number }

/** Fewer words than this are glanced, not read — a label, a number, a kicker. */
const MIN_WORDS = 3;
const SEEN = 0.5;
const kids = (l: Layer): Layer[] | null => { const k = (l as { layers?: unknown }).layers; return Array.isArray(k) ? (k as Layer[]) : null; };

/** Text leaves worth timing: a few words, not split letters, not a monospace label. */
function readable(layers: Layer[], out = new Map<string, number>()): Map<string, number> {
  for (const l of layers) {
    const inner = kids(l);
    if (inner) { readable(inner, out); continue; }
    const o = l as unknown as { split_of?: unknown; style?: { font_family?: unknown } };
    if (l.type !== 'text' || typeof o.split_of === 'string') continue;
    const fam = o.style?.font_family;
    if (typeof fam === 'string' && MONO.test(fam)) continue;
    const words = wordCount(layerText(l));
    if (words >= MIN_WORDS) out.set(l.id, words);
  }
  return out;
}

/** Ids of the texts on screen in one posed frame: opacity carried down, pose applied, mostly inside the canvas. */
function onScreen(layers: Layer[], W: number, H: number, at: Affine = IDENTITY, alpha = 1, out = new Set<string>()): Set<string> {
  for (const l of layers) {
    const o = l as unknown as { opacity?: unknown; visible?: unknown };
    const a = alpha * (typeof o.opacity === 'number' ? o.opacity : 1);
    if (o.visible === false || a < SEEN) continue;
    const pose = poseAffine(l);
    const here = pose ? compose(at, pose) : at;
    const inner = kids(l);
    if (inner) { onScreen(inner, W, H, here, a, out); continue; }
    if (l.type !== 'text') continue;
    const b = drawnBox(l);
    if (!b || b.width <= 0 || b.height <= 0) continue;
    const g = mapBox(here, { x: b.x, y: b.y, w: b.width, h: b.height });
    const ix = Math.max(0, Math.min(W, g.x + g.w) - Math.max(0, g.x)), iy = Math.max(0, Math.min(H, g.y + g.h) - Math.max(0, g.y));
    if (ix * iy >= 0.5 * g.w * g.h) out.add(l.id);
  }
  return out;
}

/** Each readable text's longest time on screen over [0, endMs), against the time its words need. */
export function readingTimes(layers: Layer[], endMs: number, W: number, H: number): ReadingTime[] {
  const words = readable(layers);
  if (!words.size || endMs <= 0) return [];
  const step = Math.max(100, Math.ceil(endMs / 200));
  const run = new Map<string, number>(), best = new Map<string, number>();
  for (let t = 0; t < endMs; t += step) {
    const seen = onScreen(layersAt(layers, t), W, H);
    for (const id of words.keys()) {
      const r = seen.has(id) ? (run.get(id) ?? 0) + Math.min(step, endMs - t) : 0;
      run.set(id, r);
      best.set(id, Math.max(best.get(id) ?? 0, r));
    }
  }
  return [...words].map(([id, n]) => ({ id, words: n, on_ms: best.get(id) ?? 0, needs_ms: Math.round((n / READ_WPM) * 60_000) }));
}

/** The texts gone before they can be read, as sentences. A text never on screen is not one of them. */
export function readingNotes(r: ReadingTime[]): string[] {
  const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
  return r.filter(x => x.on_ms > 0 && x.on_ms < x.needs_ms)
    .map(x => `"${x.id}" is on screen ${secs(x.on_ms)} at most but carries ${x.words} words (~${secs(x.needs_ms)} to read).`);
}
