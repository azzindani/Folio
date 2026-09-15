/**
 * resvg, kept out of the server's own process.
 *
 * Found live (2026-09-15): resvg-js 2.6.2 panicked on a video frame (geom.rs:27,
 * Option::unwrap on None). A panic there cannot unwind — "failed to initiate
 * panic" — so it aborted the whole MCP server mid-render, and every open session
 * with it. frame-cull.ts removes the one trigger found; this removes the blast
 * radius of the ones not found yet. Under bun (the server) every rasterisation
 * runs in a child process (resvg-child.ts), so an abort fails that render with a
 * RasterCrash and the server keeps serving. Under node (vitest, CI) the child
 * cannot run as TypeScript, so it renders in-process as before.
 * FOLIO_RESVG_ISOLATE=0|1 overrides either way.
 */

import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as path from 'path';
import type { ResvgRenderOptions } from '@resvg/resvg-js';

export type Want = 'png' | 'pixels' | 'both';
export interface Raster { width: number; height: number; png: Buffer; pixels: Buffer }
export interface RasterJob { svg: string; opts?: ResvgRenderOptions; want?: Want }
/** `runtime` is the executable that runs the child (default: this process's own). */
export interface IsolateOptions { isolate?: boolean; runtime?: string }

/** The renderer process died — the render failed, the server did not. */
export class RasterCrash extends Error {}

export const CHILD_SCRIPT = path.join(__dirname, 'resvg-child.ts');
const EMPTY = Buffer.alloc(0);

export function isolationDefault(): boolean {
  const env = process.env['FOLIO_RESVG_ISOLATE'];
  if (env === '0' || env === '1') return env === '1';
  return typeof process.versions['bun'] === 'string';
}

export function renderInProcess(job: RasterJob): Raster {
  // Required here, not imported: an isolated server never maps resvg into its own process.
  const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js');
  const img = new Resvg(job.svg, job.opts ?? {}).render();
  const want = job.want ?? 'png';
  return {
    width: img.width, height: img.height,
    png: want === 'pixels' ? EMPTY : Buffer.from(img.asPng()),
    pixels: want === 'png' ? EMPTY : Buffer.from(img.pixels),
  };
}

export function frameRequest(job: RasterJob): Buffer {
  const body = Buffer.from(JSON.stringify({ svg: job.svg, opts: job.opts ?? {}, want: job.want ?? 'png' }));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  return Buffer.concat([len, body]);
}

type Head = { ok: boolean; width?: number; height?: number; error?: string; png: number; pixels: number };

/** Bytes needed before the first reply in `buf` is complete (0 when it already is). */
export function bytesWanted(buf: Buffer): number {
  if (buf.length < 4) return 4;
  const hl = buf.readUInt32LE(0);
  if (buf.length < 4 + hl) return 4 + hl;
  const head = JSON.parse(buf.subarray(4, 4 + hl).toString('utf8')) as Head;
  const total = 4 + hl + head.png + head.pixels;
  return buf.length >= total ? 0 : total;
}

/** Every complete reply at the front of `buf`, and the incomplete remainder. */
export function readReplies(buf: Buffer): { replies: Array<Raster | Error>; rest: Buffer } {
  const replies: Array<Raster | Error> = [];
  let at = 0;
  while (bytesWanted(buf.subarray(at)) === 0) {
    const hl = buf.readUInt32LE(at);
    const head = JSON.parse(buf.subarray(at + 4, at + 4 + hl).toString('utf8')) as Head;
    const start = at + 4 + hl, end = start + head.png + head.pixels;
    replies.push(head.ok
      ? { width: head.width ?? 0, height: head.height ?? 0, png: buf.subarray(start, start + head.png), pixels: buf.subarray(start + head.png, end) }
      : new Error(head.error ?? 'resvg could not render this SVG'));
    at = end;
  }
  return { replies, rest: buf.subarray(at) };
}

export function crashMessage(what: string, how: string, stderr: string): string {
  const tail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
  return `The renderer process died on ${what} (${how}) — this render failed; the server is unaffected.${tail ? ` resvg said: ${tail}` : ''}`;
}

/** Rasterise a batch, blocking as resvg itself does — in one child process when isolated. */
export function rasterizeSync(jobs: RasterJob[], o: IsolateOptions = {}): Raster[] {
  if (jobs.length === 0) return [];
  if (!(o.isolate ?? isolationDefault())) return jobs.map(renderInProcess);
  const r = spawnSync(o.runtime ?? process.execPath, [CHILD_SCRIPT], { input: Buffer.concat(jobs.map(frameRequest)), maxBuffer: 2 ** 31 - 1 });
  if (r.error) throw r.error;
  const { replies } = readReplies(r.stdout ?? EMPTY);
  if (replies.length < jobs.length) {
    const what = jobs.length > 1 ? `image ${replies.length + 1} of ${jobs.length}` : 'this image';
    throw new RasterCrash(crashMessage(what, r.signal ?? `exit ${String(r.status)}`, String(r.stderr ?? '')));
  }
  return replies.map(x => { if (x instanceof Error) throw x; return x; });
}

/** One image — the common case. */
export function rasterize(job: RasterJob, o?: IsolateOptions): Raster {
  return rasterizeSync([job], o)[0] as Raster;
}

/** One renderer process for a run of frames — a video export — answering in order. */
export class RasterWorker {
  private child: ChildProcess | null = null;
  private chunks: Buffer[] = [];
  private size = 0;
  private need = 4;
  private stderr = '';
  private served = 0;
  private readonly waiting: Array<{ resolve: (r: Raster) => void; reject: (e: Error) => void }> = [];
  private readonly o: IsolateOptions;

  constructor(o: IsolateOptions = {}) { this.o = o; }

  render(job: RasterJob): Promise<Raster> {
    if (!(this.o.isolate ?? isolationDefault())) {
      try { return Promise.resolve(renderInProcess(job)); } catch (e) { return Promise.reject(e as Error); }
    }
    const child = this.child ?? this.start();
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      child.stdin?.write(frameRequest(job));
    });
  }

  /** Let the child answer what it has, then exit. */
  close(): void {
    this.child?.stdin?.end();
    this.child = null;
  }

  private start(): ChildProcess {
    const child = spawn(this.o.runtime ?? process.execPath, [CHILD_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.chunks = []; this.size = 0; this.need = 4; this.stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => this.take(chunk));
    child.stderr?.on('data', (c: Buffer) => { this.stderr = (this.stderr + c.toString()).slice(-4000); });
    child.stdin?.on('error', () => { /* a dead child is reported once its streams close */ });
    // 'close', not 'exit': by then every byte the child wrote has been read.
    child.on('close', (code, signal) => {
      if (this.child === child) this.child = null;
      const how = signal ?? `exit ${String(code)}`;
      for (const w of this.waiting.splice(0)) w.reject(new RasterCrash(crashMessage(`frame ${this.served + 1}`, how, this.stderr)));
    });
    this.child = child;
    return child;
  }

  /** Join chunks only once a whole reply is in: a 1080p frame arrives in ~70 pieces. */
  private take(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    if (this.size < this.need) return;
    const { replies, rest } = readReplies(Buffer.concat(this.chunks, this.size));
    for (const r of replies) {
      this.served++;
      const w = this.waiting.shift();
      if (r instanceof Error) w?.reject(r); else w?.resolve(r);
    }
    this.chunks = rest.length ? [rest] : [];
    this.size = rest.length;
    this.need = bytesWanted(rest);
  }
}
