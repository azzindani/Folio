import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { Layer } from '../../schema/types';
import { FootageFeed } from './video-feed';
import { plainClip } from './footage-bands';
import { videoFrameUri } from './video-frame';
import type { ClipCrop } from '../../animation/clip-crop';
import { colorMatrix, contrastLine } from '../../animation/clip-color';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;

/** Mean RGB of an RGBA buffer. */
const mean = (px: Buffer): number[] => {
  const s = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) { s[0] = (s[0] ?? 0) + (px[i] ?? 0); s[1] = (s[1] ?? 0) + (px[i + 1] ?? 0); s[2] = (s[2] ?? 0) + (px[i + 2] ?? 0); }
  return s.map(v => Math.round(v / (px.length / 4)));
};
const near = (rgb: number[], want: number[]): boolean => rgb.every((v, i) => Math.abs(v - (want[i] ?? 0)) < 40);
const RED = [255, 0, 0], WHITE = [255, 255, 255];

describe.skipIf(!hasFfmpeg)('pan and zoom inside the footage', () => {
  let dir = '', file = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-crop-'));
    file = path.join(dir, 'quads.mp4');
    // Four quadrants: red top-left, green top-right, blue bottom-left, white bottom-right.
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=2', '-f', 'lavfi', '-i', 'color=c=green:s=160x90:d=2',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=2', '-f', 'lavfi', '-i', 'color=c=white:s=160x90:d=2',
      '-filter_complex', '[0][1]hstack[t];[2][3]hstack[b];[t][b]vstack,format=yuv420p[v]', '-map', '[v]', '-r', '10', '-c:v', 'libx264', '-y', file], { timeout: 60_000 });
  }, 90_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const clip = (video: Record<string, unknown>, ms = 0): Layer =>
    ({ id: 'q', type: 'video', x: 0, y: 0, width: 160, height: 90, src: 'q.mp4', _video_file: file, _video_ms: ms, video: { offset_ms: 0, ...video } }) as unknown as Layer;

  it('a fixed crop: zoom 2 at focus [0,0] keeps the top-left quarter, at [1,1] the bottom-right', async () => {
    const feed = new FootageFeed();
    const tl = plainClip(clip({ focus: [0, 0], zoom: 2 }));
    const br = plainClip(clip({ focus: [1, 1], zoom: 2 }));
    if (!tl || !br) throw new Error('not plain');
    expect(near(mean((await feed.pixelsAt(tl, 160, 90)) ?? Buffer.alloc(4)), RED)).toBe(true);
    expect(near(mean((await feed.pixelsAt(br, 160, 90)) ?? Buffer.alloc(4)), WHITE)).toBe(true);
    feed.close?.();
  }, 60_000);

  it('a pan: one decoder, the crop at each frame\'s file moment', async () => {
    const feed = new FootageFeed();
    const pan = { pan: [{ at_ms: 0, focus: [0, 0], zoom: 2 }, { at_ms: 1000, focus: [1, 1] }] };
    const at0 = plainClip(clip(pan, 0)), at15 = plainClip(clip(pan, 1500));
    if (!at0 || !at15) throw new Error('not plain');
    expect(near(mean((await feed.pixelsAt(at0, 160, 90)) ?? Buffer.alloc(4)), RED)).toBe(true);
    expect(near(mean((await feed.pixelsAt(at15, 160, 90)) ?? Buffer.alloc(4)), WHITE)).toBe(true);
    expect(feed.stats().clips).toBe(1);
    feed.close?.();
  }, 60_000);

  it('the renderer\'s frame comes cut to the box the same way', () => {
    const crop: ClipCrop = { focus: [0, 0], zoom: 2 };
    const uri = videoFrameUri(file, 0, 160, 90, 'ffmpeg', { crop });
    expect(uri).toMatch(/^data:image\/jpeg;base64,/);
    const jpeg = Buffer.from((uri ?? '').split(',')[1] ?? '', 'base64');
    const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { input: jpeg }).stdout;
    expect(near(mean(raw), RED)).toBe(true);
  });
});

describe.skipIf(!hasFfmpeg)('a clip graded while it decodes', () => {
  let dir = '', file = '', lut = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-grade-'));
    file = path.join(dir, 'grey.mp4');
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x806040:s=160x90:d=1', '-r', '10', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-crf', '0', '-y', file], { timeout: 30_000 });
    // A 2-point LUT that inverts every channel.
    lut = path.join(dir, 'invert.cube');
    const rows: string[] = [];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${1 - r} ${1 - g} ${1 - b}`);
    fs.writeFileSync(lut, `LUT_3D_SIZE 2\n${rows.join('\n')}\n`);
  }, 60_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const graded = (color: Record<string, unknown>, lutFile?: string): Layer =>
    ({ id: 'g', type: 'video', x: 0, y: 0, width: 160, height: 90, src: 'g.mp4', _video_file: file, _video_ms: 0, ...(lutFile ? { _video_lut: lutFile } : {}), video: { offset_ms: 0, color } }) as unknown as Layer;

  it('the pixels match the grade\'s own arithmetic', async () => {
    const feed = new FootageFeed();
    const slot = plainClip(graded({ exposure: 0.5, saturation: -0.5, temperature: 0.4, contrast: 0.2 }));
    if (!slot) throw new Error('not plain');
    const got = mean((await feed.pixelsAt(slot, 160, 90)) ?? Buffer.alloc(4));
    const m = colorMatrix({ exposure: 0.5, saturation: -0.5, temperature: 0.4, contrast: 0.2 }), line = contrastLine({ contrast: 0.2 });
    const src = [0x80, 0x60, 0x40].map(v => v / 255);
    const want = m.map(row => Math.round(Math.max(0, Math.min(1, row.reduce((s, v, j) => s + v * (src[j] ?? 0), 0) * line.slope + line.intercept)) * 255));
    got.forEach((v, i) => expect(Math.abs(v - (want[i] ?? 0))).toBeLessThanOrEqual(4));
    feed.close?.();
  }, 60_000);

  it('a LUT runs after the grade', async () => {
    const feed = new FootageFeed();
    const slot = plainClip(graded({ lut: 'assets/docs/invert.cube' }, lut));
    if (!slot) throw new Error('not plain');
    const got = mean((await feed.pixelsAt(slot, 160, 90)) ?? Buffer.alloc(4));
    [255 - 0x80, 255 - 0x60, 255 - 0x40].forEach((v, i) => expect(Math.abs((got[i] ?? 0) - v)).toBeLessThanOrEqual(4));
    feed.close?.();
  }, 60_000);
});
