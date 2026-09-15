/**
 * Several resvg renderer processes for one export — frames rasterise in parallel.
 *
 * Measured in the container on the 32 s promo (1920×1080): composing a frame
 * takes ~5 ms and building its SVG ~16–23 ms, but rasterising it takes ~89 ms,
 * and every frame queued behind ONE child while the host had 4 cores. resvg
 * renders a frame on one thread, so N children render N frames at once.
 *
 * The pool does not order anything: an export keeps each frame's promise in
 * frame order and awaits the oldest, so the encoder still receives frames in
 * sequence. A child that dies fails its own frames through RasterWorker, and the
 * export fails as it did with one child. The server process never loads resvg.
 */

import * as os from 'os';
import { RasterWorker, isolationDefault, type IsolateOptions, type Raster, type RasterJob } from './resvg-isolate';

/** The part of RasterWorker the pool uses — injectable for tests. */
export interface FrameRenderer { render(job: RasterJob): Promise<Raster>; close(): void }

const MAX_WORKERS = 8;

/**
 * How many renderer processes an export uses: FOLIO_RENDER_WORKERS when set
 * (1–8); otherwise one core is left for the server, capped at 3 so a render
 * never takes a shared host whole. In-process rendering (node, tests) blocks
 * its own thread, so it gets one.
 */
export function workerCount(o: IsolateOptions = {}): number {
  const env = Number(process.env['FOLIO_RENDER_WORKERS']);
  if (Number.isInteger(env) && env > 0) return Math.min(MAX_WORKERS, env);
  if (!(o.isolate ?? isolationDefault())) return 1;
  return Math.min(3, Math.max(1, os.cpus().length - 1));
}

export class RasterPool {
  private readonly workers: Array<{ renderer: FrameRenderer; busy: number }> = [];
  readonly size: number;

  constructor(
    private readonly o: IsolateOptions = {},
    size = workerCount(o),
    private readonly make: () => FrameRenderer = () => new RasterWorker(o),
  ) {
    this.size = Math.max(1, Math.min(MAX_WORKERS, Math.round(size)));
  }

  /** Render on the least busy renderer, starting another while the pool has room. */
  render(job: RasterJob): Promise<Raster> {
    const idle = this.workers.find(w => w.busy === 0);
    const slot = idle ?? (this.workers.length < this.size ? this.spawn() : this.leastBusy());
    slot.busy++;
    const done = (): void => { slot.busy--; };
    return slot.renderer.render(job).then(r => { done(); return r; }, (e: unknown) => { done(); throw e; });
  }

  close(): void {
    for (const w of this.workers.splice(0)) w.renderer.close();
  }

  private spawn(): { renderer: FrameRenderer; busy: number } {
    const slot = { renderer: this.make(), busy: 0 };
    this.workers.push(slot);
    return slot;
  }

  private leastBusy(): { renderer: FrameRenderer; busy: number } {
    let best = this.workers[0];
    for (const w of this.workers) if (!best || w.busy < best.busy) best = w;
    return best ?? this.spawn();
  }
}
