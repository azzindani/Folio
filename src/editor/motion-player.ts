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
 * A frame is the EXPORT's frame (motion-pose.ts): the flipbook sampler over the
 * resolved timeline — delays, loops, precomp clocks, links and in/out windows
 * included — copied into editor state without recording undo. The fields it
 * writes are captured first and put back on stop, so playing never edits.
 */

import type { StateManager, EditorState } from './state';
import type { Layer } from '../schema/types';
import { flattenForTimeline, sceneDuration, playsInTime } from '../ui/panels/timeline-model';
import type { PosePlan, Pose, RowTiming } from './motion-pose';
import { sourceOptions } from '../renderer/resolve-source';

type PoseEngine = typeof import('./motion-pose');

export interface PlayerSnapshot { time: number; duration: number; playing: boolean; hasMotion: boolean }

export class MotionPlayer {
  private listeners = new Set<(s: PlayerSnapshot) => void>();
  /** Authored values of every field a pose wrote, by layer id. */
  private baseline: Map<string, Pose> | null = null;
  /** The page the pose is on — put back THERE even if the user has moved on. */
  private baselinePage = 0;
  private raf = 0;
  private t = 0;
  private isPlaying = false;
  /** Set by the timeline panel when the user types a duration. */
  private pinnedDuration: number | null = null;
  private engine: PoseEngine | null = null;
  private loading: Promise<PoseEngine | null> | null = null;
  private plan: PosePlan | null = null;
  /** True while a pose is being written: the player's own writes are not edits. */
  private writing = false;

  constructor(private state: StateManager) {
    state.subscribe((_s, keys) => this.onState(keys));
    void this.load();
  }

  /** Every layer on the current surface that plays in time, at any depth. */
  animatedLayers(): Layer[] {
    return flattenForTimeline(this.authoredLayers()).map(r => r.layer).filter(playsInTime);
  }

  hasMotion(): boolean { return this.animatedLayers().length > 0; }

  get duration(): number {
    if (this.pinnedDuration !== null) return this.pinnedDuration;
    const planned = this.currentPlan()?.duration ?? 0;
    return planned > 0 ? planned : sceneDuration(this.authoredLayers());
  }

  pinDuration(ms: number | null): void {
    this.pinnedDuration = ms === null ? null : Math.max(100, ms);
    this.emit();
  }

  get time(): number { return this.t; }
  get playing(): boolean { return this.isPlaying; }
  /** True while the player is writing a frame — listeners that redraw on edits can skip it. */
  get posing(): boolean { return this.writing; }
  /** True while a frame is on the canvas instead of the design as authored. */
  get isPosed(): boolean { return this.baseline !== null; }

  /** Every row's time on the scene clock; null until the sampler has loaded. */
  rows(): Map<string, RowTiming> | null { return this.currentPlan()?.rows ?? null; }

  subscribe(fn: (s: PlayerSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    const snap: PlayerSnapshot = { time: this.t, duration: this.duration, playing: this.isPlaying, hasMotion: this.hasMotion() };
    for (const fn of this.listeners) { try { fn(snap); } catch { /* a bad listener must not stop playback */ } }
  }

  /** The export's sampler, loaded once. Null when the chunk fails — play then does nothing instead of throwing. */
  private load(): Promise<PoseEngine | null> {
    this.loading ??= import('./motion-pose')
      .then(m => { this.engine = m; this.plan = null; this.emit(); return m; })
      .catch(() => { this.loading = null; return null; });
    return this.loading;
  }

  /** Resolves once the sampler is in; false when it could not load. */
  async ready(): Promise<boolean> { return (await this.load()) !== null; }

  private currentPlan(): PosePlan | null {
    if (!this.engine) return null;
    const { design, currentPageIndex } = this.state.get();
    this.plan ??= this.engine.buildPosePlan(this.authoredLayers(), design ? sourceOptions(design, design.pages?.[currentPageIndex]) : {});
    return this.plan;
  }

  private onState(keys: (keyof EditorState)[]): void {
    if (this.writing) return;
    if (keys.includes('currentPageIndex')) { this.stop(); this.plan = null; return; }
    if (!keys.includes('design')) return;
    this.plan = null;
    // An edit made while posed (a keyframe moved, a window trimmed) shows at the same moment.
    if (this.baseline && !this.isPlaying) queueMicrotask(() => { if (this.baseline && !this.isPlaying) this.applyAt(this.t); });
  }

  play(): void {
    if (this.isPlaying || !this.hasMotion()) return;
    if (!this.engine) { void this.load().then(e => { if (e) this.play(); }); return; }
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

  /** A new design replaced the one posed: drop the pose without writing it back onto the newcomer. */
  forget(): void {
    this.pause();
    this.baseline = null;
    this.plan = null;
    this.t = 0;
    this.emit();
  }

  seek(ms: number): void {
    if (!this.engine) { void this.load().then(e => { if (e) this.seek(ms); }); return; }
    this.applyAt(Math.max(0, Math.min(this.duration, ms)));
  }

  /** Pose every touched layer at `ms`, capturing each one's authored fields the first time. */
  private applyAt(ms: number): void {
    const plan = this.currentPlan();
    if (!this.engine || !plan || plan.touched.length === 0) return;
    this.t = ms;
    if (!this.baseline) {
      this.baseline = new Map();
      this.baselinePage = this.state.get().currentPageIndex;
    }
    const frame = this.engine.poseFrame(plan, ms);
    const missing = [...frame.keys()].filter(id => !this.baseline?.has(id));
    if (missing.length) {
      const authored = new Map(flattenForTimeline(plan.layers).map(r => [r.layer.id, r.layer as unknown as Record<string, unknown>]));
      for (const id of missing) {
        const l = authored.get(id);
        const keep: Pose = {};
        for (const f of this.engine.POSE_FIELDS) keep[f] = l?.[f];
        this.baseline.set(id, keep);
      }
    }
    this.write(frame, this.baselinePage);
    this.emit();
  }

  private write(updates: Map<string, Pose>, page: number): void {
    this.writing = true;
    try { this.state.updateLayers(updates, false, page); } finally { this.writing = false; }
  }

  /**
   * The current surface with any live pose undone — the design as AUTHORED.
   *
   * Anything that reasons about the animation rather than displaying it needs
   * this. A motion trail derived from the on-screen layers re-bases itself on
   * every frame, because a pose has already moved the layer the trail is
   * measured from; the path would crawl across the canvas while it played.
   *
   * Returns the layers untouched when nothing is posed, so a caller never has
   * to ask whether playback is running.
   */
  authoredLayers(): Layer[] {
    const layers = this.state.getCurrentLayers() as Layer[];
    const base = this.baseline;
    if (!base) return layers;
    // Spread through a plain record: Layer is a large discriminated union and
    // spreading it directly makes the checker enumerate every combination.
    const unpose = (ls: Layer[]): Layer[] => ls.map(l => {
      const b = base.get(l.id);
      const o = l as unknown as Record<string, unknown>;
      const restored: Record<string, unknown> = b ? { ...o, ...b } : { ...o };
      if (b) for (const k of Object.keys(b)) if (b[k] === undefined) delete restored[k];
      const kids = o['layers'];
      if (Array.isArray(kids)) restored['layers'] = unpose(kids as Layer[]);
      return restored as unknown as Layer;
    });
    return unpose(layers);
  }

  /** Put every posed layer back the way it was authored, on the page it was posed on. */
  restore(): void {
    if (!this.baseline) return;
    const base = this.baseline;
    this.baseline = null;
    this.write(base, this.baselinePage);
  }
}
