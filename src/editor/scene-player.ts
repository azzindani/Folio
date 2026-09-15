/**
 * Play a multi-page design as ONE piece — every scene end to end, transitions
 * included — exactly as the gif/mp4 export will.
 *
 * MotionPlayer poses the current page by writing into editor state, which is
 * right for editing one scene and wrong for watching the piece: a transition is
 * two pages on screen at once, and neither of them is the page being edited. So
 * this never touches the design. A frame is composeSceneFrame(design, plan, t) —
 * the export's own function, scene plan and transition poses — rendered by the
 * stage as a single page. What plays here is what exports.
 */

import type { StateManager } from './state';
import type { DesignSpec } from '../schema/types';
import { planScenes, sceneAt, type ScenePlan } from '../export/scene-plan';
import { composeSceneFrame } from '../export/scene-compose';
import { playsAsScenes } from './scene-deck';

export interface SceneClock {
  now(): number;
  frame(cb: (now: number) => void): number;
  cancel(id: number): void;
}

export interface ScenePlayerSnapshot {
  time: number;
  total: number;
  playing: boolean;
  /** The scene on screen — the incoming one mid-transition. */
  scene: number;
}

const browserClock: SceneClock = {
  now: () => performance.now(),
  frame: cb => requestAnimationFrame(cb),
  cancel: id => cancelAnimationFrame(id),
};

export { playsAsScenes };

export class ScenePlayer {
  private listeners = new Set<(s: ScenePlayerSnapshot) => void>();
  private t = 0;
  private isPlaying = false;
  private raf = 0;
  /** Planning walks every page; a frame needs the plan several times, an edit invalidates it. */
  private cachedPlan: ScenePlan | null = null;

  constructor(private state: StateManager, private clock: SceneClock = browserClock) {
    state.subscribe(() => { this.cachedPlan = null; });
  }

  plan(): ScenePlan | null {
    const design = this.state.get().design;
    if (!playsAsScenes(design) || !design) return null;
    this.cachedPlan ??= planScenes(design);
    return this.cachedPlan;
  }

  get total(): number { return this.plan()?.total_ms ?? 0; }
  get time(): number { return this.t; }
  get playing(): boolean { return this.isPlaying; }

  /** The piece at `t` as a one-page design, or null when there is nothing to play. */
  frameAt(t: number = this.t): DesignSpec | null {
    const design = this.state.get().design;
    const plan = this.plan();
    return design && plan ? composeSceneFrame(design, plan, t) : null;
  }

  sceneIndexAt(t: number = this.t): number {
    const plan = this.plan();
    return plan && plan.scenes.length > 0 ? sceneAt(plan, t).scene.index : 0;
  }

  snapshot(): ScenePlayerSnapshot {
    return { time: this.t, total: this.total, playing: this.isPlaying, scene: this.sceneIndexAt() };
  }

  subscribe(fn: (s: ScenePlayerSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) { try { fn(snap); } catch { /* a bad listener must not stop playback */ } }
  }

  /** Plays to the end and stops there, like a video; play again from the end restarts. */
  play(): void {
    if (this.isPlaying || !this.plan()) return;
    if (this.t >= this.total) this.t = 0;
    this.isPlaying = true;
    const started = this.clock.now() - this.t;
    const tick = (now: number): void => {
      if (!this.isPlaying) return;
      const total = this.total;
      if (now - started >= total) {
        this.t = total;
        this.isPlaying = false;
      } else {
        this.t = Math.max(0, now - started);
        this.raf = this.clock.frame(tick);
      }
      this.emit();
    };
    this.raf = this.clock.frame(tick);
    this.emit();
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.clock.cancel(this.raf);
    this.emit();
  }

  toggle(): void { this.isPlaying ? this.pause() : this.play(); }

  /** Jump to `ms`. While playing, the clock re-bases so playback carries on from there. */
  seek(ms: number): void {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();
    this.t = Math.max(0, Math.min(this.total, ms));
    if (wasPlaying) this.play(); else this.emit();
  }

  /** Jump to the first frame of a scene — the start of its incoming transition. */
  seekScene(index: number): void {
    const scene = this.plan()?.scenes[index];
    if (scene) this.seek(scene.start_ms);
  }

  stop(): void {
    this.pause();
    this.t = 0;
    this.emit();
  }
}
