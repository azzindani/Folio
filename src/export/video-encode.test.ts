import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ffmpegArgs, VideoPipe } from './video-encode';

const hasFfmpeg = ((): boolean => {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    execSync('ffprobe -version', { stdio: 'ignore' });
    return true;
  } catch { return false; }
})();

describe('ffmpegArgs', () => {
  const base = { width: 1080, height: 1350, fps: 30, outputPath: '/x/a.mp4' };

  it('reads raw RGBA from stdin at the canvas size and frame rate', () => {
    const a = ffmpegArgs({ ...base, type: 'mp4' }, '/x/a.mp4.partial');
    expect(a.join(' ')).toContain('-f rawvideo -pix_fmt rgba -s 1080x1350 -framerate 30 -i pipe:0');
    expect(a[a.length - 1]).toBe('/x/a.mp4.partial');
  });

  it('writes H.264 in yuv420p with the index up front for mp4', () => {
    const a = ffmpegArgs({ ...base, type: 'mp4' }, 't').join(' ');
    for (const part of ['-c:v libx264', '-pix_fmt yuv420p', '-movflags +faststart', '-f mp4']) expect(a).toContain(part);
  });

  it('writes VP9 for webm', () => {
    const a = ffmpegArgs({ ...base, type: 'webm' }, 't').join(' ');
    expect(a).toContain('-c:v libvpx-vp9');
    expect(a).toContain('-f webm');
  });

  it('pads an odd canvas rather than letting yuv420p refuse it', () => {
    expect(ffmpegArgs({ ...base, width: 1081, type: 'mp4' }, 't').join(' ')).toContain('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    expect(ffmpegArgs({ ...base, type: 'mp4' }, 't')).not.toContain('-vf');
  });
});

let dir = '';
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-video-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const frame = (w: number, h: number, shade: number): Uint8Array => {
  const px = new Uint8Array(w * h * 4);
  for (let p = 0; p < px.length; p += 4) px.set([shade & 255, 100, 200, 255], p);
  return px;
};

const probe = (file: string): Record<string, unknown> => {
  const out = execSync(
    `ffprobe -v error -count_frames -select_streams v:0 -show_entries ` +
    `stream=codec_name,width,height,nb_read_frames,pix_fmt,r_frame_rate -of json "${file}"`,
  ).toString();
  return (JSON.parse(out) as { streams: Record<string, unknown>[] }).streams[0] ?? {};
};

describe.skipIf(!hasFfmpeg)('VideoPipe with a real ffmpeg', () => {
  it('encodes an mp4 that reads back at the right size, rate and frame count', async () => {
    const out = path.join(dir, 'clip.mp4');
    const v = new VideoPipe({ type: 'mp4', width: 64, height: 48, fps: 10, outputPath: out });
    for (let i = 0; i < 20; i++) await v.write(frame(64, 48, i * 12));
    const { bytes } = await v.finish();
    expect(bytes).toBe(fs.statSync(out).size);
    expect(probe(out)).toMatchObject({
      codec_name: 'h264', width: 64, height: 48, pix_fmt: 'yuv420p', r_frame_rate: '10/1', nb_read_frames: '20',
    });
    expect(fs.readdirSync(dir)).toEqual(['clip.mp4']);
  });

  it('pads an odd canvas up to even dimensions', async () => {
    const out = path.join(dir, 'odd.mp4');
    const v = new VideoPipe({ type: 'mp4', width: 63, height: 47, fps: 5, outputPath: out });
    for (let i = 0; i < 5; i++) await v.write(frame(63, 47, i * 40));
    await v.finish();
    expect(probe(out)).toMatchObject({ width: 64, height: 48 });
  });

  it('encodes webm as VP9', async () => {
    const out = path.join(dir, 'clip.webm');
    const v = new VideoPipe({ type: 'webm', width: 64, height: 48, fps: 10, outputPath: out });
    for (let i = 0; i < 10; i++) await v.write(frame(64, 48, i * 20));
    await v.finish();
    expect(probe(out)).toMatchObject({ codec_name: 'vp9', width: 64, height: 48 });
  });

  it('abort leaves no file behind', async () => {
    const v = new VideoPipe({ type: 'mp4', width: 64, height: 48, fps: 10, outputPath: path.join(dir, 'gone.mp4') });
    await v.write(frame(64, 48, 1));
    await v.abort();
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('VideoPipe when the encoder dies mid-stream', () => {
  // A frame bigger than any pipe buffer makes write() park on 'drain'. The
  // encoder then exits without reading, so no drain ever comes — the close
  // handler has to release the writer, or the export hangs for ever.
  it('releases a write parked on a full pipe, with an error naming ffmpeg', async () => {
    const bin = process.platform === 'win32' ? 'folio-no-such-ffmpeg' : 'sh';
    const v = new VideoPipe({ type: 'mp4', width: 2000, height: 2000, fps: 1, outputPath: path.join(dir, 'x.mp4') }, bin);
    const run = async (): Promise<void> => {
      for (let i = 0; i < 4; i++) await v.write(new Uint8Array(2000 * 2000 * 4));
      await v.finish();
    };
    await expect(run()).rejects.toThrow(/ffmpeg/);
    await v.abort();
    expect(fs.readdirSync(dir)).toEqual([]);
  }, 20_000);
});

describe('VideoPipe without an encoder', () => {
  it('fails with a message that names ffmpeg, and leaves nothing behind', async () => {
    const v = new VideoPipe({ type: 'mp4', width: 4, height: 4, fps: 1, outputPath: path.join(dir, 'x.mp4') }, 'folio-no-such-ffmpeg');
    const run = async (): Promise<void> => {
      for (let i = 0; i < 50; i++) await v.write(new Uint8Array(64));
      await v.finish();
    };
    await expect(run()).rejects.toThrow(/ffmpeg/);
    await v.abort();
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
