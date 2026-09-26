/**
 * Captured frames of script components (phase 3, S7) — how a raster render
 * draws one. resvg draws no <foreignObject>, so the server captures the
 * component in headless Chrome (mcp/engine/script-capture.ts) and the renderer
 * draws that picture instead (layer-renderers-script.ts).
 *
 * The time a frame shows comes from the layer itself: the frame sampler stamps
 * every script layer with the page time it is posed at (`script_t`), so a
 * deck's scenes, a still and a GIF frame all ask for the right moment. An
 * unstamped layer — the editor, the HTML export — stays a live component.
 */

import type { Layer, ScriptLayer } from '../schema/types';
import { buildScriptDoc } from './script-runtime';

type Stamped = ScriptLayer & { script_t?: number };

/** The component's own clock at page time t: its duration clamps it, `loop` wraps it. */
export function componentTime(l: ScriptLayer, t: number): number {
  const d = l.duration;
  const at = Math.max(0, t);
  if (typeof d !== 'number' || d <= 0) return at;
  return l.loop ? at % d : Math.min(at, d);
}

/** A key for what the component draws: its whole document (code, size, seed). */
export function scriptKey(l: ScriptLayer): string {
  const doc = buildScriptDoc(l, true);
  let h = 2166136261;
  for (let i = 0; i < doc.length; i++) h = Math.imul(h ^ doc.charCodeAt(i), 16777619);
  return `${(h >>> 0).toString(36)}.${doc.length}`;
}

const frames = new Map<string, string>();
const MAX_FRAMES = 4000;
const frameKey = (l: ScriptLayer, t: number): string => `${scriptKey(l)}@${Math.round(componentTime(l, t) * 1000) / 1000}`;

/** The captured picture (a data: URI) of the component at page time t, if there is one. */
export const scriptFrame = (l: ScriptLayer, t: number): string | undefined => frames.get(frameKey(l, t));

/** Keep a captured picture; returns its key, for dropScriptFrames. */
export function setScriptFrame(l: ScriptLayer, t: number, uri: string): string {
  if (frames.size >= MAX_FRAMES) frames.clear();
  const key = frameKey(l, t);
  frames.set(key, uri);
  return key;
}

/** Forget pictures a render has drawn (their SVG already carries them). */
export function dropScriptFrames(keys: string[]): void { for (const k of keys) frames.delete(k); }

export function clearScriptFrames(): void { frames.clear(); }

/** Every script layer under `layers` stamped with page time t; the same array when there is none. */
export function stampScripts(layers: Layer[], t: number): Layer[] {
  let changed = false;
  const out = layers.map((l): Layer => {
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    const inner = Array.isArray(kids) ? stampScripts(kids, t) : kids;
    if (l.type === 'script') { changed = true; return { ...l, script_t: t } as Layer; }
    if (inner !== kids) { changed = true; return { ...l, layers: inner } as Layer; }
    return l;
  });
  return changed ? out : layers;
}

/** The stamped script layers under `layers` — what a render will ask the capture for. */
export function stampedScripts(layers: Layer[], out: { layer: ScriptLayer; t: number }[] = []): { layer: ScriptLayer; t: number }[] {
  for (const l of layers) {
    const at = (l as Stamped).script_t;
    if (l.type === 'script' && typeof at === 'number') out.push({ layer: l as ScriptLayer, t: at });
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) stampedScripts(kids, out);
  }
  return out;
}

/** Whether a design carries any script component at all (the capture costs nothing otherwise). */
export function hasScripts(layers: Layer[]): boolean {
  return layers.some(l => l.type === 'script' || hasScripts((l as Layer & { layers?: Layer[] }).layers ?? [])
    || hasScripts((l as Layer & { gallery?: { template?: Layer[] } }).gallery?.template ?? []));
}

/**
 * A still render (op:frame, a preview, a PNG) runs twice when it holds script
 * components: first collecting the frames it lacks, then — once they are
 * captured — for real (mcp/engine/script-capture.ts withScriptCapture). While
 * collecting, an unstamped component is drawn at t=0, the poster.
 */
let collecting: { layer: ScriptLayer; t: number }[] | null = null;

/** Run a synchronous render in raster mode; also returns the frames it lacked. */
export function collectScripts<T>(run: () => T): { result: T; missing: { layer: ScriptLayer; t: number }[] } {
  const prev = collecting;
  const missing: { layer: ScriptLayer; t: number }[] = [];
  collecting = missing;
  try { return { result: run(), missing }; } finally { collecting = prev; }
}

/** The page time a raster render draws this component at; undefined when it stays live (editor, HTML). */
export function scriptTimeOf(l: ScriptLayer): number | undefined {
  return typeof l.script_t === 'number' ? l.script_t : collecting ? 0 : undefined;
}

/** A frame the render asked for and the cache did not have. */
export function noteMissingScript(l: ScriptLayer, t: number): void { collecting?.push({ layer: l, t }); }
