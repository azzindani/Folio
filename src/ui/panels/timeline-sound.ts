/**
 * The soundtrack on the editor timeline — the page's clips as a waveform, and
 * the music's beats as ticks on the ruler and snap points for every drag.
 *
 * The file is measured in the browser with the beat detector op:beats runs on
 * the server (export/beat-detect.ts, placed by export/beat-place.ts), so the
 * ticks are the grid op:beats offers lengths on and diagnose's beat_cut
 * judges cuts against. Only a steady pulse gives beats to snap to.
 */

import type { DesignSpec } from '../../schema/types';
import { planScenes } from '../../export/scene-plan';
import { planSound, type SoundClip, type SoundDurations } from '../../export/audio-plan';
import { detectBeats } from '../../export/beat-detect';
import { beatsOnPiece } from '../../export/beat-place';

/** op:beats calls a pulse steady from here. */
const STEADY = 0.4;
/** The rate the detector works at — rhythm lives well under 5 kHz (audio-analyze.ts). */
const RATE = 11_025;

/** One file, measured: mono samples at RATE, its length, and its beats if the pulse is steady. */
export interface SoundAnalysis { samples: Float32Array; duration_ms: number; beats_ms: number[]; bpm: number }
/** A clip under this page, on the piece clock, and where the page starts on it. */
export type LaneClip = SoundClip & { page_start: number };

/** The clips sounding under page `pageIndex` (which runs `pageMs`), from the piece's own sound plan. */
export function laneClips(design: DesignSpec, pageIndex: number, pageMs: number, durations: SoundDurations = {}): LaneClip[] {
  const pages = design.pages ?? [];
  let start = 0, timeline = { total_ms: pageMs, scenes: pages[pageIndex] ? [{ page_id: pages[pageIndex].id, start_ms: 0 }] : [] };
  if (pages.length >= 2) {
    const plan = planScenes(design);
    start = plan.scenes.find(s => s.page_id === pages[pageIndex]?.id)?.start_ms ?? 0;
    timeline = { total_ms: plan.total_ms, scenes: plan.scenes.map(s => ({ page_id: s.page_id, start_ms: s.start_ms })) };
  }
  return planSound(design, timeline, durations).clips
    .filter(c => c.start_ms < start + pageMs && c.start_ms + c.length_ms > start)
    .map(c => ({ ...c, page_start: start }));
}

/** Where the clip's beats fall on the page's ruler. */
export function laneBeats(clip: LaneClip, a: SoundAnalysis, pageMs: number): number[] {
  return beatsOnPiece(clip, a.beats_ms, a.duration_ms).map(b => b - clip.page_start).filter(b => b >= 0 && b <= pageMs);
}

/** Loudest swing in each of `cols` columns over file ms [fromMs, toMs): 0–1. */
export function peaks(a: SoundAnalysis, fromMs: number, toMs: number, cols: number): number[] {
  const n = a.samples.length, out: number[] = [];
  for (let c = 0; c < cols; c++) {
    const i0 = Math.max(0, Math.floor(((fromMs + ((toMs - fromMs) * c) / cols) / 1000) * RATE));
    const i1 = Math.min(n, Math.ceil(((fromMs + ((toMs - fromMs) * (c + 1)) / cols) / 1000) * RATE));
    let m = 0;
    for (let i = i0; i < i1; i++) m = Math.max(m, Math.abs(a.samples[i] ?? 0));
    out.push(Math.min(1, m));
  }
  return out;
}

/** Channels mixed to mono and averaged down to RATE. */
export function monoAt(channels: Float32Array[], rate: number): Float32Array {
  const step = Math.max(1, rate / RATE), len = channels[0]?.length ?? 0;
  const out = new Float32Array(Math.floor(len / step));
  for (let o = 0; o < out.length; o++) {
    const i0 = Math.floor(o * step), i1 = Math.min(len, Math.floor((o + 1) * step));
    let sum = 0;
    for (let i = i0; i < i1; i++) for (const ch of channels) sum += ch[i] ?? 0;
    out[o] = sum / Math.max(1, (i1 - i0) * channels.length);
  }
  return out;
}

/** How a file is fetched and decoded — the browser's, or a test's. */
export interface SoundDeps { load: (src: string) => Promise<ArrayBuffer>; decode: (data: ArrayBuffer) => Promise<{ sampleRate: number; channels: Float32Array[] }> }

const measured = new Map<string, Promise<SoundAnalysis | null>>();

/** A file measured once per session; null when it cannot be fetched or decoded. */
export function analyse(src: string, deps: SoundDeps): Promise<SoundAnalysis | null> {
  const hit = measured.get(src);
  if (hit) return hit;
  const p = deps.load(src).then(deps.decode).then(({ sampleRate, channels }) => {
    const samples = monoAt(channels, sampleRate);
    const map = detectBeats(samples, RATE);
    return { samples, duration_ms: map.duration_ms, bpm: map.bpm, beats_ms: map.confidence >= STEADY ? map.beats_ms : [] };
  }, () => null);
  measured.set(src, p);
  return p;
}

