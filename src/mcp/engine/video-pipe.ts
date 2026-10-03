// An ffmpeg whose output is read only when asked for — real backpressure.
//
// Under Bun a child's stdout keeps being read into memory while paused once the
// writer sends frame-sized writes (found live: a slow reader let a raw 1080p
// stream grow past 3 GB). So ffmpeg writes into a named pipe (FIFO) and the
// reader pulls exact byte counts with fs reads: when nothing is read, the kernel
// pipe fills and ffmpeg blocks. Where mkfifo does not exist the child's stdout
// is used, paused between reads (enough under Node).

import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let fifoSupport: boolean | null = null;
let fifoSeq = 0;

function canFifo(): boolean {
  if (fifoSupport === null) fifoSupport = process.platform !== 'win32' && spawnSync('mkfifo', ['--help']).error === undefined;
  return fifoSupport;
}

export class FramePipe {
  readonly proc: ChildProcess;
  private readonly fifo: string | null;
  private fh: Promise<fs.promises.FileHandle> | null = null;
  private opened = false;
  private queue: Buffer[] = [];
  private queued = 0;
  private eof = false;
  private wake: (() => void) | null = null;
  private exitCode: number | null | undefined = undefined;
  /** The FIFO read in flight: the handle closes only after it settles (closing under it left it pending forever on Bun 1.1.38). */
  private reading: Promise<unknown> = Promise.resolve();
  readonly exited: Promise<number | null>;

  /** `args` end where the output goes: FramePipe appends the FIFO path or pipe:1. */
  constructor(bin: string, args: string[], onStderr: (text: string) => void) {
    this.fifo = canFifo() ? path.join(os.tmpdir(), `folio-clip-${process.pid}-${++fifoSeq}.fifo`) : null;
    if (this.fifo) spawnSync('mkfifo', [this.fifo]);
    this.proc = spawn(bin, [...args, '-y', this.fifo ?? 'pipe:1'], { stdio: ['ignore', this.fifo ? 'ignore' : 'pipe', 'pipe'] });
    const onData = (c: Buffer): void => onStderr(c.toString());
    this.proc.stderr?.on('data', onData);
    // Bun 1.1.38 keeps a child's stderr reachable after it exits: a listener left on it
    // kept this pipe — and its last frame — alive for the life of the server.
    const detach = (): void => { this.proc.stderr?.off('data', onData); };
    this.exited = new Promise(resolve => {
      this.proc.on('close', (code: number | null) => { this.exitCode = code; detach(); this.unblock(); resolve(code); });
      this.proc.on('error', () => { this.exitCode = null; detach(); this.unblock(); resolve(null); });
    });
    if (this.fifo) {
      this.fh = fs.promises.open(this.fifo, 'r');
      void this.fh.then(() => { this.opened = true; }, () => { this.opened = true; });
    } else {
      this.proc.stdout?.on('data', (c: Buffer) => { this.queue.push(c); this.queued += c.length; this.proc.stdout?.pause(); this.signal(); });
      this.proc.stdout?.on('end', () => { this.eof = true; this.signal(); });
    }
  }

  /** Exactly `n` bytes, fewer at the end of the output, null when nothing is left. */
  async read(n: number): Promise<Buffer | null> {
    const out = Buffer.allocUnsafe(n);
    let got = 0;
    while (got < n) {
      const k = await this.readInto(out, got, n - got);
      if (k === 0) break;
      got += k;
    }
    return got === 0 ? null : got === n ? out : out.subarray(0, got);
  }

  /** Whatever is available, up to `max` bytes; null at the end. */
  async readSome(max: number): Promise<Buffer | null> {
    const out = Buffer.allocUnsafe(max);
    const k = await this.readInto(out, 0, max);
    return k === 0 ? null : out.subarray(0, k);
  }

  close(): void {
    this.proc.kill('SIGKILL');
    this.unblock();
    // The writer is dead, so a read in flight ends (EOF) — then the handle closes.
    void this.fh?.then(async fh => { await this.reading.catch(() => undefined); await fh.close(); }).catch(() => undefined);
    if (this.fifo) fs.rm(this.fifo, { force: true }, () => undefined);
  }

  private async readInto(buf: Buffer, at: number, len: number): Promise<number> {
    if (this.fh) {
      const fh = await this.fh;
      const read = fh.read(buf, at, len, null);
      // Settled to nothing: the result object holds the buffer read into.
      this.reading = read.then(() => undefined, () => undefined);
      try { return (await read).bytesRead; } catch { return 0; }
    }
    while (!this.queued && !this.eof) {
      this.proc.stdout?.resume();
      await new Promise<void>(resolve => { this.wake = resolve; });
    }
    let k = 0;
    while (k < len && this.queue.length) {
      const head = this.queue[0] as Buffer;
      const take = Math.min(len - k, head.length);
      head.copy(buf, at + k, 0, take);
      k += take;
      this.queued -= take;
      if (take === head.length) this.queue.shift(); else this.queue[0] = head.subarray(take);
    }
    return k;
  }

  /**
   * ffmpeg died before opening the FIFO: open its write end so the reader's open returns and
   * reads EOF. Retried — the reader's open may not have reached the kernel yet (ENXIO).
   */
  private unblock(tries = 40): void {
    this.signal();
    const fifo = this.fifo;
    if (!fifo || this.exitCode === undefined || this.opened) return;
    try { fs.closeSync(fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)); } catch { /* no reader yet */ }
    if (tries > 0) setTimeout(() => this.unblock(tries - 1), 50).unref();
  }

  private signal(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
}
