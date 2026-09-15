import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { rasterize, rasterizeSync, renderInProcess, RasterWorker, RasterCrash } from './resvg-isolate';

// The child runs as TypeScript, so it needs bun — the server's own runtime. Node
// (CI) skips the child tests; the deploy check drives them on the live server.
const hasBun = spawnSync('bun', ['--version']).status === 0;
const BUN = { isolate: true, runtime: 'bun' };
const SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect x="10" y="5" width="20" height="20" fill="#E4572E"/></svg>';
// The shape that aborted resvg 2.6.2 on the live server: a clip whose content sits far off the canvas.
const ABORT = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">'
  + '<defs><clipPath id="c" clipPathUnits="userSpaceOnUse"><rect x="80" y="130" width="300" height="150"/></clipPath></defs>'
  + '<g clip-path="url(#c)"><g transform="translate(-3000 0)"><rect x="80" y="130" width="300" height="150" fill="#fff"/></g></g></svg>';

describe('rasterize in-process (node)', () => {
  it('hands back the png and the pixels asked for', () => {
    const r = rasterize({ svg: SQUARE, want: 'both' }, { isolate: false });
    expect([r.width, r.height, r.pixels.length]).toEqual([40, 30, 40 * 30 * 4]);
    expect(r.png.subarray(1, 4).toString('ascii')).toBe('PNG');
  });
});

describe.skipIf(!hasBun)('rasterize in a child process', () => {
  it('renders the same pixels as in-process', () => {
    const [shot] = rasterizeSync([{ svg: SQUARE, want: 'pixels' }], BUN);
    expect(shot?.pixels.equals(renderInProcess({ svg: SQUARE, want: 'pixels' }).pixels)).toBe(true);
  }, 20_000);

  it('an abort fails that render with a RasterCrash naming the image, and this process carries on', () => {
    let caught: unknown;
    try { rasterizeSync([{ svg: SQUARE }, { svg: ABORT }, { svg: SQUARE }], BUN); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(RasterCrash);
    expect((caught as Error).message).toContain('image 2 of 3');
    expect(rasterize({ svg: SQUARE }, BUN).width).toBe(40);
  }, 20_000);

  it('an SVG resvg refuses is an ordinary error, not a crash', () => {
    let caught: unknown;
    try { rasterize({ svg: '<svg' }, BUN); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(RasterCrash);
  }, 20_000);

  it('a worker answers frames in order, and a fresh child takes over after an abort', async () => {
    const worker = new RasterWorker(BUN);
    const [a, b] = await Promise.all([
      worker.render({ svg: SQUARE, want: 'pixels' }),
      worker.render({ svg: SQUARE.replace('width="40"', 'width="50"'), want: 'pixels' }),
    ]);
    expect([a.width, b.width, b.pixels.length]).toEqual([40, 50, 50 * 30 * 4]);
    await expect(worker.render({ svg: ABORT })).rejects.toBeInstanceOf(RasterCrash);
    expect((await worker.render({ svg: SQUARE })).width).toBe(40);
    worker.close();
  }, 30_000);
});