const WAVE_COLS = 160;
const at = (ms: number, pageMs: number): number => Math.max(0, Math.min(1, ms / Math.max(1, pageMs))) * 100;
const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

/** One clip's waveform, over the stretch of the page it sounds in (a loop wraps through its file). */
function waveHTML(clip: LaneClip, a: SoundAnalysis | null | undefined, pageMs: number): string {
  const from = Math.max(0, clip.start_ms - clip.page_start), to = Math.min(pageMs, clip.start_ms + clip.length_ms - clip.page_start);
  if (to <= from) return '';
  const box = `position:absolute;top:2px;bottom:2px;left:${at(from, pageMs)}%;width:${Math.max(0.3, at(to, pageMs) - at(from, pageMs))}%`;
  if (!a) return `<div class="tl-wave tl-wave-pending" title="${esc(`${clip.src} — ${a === null ? 'could not be read here' : 'measuring…'}`)}" style="${box};background:var(--color-accent);opacity:.12;border-radius:2px"></div>`;
  const step = (to - from) / WAVE_COLS;
  const file = (pageMs0: number): number => {
    const f = pageMs0 + clip.page_start - clip.start_ms + clip.offset_ms;
    return clip.loop && a.duration_ms > 0 ? f % a.duration_ms : f;
  };
  const bars = Array.from({ length: WAVE_COLS }, (_, c) => {
    const f0 = file(from + step * c);
    const h = Math.max(0.04, peaks(a, f0, f0 + step, 1)[0] ?? 0) * 9;
    return `M${c + 0.5} ${(10 - h).toFixed(2)}V${(10 + h).toFixed(2)}`;
  }).join('');
  return `<svg class="tl-wave" viewBox="0 0 ${WAVE_COLS} 20" preserveAspectRatio="none" style="${box}"><title>${esc(clip.src)}</title>`
    + `<path d="${bars}" stroke="var(--color-accent)" stroke-width="0.7" fill="none" opacity=".75"/></svg>`;
}

/** The sound row: every clip under the page drawn as a waveform, and the beats as ticks. Empty when the page has no sound. */
export function soundRowHTML(lanes: Array<{ clip: LaneClip; analysis: SoundAnalysis | null | undefined }>, beats: number[], bpm: number | undefined, pageMs: number, headerW: number): string {
  if (!lanes.length) return '';
  const ticks = beats.map((b, i) => `<div class="tl-beat" style="position:absolute;top:0;bottom:0;left:${at(b, pageMs)}%;width:1px;`
    + `background:var(--color-text-muted);opacity:${i % 4 === 0 ? 0.55 : 0.22};pointer-events:none"></div>`).join('');
  return `
      <div class="tl-sound" style="display:flex;height:26px;border-bottom:1px solid var(--color-border)">
        <div style="width:${headerW}px;flex-shrink:0;display:flex;align-items:center;gap:6px;padding:0 8px;font-size:10px;color:var(--color-text-muted)"
             title="${esc(beats.length ? 'Beats of the soundtrack — every drag on the ruler snaps to them' : 'No steady beat to snap to')}">Sound${bpm ? `<span style="opacity:.7">${Math.round(bpm)} bpm</span>` : ''}</div>
        <div class="tl-sound-area" style="flex:1;position:relative;overflow:hidden">${lanes.map(l => waveHTML(l.clip, l.analysis, pageMs)).join('')}${ticks}</div>
      </div>`;
}

/** What the timeline draws for the page's sound, which files it still has to measure, and the beats to snap to. */
export interface SoundLane { html: string; beats: number[]; unmeasured: string[] }

/**
 * The sound row for page `pageIndex`, from what is measured so far (`known`:
 * a file absent is still to measure, null could not be read). A file's length
 * is known once measured, and an unlooped clip ends with its file.
 */
export function soundLane(design: DesignSpec | null, pageIndex: number, pageMs: number, known: ReadonlyMap<string, SoundAnalysis | null>, headerW: number): SoundLane {
  if (!design) return { html: '', beats: [], unmeasured: [] };
  const durations: SoundDurations = {};
  for (const [src, a] of known) if (a) durations[src] = a.duration_ms;
  let clips: LaneClip[] = [];
  try { clips = laneClips(design, pageIndex, pageMs, durations); } catch { return { html: '', beats: [], unmeasured: [] }; }
  const lanes = clips.map(clip => ({ clip, analysis: known.get(clip.src) }));
  // One grid to snap to: the first clip with a steady pulse, as op:beats and diagnose measure the soundtrack.
  const lead = lanes.find(l => !l.clip.scene && l.analysis?.beats_ms.length) ?? lanes.find(l => l.analysis?.beats_ms.length);
  const beats = lead?.analysis ? laneBeats(lead.clip, lead.analysis, pageMs).map(b => Math.round(b)) : [];
  return {
    html: soundRowHTML(lanes, beats, beats.length ? lead?.analysis?.bpm : undefined, pageMs, headerW),
    beats,
    unmeasured: [...new Set(clips.map(c => c.src).filter(src => !known.has(src)))],
  };
}
