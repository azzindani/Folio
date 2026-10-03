/**
 * Footage on the canvas, following the transport.
 *
 * The renderer draws a video layer in the browser as a <video> in a
 * foreignObject (layer-renderers-video.ts). But the canvas rebuilds its whole
 * SVG on every render — every pose frame while playing — and a fresh <video>
 * would load from nothing each time. So each render's new element is swapped
 * for the ONE element kept per layer: a media element moved within the
 * document keeps playing (the spec pauses it only if it stays out).
 *
 * Time comes from the player, never from the element: the frame shown is
 * videoSourceMs(t) — the moment the export draws (video-time.ts). While the
 * piece plays, a clip inside its used part plays at its speed and is re-seeked
 * when it strays; otherwise it rests on the frame for the playhead. The
 * element stays muted: the clip's sound is planned with the soundtrack
 * (video-sound.ts) and played by CanvasSound.
 */

import type { StateManager } from './state';
import type { MotionPlayer, PlayerSnapshot } from './motion-player';
import type { Layer } from '../schema/types';
import { videoSourceMs, speedAt, naturalLength, type VideoTiming } from '../animation/video-time';
import { resolveTimeline } from '../animation/timeline-resolve';
import { cropAt, panKeys } from '../animation/clip-crop';
import { videoFit } from '../renderer/layer-renderers-video';

/** How far an element may stray from the clock before it is re-seeked, ms. */
const DRIFT_MS = 250;
/** While resting, a seek smaller than this is not worth a decode, ms. */
const REST_MS = 40;

interface Timing { in: number; out: number; video?: VideoTiming; panned?: Layer }

/** The URL a canvas <video> plays: a project clip's 720p proxy (the server falls back to the clip without one). */
export function proxiedSrc(src: string): string {
  if (!src.includes('/__project_files/') || /[?&]proxy=/.test(src)) return src;
  return `${src}${src.includes('?') ? '&' : '?'}proxy=1`;
}

export class CanvasVideo {
  private kept = new Map<string, HTMLVideoElement>();
  private timings = new Map<string, Timing>();
  private timedFrom: unknown = null;
  private observer: MutationObserver;

  constructor(private state: StateManager, private player: MotionPlayer, private container: HTMLElement) {
    this.observer = new MutationObserver(() => this.adopt());
    this.observer.observe(container, { childList: true, subtree: true });
    player.subscribe(s => this.follow(s));
    this.adopt();
  }

  /** Swap each freshly rendered <video> for the element kept for its layer. */
  adopt(): void {
    const seen = new Set<string>();
    for (const fresh of Array.from(this.container.querySelectorAll<HTMLVideoElement>('video[data-video-layer]'))) {
      const id = fresh.getAttribute('data-video-layer') ?? '';
      seen.add(id);
      const kept = this.kept.get(id);
      if (kept === fresh) continue;
      const src = fresh.getAttribute('src') ?? '';
      if (kept && kept.dataset['origin'] === src) {
        kept.setAttribute('style', fresh.getAttribute('style') ?? '');
        fresh.replaceWith(kept);
      } else {
        // Plays the clip's 720p proxy: decodes and seeks fast while scrubbing; an export reads the original.
        fresh.muted = true;
        fresh.dataset['origin'] = src;
        fresh.setAttribute('src', proxiedSrc(src));
        this.kept.set(id, fresh);
      }
    }
    for (const [id, v] of this.kept) if (!seen.has(id)) { v.pause(); this.kept.delete(id); }
    this.follow({ time: this.player.time, duration: this.player.duration, playing: this.player.playing, hasMotion: true });
  }

  /** Every player snapshot: play what should play, rest the rest on the playhead's frame. */
  follow(s: PlayerSnapshot): void {
    if (!this.kept.size) return;
    this.refreshTimings();
    for (const [id, v] of this.kept) {
      const tm = this.timings.get(id);
      if (!tm) continue;
      const target = videoSourceMs(s.time, tm.in, tm.video) / 1000;
      // A ramp plays at the speed it has now; a still never plays — it rests on its frame (video-time.ts).
      const speed = speedAt(tm.video, s.time - tm.in);
      const length = naturalLength(tm.video);
      const live = speed > 0 && s.time >= tm.in && s.time < tm.out && (length === null || s.time - tm.in < length);
      if (s.playing && live) {
        v.playbackRate = Math.max(0.0625, Math.min(16, speed));
        if (v.paused) { v.currentTime = target; void v.play().catch(() => undefined); }
        else if (Math.abs(v.currentTime - target) * 1000 > DRIFT_MS) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) * 1000 > REST_MS) v.currentTime = target;
      }
      // A pan inside the footage moves with the file's clock, frame by frame (animation/clip-crop.ts).
      if (tm.panned) {
        const c = cropAt(tm.panned, target * 1000);
        const at = `${+(c.focus[0] * 100).toFixed(3)}% ${+(c.focus[1] * 100).toFixed(3)}%`;
        v.style.objectPosition = at; v.style.transformOrigin = at; v.style.transform = `scale(${+c.zoom.toFixed(4)})`;
      }
    }
  }

  dispose(): void {
    this.observer.disconnect();
    for (const v of this.kept.values()) v.pause();
    this.kept.clear();
  }

  /** Each video layer's in/out on the scene clock — resolved, as the export reads them. */
  private refreshTimings(): void {
    const st = this.state.get();
    const layers = st.design?.pages?.length ? st.design.pages[Math.min(st.currentPageIndex ?? 0, st.design.pages.length - 1)]?.layers : st.design?.layers;
    if (layers === this.timedFrom) return;
    this.timedFrom = layers;
    this.timings.clear();
    const walk = (ls: Layer[]): void => {
      for (const l of ls) {
        const o = l as unknown as { in?: number; out?: number; video?: VideoTiming; layers?: Layer[] };
        const panned = l.type === 'video' && videoFit((l as Layer & { fit?: unknown }).fit) === 'cover' && panKeys(l).length > 0;
        if (l.type === 'video') this.timings.set(l.id, { in: Number(o.in) || 0, out: typeof o.out === 'number' ? o.out : Infinity, ...(o.video ? { video: o.video } : {}), ...(panned ? { panned: l } : {}) });
        if (Array.isArray(o.layers)) walk(o.layers);
      }
    };
    walk(resolveTimeline(layers ?? []));
  }
}
