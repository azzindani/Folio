/**
 * Captions on the piece's timeline — the design's cues (piece time) and each
 * scene's captions (scene time), resolved into one ordered list.
 *
 * Pure and browser-safe, like the sound plan: the export burns these cues into
 * its frames and Play all draws the same ones. The engine times nothing the
 * model timed. A scene caption with no times shares its scene by word count.
 * It NOTES what a viewer would struggle with: text faster than ~17 characters
 * a second, a caption on screen under a second, two captions at once.
 */

import type { CaptionCue, DesignSpec } from '../schema/types';

export interface PlannedCaption extends CaptionCue { id: string; scene?: string }
export interface CaptionPlan { cues: PlannedCaption[]; notes: string[] }
export interface CaptionTimeline { total_ms: number; scenes: Array<{ page_id: string; start_ms: number; length_ms: number }> }

/** Comfortable subtitle reading speed for adults, characters per second. */
export const MAX_CPS = 17;
export const MIN_CAPTION_MS = 1000;

const wordsIn = (s: string): number => Math.max(1, (s.match(/\S+/g) ?? []).length);
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const quote = (s: string): string => `"${s.length > 32 ? `${s.slice(0, 31)}…` : s}"`;
const ms = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);

function sceneCaptions(spec: DesignSpec, scene: CaptionTimeline['scenes'][number]): PlannedCaption[] {
  const page = (spec.pages ?? []).find(p => p.id === scene.page_id);
  const lines = (page?.captions ?? []).filter(c => typeof c.text === 'string' && c.text.trim() !== '');
  const out: PlannedCaption[] = [];
  let cursor = 0;
  lines.forEach((c, j) => {
    const start = ms(c.at) ?? cursor;
    let length = ms(c.duration) ?? 0;
    if (!length) {
      // Share the time up to the next caption with a set start (or the scene's end) by word count.
      let k = j + 1;
      while (k < lines.length && ms(lines[k]?.at) === undefined) k++;
      const until = k < lines.length ? ms(lines[k]?.at) ?? scene.length_ms : scene.length_ms;
      const run = lines.slice(j, k);
      const fixed = run.reduce((n, x) => n + (ms(x.duration) ?? 0), 0);
      const shared = run.filter(x => !ms(x.duration)).reduce((n, x) => n + wordsIn(x.text), 0);
      length = Math.round((Math.max(0, until - start - fixed) * wordsIn(c.text)) / Math.max(1, shared));
    }
    cursor = start + length;
    out.push({ id: `${scene.page_id}-caption-${j + 1}`, scene: scene.page_id, text: c.text.trim(), from_ms: scene.start_ms + start, to_ms: scene.start_ms + start + length });
  });
  return out;
}

export function planCaptions(spec: DesignSpec, timeline: CaptionTimeline): CaptionPlan {
  const notes: string[] = [];
  const total = Math.max(0, timeline.total_ms);
  const all: PlannedCaption[] = [];
  (spec.captions?.cues ?? []).forEach((c, i) => {
    if (typeof c.text !== 'string' || !c.text.trim()) return;
    all.push({ id: `cue-${i + 1}`, text: c.text.trim(), from_ms: ms(c.from_ms) ?? 0, to_ms: ms(c.to_ms) ?? 0 });
  });
  for (const scene of timeline.scenes) all.push(...sceneCaptions(spec, scene));
  all.sort((a, b) => a.from_ms - b.from_ms);

  const cues: PlannedCaption[] = [];
  for (const c of all) {
    if (c.to_ms <= c.from_ms) { notes.push(`Caption ${quote(c.text)} ends before it starts, so it was left out.`); continue; }
    if (c.from_ms >= total) { notes.push(`Caption ${quote(c.text)} starts at ${secs(c.from_ms)}, after the piece ends at ${secs(total)}.`); continue; }
    const cue = { ...c, to_ms: Math.min(c.to_ms, total) };
    const prev = cues[cues.length - 1];
    if (prev && cue.from_ms < prev.to_ms) {
      notes.push(`Captions ${quote(prev.text)} and ${quote(cue.text)} overlap by ${prev.to_ms - cue.from_ms}ms; the later one takes the screen at ${secs(cue.from_ms)}.`);
      prev.to_ms = cue.from_ms;
      if (prev.to_ms <= prev.from_ms) cues.pop();
    }
    cues.push(cue);
  }
  for (const c of cues) {
    const on = c.to_ms - c.from_ms;
    const cps = c.text.length / (on / 1000);
    if (cps > MAX_CPS) notes.push(`Caption ${quote(c.text)} needs ${Math.round(cps)} characters a second over ${secs(on)}, above the ~${MAX_CPS} most viewers read. Give it more time or fewer words.`);
    else if (on < MIN_CAPTION_MS) notes.push(`Caption ${quote(c.text)} is on screen ${secs(on)}; under ${secs(MIN_CAPTION_MS)} a caption flashes past.`);
  }
  return { cues, notes };
}

/** The caption on screen at piece time t, if any. */
export function captionAt(plan: CaptionPlan, t: number): PlannedCaption | undefined {
  for (let i = plan.cues.length - 1; i >= 0; i--) {
    const c = plan.cues[i];
    if (c && c.from_ms <= t && t < c.to_ms) return c;
  }
  return undefined;
}
