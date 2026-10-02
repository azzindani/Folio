// One clip decoded as a stream for an export: a single ffmpeg reads forward and
// hands out the frame showing at each moment asked for. Replaces one blocking
// seek-and-decode per frame (measured 323 ms at 1080p) with ~11 ms of streaming.
//
// Moments are answered in the order asked (an export asks in time order). A
// moment behind the stream, or far ahead of it, starts a fresh decoder at a seek.
// The reader pauses ffmpeg once STREAM_AHEAD frames wait, so a long clip never
// piles up in memory.

import { spawn, type ChildProcess } from 'child_process';
import { decodeArgs, splitJpegs, showinfoTimes, showsAt, STREAM_AHEAD, SEEK_LEAD_MS } from './video-decode';

/** Further ahead than this, seeking is cheaper than decoding the gap. */
const JUMP_MS = 1500;

interface Decoded { ms: number; data: Buffer }

export class ClipStream {
  private proc: ChildProcess | null = null;
  private started = false;
  private ended = false;
  private seekMs = 0;
  private bytes: Buffer = Buffer.alloc(0);
  private jpegs: Buffer[] = [];
  private times: number[] = [];
  private log = '';
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

  constructor(private readonly file: string, private readonly edge: number, private readonly bin = 'ffmpeg') {}

  /** The JPEG showing at `ms` of the file; null when the file gave no frame. */
  frameAt(ms: number): Promise<Buffer | null> {
    const run = this.queue.then(() => this.read(ms));
    this.queue = run.catch(() => undefined);
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
      this.proc?.stdout?.resume();
      await new Promise<void>(resolve => { this.wake = resolve; });
    }
    if (this.ahead.length < STREAM_AHEAD) this.proc?.stdout?.resume();
    return (this.shown ?? this.ahead[0] ?? null)?.data ?? null;
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
    this.bytes = Buffer.alloc(0);
    this.jpegs = [];
    this.times = [];
    this.log = '';
    this.ahead = [];
    this.shown = null;
    this.passed = 0;
    this.tail = '';
    this.seekMs = Math.max(0, ms - SEEK_LEAD_MS);
    this.starts++;
    const proc = spawn(this.bin, decodeArgs(this.file, this.seekMs, this.edge), { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.stdout.on('data', (chunk: Buffer) => {
      if (this.proc !== proc) return;
      const { frames, rest } = splitJpegs(this.bytes.length ? Buffer.concat([this.bytes, chunk]) : chunk);
      this.bytes = rest;
      this.jpegs.push(...frames);
      this.pair();
      if (this.ahead.length >= STREAM_AHEAD) proc.stdout.pause();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      if (this.proc !== proc) return;
      this.log += chunk.toString();
      const nl = this.log.lastIndexOf('\n');
      if (nl < 0) return;
      this.takeLog(this.log.slice(0, nl));
      this.log = this.log.slice(nl + 1);
    });
    proc.on('error', (e: Error) => { if (this.proc === proc) { this.tail += e.message; this.finish(false); } });
    proc.on('close', (code: number | null) => { if (this.proc === proc) this.finish(code === 0); });
  }

  private takeLog(lines: string): void {
    for (const s of showinfoTimes(lines)) this.times.push(this.seekMs + s * 1000);
    this.tail = (this.tail + lines).slice(-2000);
    this.pair();
  }

  private pair(): void {
    while (this.jpegs.length && this.times.length) {
      const ms = this.times.shift(), data = this.jpegs.shift();
      if (ms === undefined || data === undefined) break;
      this.ahead.push({ ms, data });
    }
    this.signal();
  }

  private finish(ranToEnd: boolean): void {
    this.takeLog(this.log);
    this.log = '';
    this.ended = true;
    this.proc = null;
    if (ranToEnd) this.final = this.ahead[this.ahead.length - 1] ?? this.shown ?? this.final;
    this.signal();
  }

  private signal(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private stop(): void {
    const proc = this.proc;
    this.proc = null;
    proc?.kill('SIGKILL');
  }
}
