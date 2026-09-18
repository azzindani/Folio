/**
 * Sound for a one-page piece played on the canvas.
 *
 * Found live (2026-09-18): a 62 s continuous composition with a music bed and
 * twelve cues played SILENT in the editor. playPiece() sends a deck to the scene
 * stage, which sounds it, and a single page to MotionPlayer on the canvas, which
 * had no sound at all — while the mp4 export of the same design mixed every cue.
 * The mixing is SceneAudio's (the stage's own), fed the same plan the export
 * reads; this only makes it follow the canvas transport.
 *
 * Sound follows the transport's edges, not every frame: it starts on play and
 * stops on pause. The canvas player loops and seeks, so a playing clock that
 * lands away from where the sound has got to (the wrap back to 0, a scrub, an
 * edit that re-posed the scene) starts the sound again from there.
 */

import type { StateManager } from './state';
import type { MotionPlayer, PlayerSnapshot } from './motion-player';
import type { DesignSpec } from '../schema/types';
import { SceneAudio } from './scene-audio';
import { resolveAssetUrl } from '../renderer/render-context';
import { designSoundSources } from '../ui/scene-stage/scene-stage-sound';
import { playsAsScenes } from './scene-deck';
import type { SoundTimeline } from '../export/audio-plan';

/** How far the clock may stray from the sound before it counts as a jump, ms. */
const JUMP_MS = 300;

export class CanvasSound {
  private audio: SceneAudio;
  /** Where the sound started, on the piece clock and on the wall clock; null while silent. */
  private started: { t: number; at: number } | null = null;
  /** The sound files last preloaded, so an edit that keeps them costs nothing. */
  private sources = '';

  constructor(private state: StateManager, private player: MotionPlayer, audio?: SceneAudio) {
    this.audio = audio ?? new SceneAudio({
      context: () => new AudioContext(),
      load: src => fetch(resolveAssetUrl(src), { credentials: 'include' })
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      // A file that decodes after play starts late, at the point the piece has reached.
      onChange: () => { if (this.started) this.start(this.player.time); },
    });
    this.designChanged();
    player.subscribe(s => this.follow(s));
  }

  /** A design came in or changed: decode any new sound file now, so a play sounds on time. */
  designChanged(): void {
    const srcs = designSoundSources(this.state.get().design);
    const key = srcs.join('\n');
    if (key === this.sources) return;
    this.sources = key;
    this.audio.preload(srcs);
  }

  /** Called on every player snapshot; acts only on the edges and on jumps. */
  follow(s: PlayerSnapshot): void {
    // A deck's sound spans every scene — the stage plays it, not a one-page preview.
    if (!s.playing || playsAsScenes(this.state.get().design)) { if (this.started) this.stop(); return; }
    if (!this.started) { this.start(s.time); return; }
    const expected = this.started.t + (performance.now() - this.started.at);
    if (Math.abs(s.time - expected) > JUMP_MS) this.start(s.time);
  }

  stop(): void {
    this.started = null;
    this.audio.stop();
  }

  private start(t: number): void {
    const design = this.state.get().design;
    this.started = { t, at: performance.now() };
    if (!design) { this.audio.stop(); return; }
    this.audio.start(this.audio.plan(design, pieceTimeline(design, this.player.duration)), t);
  }
}

/** The one page as the whole piece — the timeline the mp4 export plans a poster's sound on. */
function pieceTimeline(design: DesignSpec, duration: number): SoundTimeline {
  const page = design.pages?.[0];
  return { total_ms: duration, scenes: page ? [{ page_id: page.id, start_ms: 0 }] : [] };
}
