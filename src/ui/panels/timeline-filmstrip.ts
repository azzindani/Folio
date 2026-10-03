/**
 * A clip block's picture: thumbnails of its footage along the block and its
 * sound as a waveform under them — the clip track read at a glance, as in a
 * video editor.
 *
 * Frames are grabbed in the browser from the same file the canvas plays (one
 * hidden <video> per file, seeked in turn, drawn small onto a canvas); the sound
 * is the timeline's own measurement (timeline-sound.ts). Both are cached by file
 * and moment, so a trim or a redraw asks only for what it has not seen.
 */

import type { Layer } from '../../schema/types';
import { summarize, type ClipLayer } from '../../animation/video-clip';
import { peaks, type SoundAnalysis } from './timeline-sound';

/** What a block shows: a thumbnail per slot (undefined while it loads, null when it cannot), and its waveform. */
export interface ClipLook { thumbs: Array<string | null | undefined>; wave: number[] | null }
/** How a frame is grabbed — the browser's, or a test's. */
export interface FrameDeps { grab(src: string, ms: number, h: number): Promise<string | null> }

/** The file moments a block shows, one per thumbnail (about one per 5% of the ruler), rounded to 100 ms so a small trim reuses them. */
export function stripTimes(l: Layer, widthPct: number): number[] {
  const s = summarize(l as ClipLayer);
  const n = Math.max(1, Math.min(10, Math.round(widthPct / 5)));
  const from = s.file.from, to = s.file.to ?? from;
  return Array.from({ length: n }, (_, i) => Math.round((from + ((to - from) * (i + 0.5)) / n) / 100) * 100);
}

/** The clip's waveform over the part of the file it plays — `cols` peaks 0–1 — or null when it is muted or not measured. */
export function clipWave(l: Layer, a: SoundAnalysis | null | undefined, cols = 48): number[] | null {
  const s = summarize(l as ClipLayer);
  if (!a || s.muted || s.file.to === null || s.file.to <= s.file.from) return null;
  return peaks(a, s.file.from, s.file.to, cols);
}

/** The strip and the waveform inside a block, under its label and grips. */
export function lookHTML(look: ClipLook | undefined): string {
  if (!look) return '';
  const imgs = look.thumbs.map(u => (u ? `<img src="${u}" alt="">` : '<span></span>')).join('');
  const bars = look.wave?.map((p, c) => `M${c + 0.5} ${(10 - Math.max(0.06, p) * 10).toFixed(2)}V10`).join('') ?? '';
  const wave = look.wave
    ? `<svg class="tl-clip-wave" viewBox="0 0 ${look.wave.length} 10" preserveAspectRatio="none"><path d="${bars}"/></svg>`
    : '';
  return `<div class="tl-clip-strip">${imgs}</div>${wave}`;
}

/** Resolve once the element fires `ok`; reject on `error` or after `ms`. */
function once(el: HTMLVideoElement, ok: string, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void): void => { clearTimeout(timer); el.removeEventListener(ok, onOk); el.removeEventListener('error', onErr); fn(); };
    const onOk = (): void => done(resolve);
    const onErr = (): void => done(() => reject(new Error('video error')));
    const timer = setTimeout(() => done(() => reject(new Error('timeout'))), ms);
    el.addEventListener(ok, onOk);
    el.addEventListener('error', onErr);
  });
}

async function frameAt(el: HTMLVideoElement, ms: number, h: number): Promise<string | null> {
  if (el.readyState < 1) await once(el, 'loadedmetadata');
  const t = Math.max(0, Math.min(ms / 1000, (Number.isFinite(el.duration) ? el.duration : ms / 1000) - 0.05));
  if (Math.abs(el.currentTime - t) > 0.001 || el.readyState < 2) {
    el.currentTime = t;
    await once(el, 'seeked');
  }
  const vw = el.videoWidth, vh = el.videoHeight;
  if (!vw || !vh) return null;
  const c = document.createElement('canvas');
  c.height = h;
  c.width = Math.max(1, Math.round((h * vw) / vh));
  const g = c.getContext('2d');
  if (!g) return null;
  g.drawImage(el, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

/** The browser's grabber: one hidden, muted <video> per file, its seeks queued one after another. */
export function browserFrames(url: (src: string) => string): FrameDeps {
  const files = new Map<string, { el: HTMLVideoElement; queue: Promise<unknown> }>();
  return {
    grab(src, ms, h) {
      let f = files.get(src);
      if (!f) {
        const el = document.createElement('video');
        el.muted = true;
        el.preload = 'auto';
        el.playsInline = true;
        el.src = url(src);
        f = { el, queue: Promise.resolve() };
        files.set(src, f);
      }
      const v = f;
      const job = v.queue.then(() => frameAt(v.el, ms, h)).catch(() => null);
      v.queue = job;
      return job;
    },
  };
}
