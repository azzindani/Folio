/**
 * Play all's sound — the design's soundtrack and cues, in step with the scenes.
 *
 * The clips come from planSound, the same plan the mp4 export mixes, so the
 * stage sounds like the file. WebAudio rather than <audio> elements: a clip
 * starts at a time on the audio clock with an offset into the file, fades are
 * gain ramps on afade's linear curve, and seeking needs no HTTP range support
 * from the server because the file is decoded once and held.
 *
 * A play that arrives before a file has decoded starts that file late, at the
 * position the piece has reached — never from its beginning.
 */

import type { DesignSpec } from '../schema/types';
import { planSound, clipGain, clipFilePosition, type SoundClip, type SoundPlan, type SoundTimeline } from '../export/audio-plan';

/** The part of an AudioContext this uses — injectable, since jsdom has none. */
export interface SoundOutput {
  readonly currentTime: number;
  readonly destination: AudioNode;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  resume(): Promise<void>;
}

export interface SceneAudioDeps {
  /** Made on first use, inside the click or key press that asked for sound. */
  context(): SoundOutput;
  /** The bytes of a design src. */
  load(src: string): Promise<ArrayBuffer>;
  /** A file finished decoding (or failed): the plan's lengths changed. */
  onChange?(): void;
}

export class SceneAudio {
  private ctx: SoundOutput | null = null;
  private decoded = new Map<string, AudioBuffer | null>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  private live: Array<{ source: AudioBufferSourceNode; gain: GainNode }> = [];
  /** Bumped by every start and stop, so a decode that lands late cannot sound over a newer play. */
  private generation = 0;
  muted = false;

  constructor(private deps: SceneAudioDeps) {}

  /** File lengths known so far, ms. */
  durations(): Record<string, number | undefined> {
    const out: Record<string, number | undefined> = {};
    for (const [src, buf] of this.decoded) if (buf) out[src] = Math.round(buf.duration * 1000);
    return out;
  }

  /** Srcs that could not be fetched or decoded. */
  failed(): string[] {
    return [...this.decoded].filter(([, buf]) => buf === null).map(([src]) => src);
  }

  plan(design: DesignSpec, timeline: SoundTimeline): SoundPlan {
    return planSound(design, timeline, this.durations());
  }

  /** Start decoding the files so a play starts on time. */
  preload(srcs: string[]): void {
    for (const src of srcs) void this.buffer(src);
  }

  /** Sound the plan from piece time `t` (ms), replacing whatever was sounding. */
  start(plan: SoundPlan, t: number): void {
    this.stop();
    if (this.muted || plan.clips.length === 0) return;
    const gen = this.generation;
    const ctx = this.context();
    void ctx.resume().catch(() => undefined);
    const t0 = ctx.currentTime;
    for (const clip of plan.clips) {
      if (clip.start_ms + clip.length_ms <= t) continue;
      const ready = this.decoded.get(clip.src);
      if (ready) { this.schedule(ctx, clip, ready, t, t0); continue; }
      void this.buffer(clip.src).then(buf => {
        if (buf && gen === this.generation) this.schedule(ctx, clip, buf, t + (ctx.currentTime - t0) * 1000, ctx.currentTime);
      });
    }
  }

  stop(): void {
    this.generation++;
    for (const { source, gain } of this.live) {
      try { source.stop(); } catch { /* never started, or already ended */ }
      source.disconnect();
      gain.disconnect();
    }
    this.live = [];
  }

  private context(): SoundOutput {
    this.ctx ??= this.deps.context();
    return this.ctx;
  }

  private buffer(src: string): Promise<AudioBuffer | null> {
    if (this.decoded.has(src)) return Promise.resolve(this.decoded.get(src) ?? null);
    const waiting = this.pending.get(src);
    if (waiting) return waiting;
    const settle = (buf: AudioBuffer | null): AudioBuffer | null => {
      this.decoded.set(src, buf);
      this.pending.delete(src);
      this.deps.onChange?.();
      return buf;
    };
    const p = this.deps.load(src).then(data => this.context().decodeAudioData(data)).then(settle, () => settle(null));
    this.pending.set(src, p);
    return p;
  }

  /** One clip from piece time `t`, which is `at` on the audio clock. */
  private schedule(ctx: SoundOutput, clip: SoundClip, buf: AudioBuffer, t: number, at: number): void {
    const end = clip.start_ms + clip.length_ms;
    const from = Math.max(t, clip.start_ms);
    if (from >= end) return;
    const offset = clipFilePosition(clip, from, buf.duration * 1000) / 1000;
    if (!clip.loop && offset >= buf.duration) return;
    const when = at + (from - t) / 1000;
    const clock = (ms: number): number => when + (ms - from) / 1000;

    const gain = ctx.createGain();
    const g = gain.gain;
    g.setValueAtTime(clipGain(clip, from), when);
    const fadeInEnd = clip.start_ms + clip.fade_in_ms;
    if (clip.fade_in_ms > 0 && from < fadeInEnd) g.linearRampToValueAtTime(clipGain(clip, fadeInEnd), clock(fadeInEnd));
    if (clip.fade_out_ms > 0) {
      const fadeOutStart = end - clip.fade_out_ms;
      if (from < fadeOutStart) g.setValueAtTime(clipGain(clip, fadeOutStart), clock(fadeOutStart));
      g.linearRampToValueAtTime(0, clock(end));
    }

    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.loop = clip.loop;
    // A video layer's clip at speed: the buffer runs speed× the piece clock, and
    // start()'s duration is counted in buffer time (clipFilePosition already is).
    const speed = clip.speed ?? 1;
    if (speed !== 1 && source.playbackRate) source.playbackRate.value = speed;
    source.connect(gain);
    gain.connect(ctx.destination);
    const seconds = ((end - from) / 1000) * speed;
    source.start(when, offset, clip.loop ? seconds : Math.min(seconds, buf.duration - offset));
    this.live.push({ source, gain });
  }
}
