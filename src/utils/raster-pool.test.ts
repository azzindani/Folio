// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { RasterPool, workerCount, type FrameRenderer } from './raster-pool';
import type { Raster, RasterJob } from './resvg-isolate';

/** A renderer that answers when told to, and records what it was asked. */
function fakeRenderer(log: string[], name: string): FrameRenderer & { finish(): void } {
  const pending: Array<() => void> = [];
  return {
    render: (job: RasterJob) => new Promise<Raster>(resolve => {
      log.push(`${name}:${job.svg}`);
      pending.push(() => resolve({ width: job.svg.length, height: 1, png: Buffer.alloc(0), pixels: Buffer.alloc(0) }));
    }),
    close: () => { log.push(`${name}:closed`); },
    finish: () => { for (const p of pending.splice(0)) p(); },
  };
}

afterEach(() => { delete process.env['FOLIO_RENDER_WORKERS']; });

describe('RasterPool', () => {
  it('starts a renderer per frame until full, then gives each frame to the least busy one', async () => {
    const log: string[] = [];
    const made: Array<ReturnType<typeof fakeRenderer>> = [];
    const pool = new RasterPool({}, 2, () => { const r = fakeRenderer(log, `w${made.length}`); made.push(r); return r; });
    const frames = ['a', 'bb', 'ccc'].map(svg => pool.render({ svg }));
    expect(log).toEqual(['w0:a', 'w1:bb', 'w0:ccc']);
    for (const r of made) r.finish();
    expect((await Promise.all(frames)).map(r => r.width)).toEqual([1, 2, 3]);
    pool.render({ svg: 'dddd' });
    expect(log.at(-1)).toBe('w0:dddd');
    pool.close();
    expect(log.filter(l => l.endsWith('closed'))).toHaveLength(2);
  });

  it('frees a renderer\'s slot when its frame fails', async () => {
    const pool = new RasterPool({}, 1, () => ({ render: () => Promise.reject(new Error('resvg gave up')), close: () => undefined }));
    await expect(pool.render({ svg: 'x' })).rejects.toThrow('resvg gave up');
    await expect(pool.render({ svg: 'y' })).rejects.toThrow('resvg gave up');
  });

  it('renders real frames in process, each answer for its own job', async () => {
    const pool = new RasterPool({ isolate: false }, 3);
    const svg = (w: number): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="10"><rect width="${w}" height="10" fill="#E4572E"/></svg>`;
    const out = await Promise.all([12, 24, 36, 48].map(w => pool.render({ svg: svg(w), want: 'pixels' })));
    expect(out.map(r => r.width)).toEqual([12, 24, 36, 48]);
    pool.close();
  });
});

describe('workerCount', () => {
  it('uses one renderer in process, honours FOLIO_RENDER_WORKERS, and never more than 8', () => {
    expect(workerCount({ isolate: false })).toBe(1);
    const isolated = workerCount({ isolate: true });
    expect(isolated).toBeGreaterThanOrEqual(1);
    expect(isolated).toBeLessThanOrEqual(3);
    process.env['FOLIO_RENDER_WORKERS'] = '5';
    expect(workerCount({ isolate: false })).toBe(5);
    process.env['FOLIO_RENDER_WORKERS'] = '40';
    expect(workerCount()).toBe(8);
  });
});
