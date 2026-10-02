// One clip decoded as a stream for an export: a single ffmpeg reads forward and
// hands out the frame showing at each moment asked for. Replaces one blocking
// seek-and-decode per frame (measured 323 ms at 1080p) with ~11 ms of streaming.
//
// Moments are answered in the order asked (an export asks in time order). A
// moment behind the stream, or far ahead of it, starts a fresh decoder at a seek.
// Frames are PULLED (video-pipe.ts): after each answer the stream reads a few frames
// ahead (2 raw, 6 JPEG) so ffmpeg decodes while the frame is drawn, and no further —
// a long clip never piles up in memory.

import { FramePipe } from './video-pipe';
import { showinfoTimes, showsAt, SEEK_LEAD_MS, type DecodeFormat } from './video-decode';

/** Further ahead than this, seeking is cheaper than decoding the gap. */
const JUMP_MS = 1500;
/** Bytes asked of the pipe at a time while a variable-size frame (a JPEG) comes in. */
const CHUNK = 256 * 1024;
/** Frames decoded ahead of the reader: raw frames are 8 MB at 1080p, JPEGs ~0.1–0.4 MB. */
const LEAD_RAW = 2;
const LEAD_JPEG = 6;

interface Decoded { ms: number; data: Buffer }

export class ClipStream {
  private pipe: FramePipe | null = null;
  private started = false;
  private ended = false;
  private exited = false;
  private seekMs = 0;
  private times: number[] = [];
  private log = '';
  private carry: Buffer | null = null;
  private spare: Buffer[] = [];
  private ahead: Decoded[] = [];
  private shown: Decoded | null = null;
  private passed = 0;
  /** The file's last frame, once a decoder has run to the end of it. */
  private final: Decoded | null = null;
  private wake: (() => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** The last lines ffmpeg wrote, for an error. */
  tail = '';
  /** Decoders started — one seek each. */
  starts = 0;

  constructor(private readonly file: string, private readonly format: DecodeFormat, private readonly bin = 'ffmpeg') {}

  /** The frame showing at `ms` of the file, in the stream's format; null when the file gave no frame. */
  frameAt(ms: number): Promise<Buffer | null> {
    const run = this.queue.then(() => this.read(ms));
    this.queue = run.then(() => this.fill(), () => undefined).catch(() => undefined);
    return run;
  }

  close(): void {
    this.stop();
    this.final = null;
  }

  private async read(ms: number): Promise<Buffer | null> {
    if (this.final && showsAt(this.final.ms, ms)) return this.final.data;
    if (this.needsSeek(ms)) this.start(ms);
    for (;;) {
      while (this.ahead[0] && showsAt(this.ahead[0].ms, ms)) {
        this.shown = this.ahead.shift() ?? null;
        this.passed++;
      }
      if (this.ahead.length || this.ended) break;
      const next = await this.pull();
      if (next) this.ahead.push(next); else await this.finish();
    }
    return (this.shown ?? this.ahead[0] ?? null)?.data ?? null;
  }

  /** Read ahead to the lead while the answered frame is drawn. */
  private async fill(): Promise<void> {
    const lead = this.format.frameBytes ? LEAD_RAW : LEAD_JPEG;
    while (this.pipe && !this.ended && this.ahead.length < lead) {
      const next = await this.pull();
      if (next) this.ahead.push(next); else await this.finish();
    }
  }

  private needsSeek(ms: number): boolean {
    if (!this.started) return true;
    if (this.seekMs > 0 && !showsAt(this.seekMs, ms)) return true;
    // Behind the frame on show: an earlier one exists unless this is the file's first frame.
    if (this.shown && !showsAt(this.shown.ms, ms) && !(this.passed === 1 && this.seekMs === 0)) return true;
    const known = this.ahead[this.ahead.length - 1]?.ms ?? this.shown?.ms;
    return !this.ended && known !== undefined && ms > known + JUMP_MS;
  }

  private start(ms: number): void {
    this.stop();
    this.started = true;
    this.ended = false;
    this.exited = false;
    this.times = [];
    this.log = '';
    this.carry = null;
    this.spare = [];
    this.ahead = [];
    this.shown = null;
    this.passed = 0;
    this.tail = '';
    this.seekMs = Math.max(0, ms - SEEK_LEAD_MS);
    this.starts++;
    const pipe = new FramePipe(this.bin, this.format.args(this.file, this.seekMs), text => {
      if (this.pipe === pipe) this.takeLog(text, false);
    });
    this.pipe = pipe;
    void pipe.exited.then(() => {
      if (this.pipe !== pipe) return;
      this.exited = true;
      this.takeLog('', true);
    });
  }

  /** The next decoded frame with its start time, or null at the end of the output. */
  private async pull(): Promise<Decoded | null> {
    const pipe = this.pipe;
    if (!pipe) return null;
    const data = await this.nextFrame(pipe);
    if (!data || this.pipe !== pipe) return null;
    while (!this.times.length && !this.exited && this.pipe === pipe) await new Promise<void>(resolve => { this.wake = resolve; });
    const ms = this.times.shift();
    return ms === undefined || this.pipe !== pipe ? null : { ms, data };
  }

  private async nextFrame(pipe: FramePipe): Promise<Buffer | null> {
    const size = this.format.frameBytes;
    if (size) {
      const frame = await pipe.read(size);
      return frame && frame.length === size ? frame : null;
    }
    for (;;) {
      const ready = this.spare.shift();
      if (ready) return ready;
      const chunk = await pipe.readSome(CHUNK);
      if (!chunk) return null;
      const { frames, rest } = this.format.split(this.carry ? Buffer.concat([this.carry, chunk]) : chunk);
      // Copied out: a frame must not pin the whole chunk it arrived in.
      this.spare.push(...frames.map(f => Buffer.from(f)));
      this.carry = rest.length ? Buffer.from(rest) : null;
    }
  }

  private async finish(): Promise<void> {
    const pipe = this.pipe;
    this.ended = true;
    const code = pipe ? await pipe.exited : null;
    // Ran to the end of the file: the frame on show is its last.
    if (code === 0 && this.pipe === pipe) this.final = this.shown ?? this.final;
  }

  private takeLog(text: string, flush: boolean): void {
    this.log += text;
    const nl = flush ? this.log.length : this.log.lastIndexOf('\n');
    if (nl >= 0) {
      const lines = this.log.slice(0, nl);
      this.log = this.log.slice(nl);
      for (const s of showinfoTimes(lines)) this.times.push(this.seekMs + s * 1000);
      this.tail = (this.tail + lines).slice(-2000);
    }
    this.signal();
  }

  private signal(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private stop(): void {
    const pipe = this.pipe;
    this.pipe = null;
    pipe?.close();
    this.signal();
  }
}
