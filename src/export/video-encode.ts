/**
 * MP4 / WebM from rendered frames — raw RGBA piped straight into ffmpeg.
 *
 * The old video route wanted Puppeteer to screenshot a browser into a frame
 * directory and then called ffmpeg on the directory, and on the deployed
 * container it never ran at all. Frames already come from resvg (the renderer
 * the GIF route uses), so here they go to ffmpeg's stdin as they are made: no
 * browser, no frame files, one frame in memory at a time.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Writable } from 'stream';

export type VideoType = 'mp4' | 'webm';

export interface VideoOptions {
  type: VideoType;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
}

/** How much of ffmpeg's stderr to keep for an error message. */
const STDERR_TAIL = 2000;

/** ffmpeg arguments for one encode — exported so the codec choices are testable without ffmpeg. */
export function ffmpegArgs(o: VideoOptions, target: string): string[] {
  const input = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`,
    '-framerate', String(o.fps), '-i', 'pipe:0', '-an',
  ];
  // yuv420p — the one chroma layout every phone and feed decodes — needs even
  // dimensions. Pad a pixel on rather than cut a pixel off the design.
  const odd = o.width % 2 !== 0 || o.height % 2 !== 0;
  const filter = odd ? ['-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:white'] : [];
  const codec = o.type === 'mp4'
    // tune=animation spends bits on hard edges and flat fills, which is all a
    // design is. faststart puts the index first so a feed can play before the
    // whole file has downloaded.
    ? ['-c:v', 'libx264', '-preset', 'medium', '-tune', 'animation', '-crf', '18',
       '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-f', 'mp4']
    : ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1',
       '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p', '-f', 'webm'];
  return [...input, ...filter, ...codec, target];
}

export class VideoPipe {
  private readonly child: ChildProcess;
  private readonly partial: string;
  private readonly exited: Promise<number | null>;
  private stderr = '';
  private failure: Error | null = null;
  private done = false;
  private gone = false;
  /** Releases a write() parked on a full pipe — called on drain, or when ffmpeg goes away. */
  private wake: (() => void) | null = null;

  constructor(private readonly opts: VideoOptions, bin = 'ffmpeg') {
    fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
    this.partial = `${opts.outputPath}.partial`;
    this.child = spawn(bin, ffmpegArgs(opts, this.partial), { stdio: ['pipe', 'ignore', 'pipe'] });
    this.child.stderr?.on('data', (d: Buffer) => { this.stderr = (this.stderr + d.toString()).slice(-STDERR_TAIL); });
    // EPIPE when ffmpeg dies mid-write; without a listener it would crash the server.
    this.child.stdin?.on('error', (e: Error) => { if (!this.failure) this.failure = e; });
    this.exited = new Promise(resolve => {
      this.child.on('error', (e: Error) => {
        if (!this.failure) this.failure = e;
        this.gone = true;
        this.wake?.();
        resolve(null);
      });
      this.child.on('close', (code: number | null) => {
        this.gone = true;
        this.wake?.();
        resolve(code);
      });
    });
  }

  /** Write one RGBA frame, waiting whenever ffmpeg's input is full. */
  async write(rgba: Uint8Array): Promise<void> {
    const stdin = this.child.stdin;
    if (this.failure || !stdin || this.gone) throw this.error('ffmpeg stopped accepting frames');
    if (stdin.write(rgba)) return;
    await this.drained(stdin);
    if (this.failure || this.gone) throw this.error('ffmpeg exited while frames were still arriving');
  }

  /**
   * Resolve once the pipe drains, or once ffmpeg is gone.
   *
   * Deliberately NOT Promise.race([drain, exited]). That hangs one more
   * reaction on `exited` — a promise alive for the whole encode — at every
   * frame, and each kept its frame reachable: live, a 3s MP4 grew ~6.5 MB per
   * frame and a 30s one had the server OOM-killed at 3.5 GB, while the GIF
   * route (no race) stayed flat. One listener, removed as it fires, holds nothing.
   */
  private drained(stdin: Writable): Promise<void> {
    return new Promise(resolve => {
      const release = (): void => {
        stdin.off('drain', release);
        this.wake = null;
        resolve();
      };
      this.wake = release;
      stdin.on('drain', release);
    });
  }

  /** Close the input, wait for the encode, and move the finished file into place. */
  async finish(): Promise<{ bytes: number }> {
    this.child.stdin?.end();
    const code = await this.exited;
    this.done = true;
    if (code !== 0 || this.failure) {
      fs.rmSync(this.partial, { force: true });
      throw this.error(`ffmpeg exited with code ${String(code)}`);
    }
    fs.renameSync(this.partial, this.opts.outputPath);
    return { bytes: fs.statSync(this.opts.outputPath).size };
  }

  /** Stop the encode and leave nothing behind. */
  async abort(): Promise<void> {
    if (!this.done) {
      this.child.stdin?.destroy();
      this.child.kill('SIGKILL');
      await this.exited;
      this.done = true;
    }
    fs.rmSync(this.partial, { force: true });
  }

  private error(what: string): Error {
    const tail = this.stderr.trim().split('\n').slice(-3).join(' | ');
    const detail = [this.failure?.message, tail].filter(Boolean).join(' — ');
    return new Error(detail ? `${what}: ${detail}` : what);
  }
}
