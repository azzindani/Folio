import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { stamp, distinctTiles, sampleArgs, isVideoAsset, storyboardRead, TILE_W, TILE_H, type Tile } from './asset-storyboard';
import { resvgFontOption } from './fonts';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;
const solid = (ms: number, v: number): Tile => ({ ms, rgb: Buffer.alloc(TILE_W * TILE_H * 3, v) });

describe('storyboard pieces', () => {
  it('stamps times on the file clock as m:ss.s', () => {
    expect(stamp(0)).toBe('0:00.0');
    expect(stamp(65_250)).toBe('1:05.3');
  });
  it('drops near-identical samples, keeping the first of each shot', () => {
    const kept = distinctTiles([solid(0, 10), solid(100, 12), solid(200, 200), solid(300, 201), solid(400, 10)]);
    expect(kept.map(t => t.ms)).toEqual([0, 200, 400]);
  });
  it('decodes every frame of a short window, only keyframes of a long one', () => {
    expect(sampleArgs('/c.mp4', 0, 10_000).join(' ')).toContain('fps=12.0000');
    expect(sampleArgs('/c.mp4', 0, 10_000)).not.toContain('-skip_frame');
    expect(sampleArgs('/c.mp4', 0, 120_000)).toContain('nokey');
  });
  it('knows a clip by its extension', () => {
    expect(isVideoAsset('assets/video/a.MOV')).toBe(true);
    expect(isVideoAsset('assets/docs/a.md')).toBe(false);
  });
});

describe.skipIf(!hasFfmpeg)('storyboardRead', () => {
  let dir = '', file = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-story-'));
    file = path.join(dir, 'two-shots.mp4');
    // Two shots: 2 s red, then 2 s blue.
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=10:d=2', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10:d=2',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', file], { timeout: 30_000 });
  }, 60_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('one image, one tile per shot, times on the file clock', async () => {
    const r = await storyboardRead('assets/video/two-shots.mp4', file, {}, resvgFontOption()) as unknown as {
      success: boolean; tiles: Array<{ ms: number }>; duration_ms: number; _attachments: Array<{ mimeType: string; data: string }>;
    };
    expect(r.success).toBe(true);
    expect(r.tiles.length).toBe(2);
    expect(r.tiles[0]?.ms).toBeLessThan(200);
    expect(Math.abs((r.tiles[1]?.ms ?? 0) - 2000)).toBeLessThan(200);
    expect(r._attachments[0]?.mimeType).toBe('image/png');
    expect(Buffer.from(r._attachments[0]?.data ?? '', 'base64').subarray(1, 4).toString()).toBe('PNG');
  }, 30_000);

  it('a window zooms in: only the second shot', async () => {
    const r = await storyboardRead('x.mp4', file, { from_ms: 2500, to_ms: 4000 }, resvgFontOption()) as unknown as { tiles: Array<{ ms: number }>; window: { from_ms: number } };
    expect(r.window.from_ms).toBe(2500);
    expect(r.tiles.length).toBe(1);
    expect(r.tiles[0]?.ms).toBeGreaterThanOrEqual(2500);
  }, 30_000);
});
