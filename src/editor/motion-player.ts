/**
 * Playback for the studio — ONE engine, driven from anywhere.
 *
 * Play/pause/scrub used to live inside the timeline panel, which meant motion
 * could only be watched by opening a right-panel tab and finding the clock
 * icon. Adding a second play button on the canvas toolbar would have meant a
 * second implementation of playback, and two implementations of one rule is the
 * failure this codebase keeps rediscovering. So the panel and the toolbar both
 * drive this.
 *
 * It also fixes what the panel's own preview got wrong: it posed the layers of
 * `state.getCurrentLayers()`, which is TOP-LEVEL ONLY. Every MCP design is one
 * group with the motion on its children, so pressing play moved nothing at all.
 */

import type { StateManager } from './state';
import type { Layer } from '../schema/types';
import type { Keyframe } from '../animation/types';
import { interpolateAtTime, poseToLayerUpdate, flattenForTimeline, sceneDuration } from '../ui/panels/timeline-panel';

/** The fields a pose writes, captured so the design can be put back. */
const POSE_FIELDS = ['x', 'y', 'opacity', 'rotation', 'transform', 'effects'] as const;

export interface PlayerSnapshot { time: number; duration: number; playing: boolean; hasMotion: boolean }

export class MotionPlayer {
  private state: StateManager;
  private listeners = new Set<(s: PlayerSnapshot) => void>();
  private baseline: Map<string, Partial<Layer>> | null = null;
  private raf = 0;
  private t = 0;
  private isPlaying = false;
  /** Set by the timeline panel when the user types a duration. */
  private pinnedDuration: number | null = null;

  constructor(state: StateManager) {
    this.state = state;
  }

  /** Every animated layer on the current surface, at any depth. */
  animatedLayers(): Layer[] {
    return flattenForTimeline(this.state.getCurrentLayers() as Layer[])
      .map(r => r.layer)
      .filter(l => ((l.animation?.keyframes ?? []).length > 0));
  }

  hasMotion(): boolean { return this.animatedLayers().length > 0; }

  get duration(): number {
    if (this.pinnedDuration !== null) return this.pinnedDuration;
    return sceneDuration(this.state.getCurrentLayers() as Layer[]);
  }

  pinDuration(ms: number | null): void {
    this.pinnedDuration = ms === null ? null : Math.max(100, ms);
    this.emit();
  }

  get time(): number { return this.t; }
  get playing(): boolean { return this.isPlaying; }

  subscribe(fn: (s: PlayerSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    const snap: PlayerSnapshot = { time: this.t, duration: this.duration, playing: this.isPlaying, hasMotion: this.hasMotion() };
    for (const fn of this.listeners) { try { fn(snap); } catch { /* a bad listener must not stop playback */ } }
  }

  play(): void {
    if (this.isPlaying) return;
    if (!this.hasMotion()) return;
    this.isPlaying = true;
    const started = performance.now() - this.t;
    const tick = (now: number): void => {
      if (!this.isPlaying) return;
      const d = this.duration;
      this.applyAt(((now - started) % d + d) % d);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.emit();
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  toggle(): void { this.isPlaying ? this.pause() : this.play(); }

  /** Back to the design as authored — not to frame 0 of the preview. */
  stop(): void {
    this.pause();
    this.t = 0;
    this.restore();
    this.emit();
  }

  seek(ms: number): void {
    this.applyAt(Math.max(0, Math.min(this.duration, ms)));
  }

  /** Pose every animated layer at `ms`, capturing the authored values first. */
  private applyAt(ms: number): void {
    const animated = this.animatedLayers();
    if (!animated.length) return;
    this.t = ms;

    if (!this.baseline) {
      this.baseline = new Map();
      for (const l of animated) {
        const o = l as unknown as Record<string, unknown>;
        const keep: Record<string, unknown> = {};
        for (const f of POSE_FIELDS) keep[f] = o[f];
        this.baseline.set(l.id, keep as unknown as Partial<Layer>);
      }
    }

    const d = this.duration;
    for (const l of animated) {
      const base = this.baseline.get(l.id);
      if (!base) continue;
      const authored = { ...(l as unknown as Record<string, unknown>), ...(base as unknown as Record<string, unknown>) } as unknown as Layer;
      const pose = interpolateAtTime((l.animation?.keyframes ?? []) as Keyframe[], ms, d);
      const update = { ...(base as unknown as Record<string, unknown>), ...(poseToLayerUpdate(authored, pose) as unknown as Record<string, unknown>) };
      this.state.updateLayer(l.id, update as unknown as Partial<Layer>, false);
    }
    this.emit();
  }

  /** Put every posed layer back the way it was authored. */
  restore(): void {
    if (!this.baseline) return;
    for (const [id, base] of this.baseline) this.state.updateLayer(id, base, false);
    this.baseline = null;
  }
}
