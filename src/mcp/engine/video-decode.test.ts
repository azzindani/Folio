import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { pickFrame, showinfoTimes, jpegEnd, splitJpegs, frameEdge, decodeArgs } from './video-decode';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined;

/** A minimal marker-correct JPEG: SOI, a DQT holding FF D9, an SOS with stuffed and restart bytes, EOI. */
function fakeJpeg(fill: number): Buffer {
  const dqt = [0xFF, 0xDB, 0x00, 0x06, 0x00, 0xFF, 0xD9, fill];
  const sos = [0xFF, 0xDA, 0x00, 0x03, 0x01];
  const scan = [fill, 0xFF, 0x00, 0x12, 0xFF, 0xD3, 0x34, fill];
  return Buffer.from([0xFF, 0xD8, ...dqt, ...sos, ...scan, 0xFF, 0xD9]);
}

describe('pickFrame — the frame showing at a moment', () => {
  const starts = [0, 33.3333, 66.6667, 100];
  it('takes the latest frame starting at or before the moment', () => {
    expect(pickFrame(starts, 0)).toBe(0);
    expect(pickFrame(starts, 50)).toBe(1);
    expect(pickFrame(starts, 33.333)).toBe(1);   // inside the timestamp slack
    expect(pickFrame(starts, 5000)).toBe(3);     // past the last: hold it
  });
  it('before the first frame shows the first; nothing decoded is -1', () => {
    expect(pickFrame([40, 80], 10)).toBe(0);
    expect(pickFrame([], 10)).toBe(-1);
  });
});

describe('showinfoTimes', () => {
  it('reads pts_time from showinfo frame lines only', () => {
    const log = [
      '[Parsed_showinfo_0 @ 0x55] config in time_base: 1/15360, frame_rate: 30/1',
      '[Parsed_showinfo_0 @ 0x55] n:   0 pts:    205 pts_time:0.0133464 duration:    512 fmt:yuv420p',
      '[Parsed_showinfo_0 @ 0x55] n:   1 pts:    717 pts_time:0.0466797 duration:    512 fmt:yuv420p',
      '[Parsed_showinfo_0 @ 0x55] n:   2 pts:   1229 pts_time:1e-05 duration:    512',
    ].join('\n');
    expect(showinfoTimes(log)).toEqual([0.0133464, 0.0466797, 1e-5]);
  });
});

describe('jpegEnd / splitJpegs', () => {
  it('walks markers, so an FF D9 inside a table or stuffed scan data does not end the frame', () => {
    const a = fakeJpeg(0x11);
    expect(jpegEnd(a)).toBe(a.length);
  });
  it('splits a pipe of frames and keeps a partial one for later', () => {
    const a = fakeJpeg(0x11), b = fakeJpeg(0x22);
    const { frames, rest } = splitJpegs(Buffer.concat([a, b, b.subarray(0, 9)]));
    expect(frames.map(f => f.equals(a) || f.equals(b))).toEqual([true, true]);
    expect(rest.length).toBe(9);
    expect(jpegEnd(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBe(-1);
  });
});

describe('frameEdge', () => {
  it('decodes at 1.5× the box, between 16 px and full HD', () => {
    expect(frameEdge(640, 360)).toBe(960);
    expect(frameEdge(4000, 10)).toBe(1920);
    expect(frameEdge(4, 4)).toBe(16);
  });
});

describe.skipIf(!hasFfmpeg)('decodeArgs against a real clip', () => {
  it('yields one logged timestamp per MJPEG frame, on the file clock', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-vdecode-'));
    try {
      const file = path.join(dir, 'c.mp4');
      spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=3',
        '-c:v', 'libx264', '-g', '10', '-pix_fmt', 'yuv420p', '-y', file], { timeout: 30_000 });
      const r = spawnSync('ffmpeg', decodeArgs(file, 1000, 160, { ms: 500 }), { maxBuffer: 16 * 1024 * 1024 });
      const { frames, rest } = splitJpegs(r.stdout);
      const times = showinfoTimes(r.stderr.toString());
      expect(frames.length).toBe(5);
      expect(times.length).toBe(frames.length);
      expect(rest.length).toBe(0);
      expect(1000 + (times[0] ?? -1) * 1000).toBeCloseTo(1000, 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);
});
