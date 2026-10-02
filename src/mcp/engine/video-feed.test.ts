import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { DesignSpec } from '../../schema/types';
import { resolveImageAssets } from './asset-resolve';
import { renderToSVGString } from './svg-export';
import { specAt } from '../../export/gif-frames';
import { FootageFeed, frameRequests } from './video-feed';
import { videoFrameUri } from './video-frame';
import { exportRasterMotion } from './motion-export-raster';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined;
const uriOf = (svg: string): string => /href="(data:image\/jpeg;base64,[^"]+)"/.exec(svg)?.[1] ?? '';

describe.skipIf(!hasFfmpeg)('FootageFeed — an export decodes each clip once', () => {
  let dir = '';
  const design = (): string => path.join(dir, 'designs', 'd.design.yaml');
  const spec = (src: string): DesignSpec => ({
    meta: { name: 'v', version: '1' }, document: { width: 320, height: 180, unit: 'px' },
    layers: [{ id: 'clip', type: 'video', x: 0, y: 0, width: 320, height: 180, z: 1, src, fit: 'cover', video: { offset_ms: 500, duration_ms: 2000 } }],
  } as unknown as DesignSpec);
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-vfeed-'));
    fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets', 'video'), { recursive: true });
    const take = path.join(dir, 'assets', 'video', 'take.mp4');
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=3', '-c:v', 'libx264', '-g', '10',
      '-pix_fmt', 'yuv420p', '-y', take], { timeout: 30_000 });
    fs.copyFileSync(take, path.join(dir, 'assets', 'video', 'twin.mp4'));
  }, 60_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('finds every video layer a frame draws, with its moment', () => {
    const s = spec('assets/video/take.mp4');
    resolveImageAssets(s, design(), dir);
    expect(frameRequests(specAt(s, 0, 700)).map(r => [r.id, r.ms])).toEqual([['clip', 1200]]);
  });

  it('primes each frame from one stream, and a preview of the same moment picks the same frame', async () => {
    const s = spec('assets/video/take.mp4');
    resolveImageAssets(s, design(), dir);
    const feed = new FootageFeed();
    const uris: string[] = [];
    try {
      for (let t = 0; t < 1000; t += 100) {
        const at = specAt(s, 0, t);
        await feed.prepare(at);
        uris.push(uriOf(renderToSVGString(at)));
      }
      expect(feed.stats()).toEqual({ clips: 1, seeks: 1 });
    } finally { feed.close(); }
    expect(new Set(uris).size).toBe(10);
    // A clip ffmpeg has never streamed (its byte-identical twin) decoded the preview way.
    const twin = path.join(dir, 'assets', 'video', 'twin.mp4');
    expect(videoFrameUri(twin, 1200, 320, 180)).toBe(uris[7]);
  }, 30_000);

  it('a raster export reports its decoders: one clip, one seek', async () => {
    const s = spec('assets/video/take.mp4');
    const out = path.join(dir, 'out.mp4');
    const r = await exportRasterMotion(s, design(), { durationMs: 1000, at: t => specAt(s, 0, t) }, out, { type: 'mp4', fps: 10, project_path: dir });
    const body = r as unknown as { success: boolean; error?: string; frames?: number; footage_decoders?: unknown };
    expect(body.error).toBeUndefined();
    expect(body.frames).toBe(10);
    expect(body.footage_decoders).toEqual({ clips: 1, seeks: 1 });
    fs.rmSync(out, { force: true });
  }, 60_000);
});
