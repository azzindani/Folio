import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { ClipStream } from './video-stream';
import { jpegFormat } from './video-decode';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined;

// A 3 s clip at 10 fps whose frames differ, so "which frame" is visible in the bytes.
describe.skipIf(!hasFfmpeg)('ClipStream', () => {
  let dir = '', file = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-vstream-'));
    file = path.join(dir, 'c.mp4');
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=3',
      '-c:v', 'libx264', '-g', '10', '-pix_fmt', 'yuv420p', '-y', file], { timeout: 30_000 });
  }, 60_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('answers moments in order from ONE decoder: same frame inside a frame, a new one at the next', async () => {
    const s = new ClipStream(file, jpegFormat(160));
    try {
      const a = await s.frameAt(1000), b = await s.frameAt(1050), c = await s.frameAt(1100), d = await s.frameAt(1900);
      expect(a && b && c && d).toBeTruthy();
      expect(a?.equals(b ?? Buffer.alloc(0))).toBe(true);    // 1000 and 1050 are both frame 10
      expect(a?.equals(c ?? Buffer.alloc(0))).toBe(false);   // 1100 is frame 11
      expect(s.starts).toBe(1);
    } finally { s.close(); }
  }, 30_000);

  it('seeks again for a moment behind it or far ahead, and holds the last frame past the end', async () => {
    const s = new ClipStream(file, jpegFormat(160));
    try {
      const late = await s.frameAt(2000);
      const early = await s.frameAt(200);
      expect(s.starts).toBe(2);
      expect(early?.equals(late ?? Buffer.alloc(0))).toBe(false);
      const end = await s.frameAt(2950), past = await s.frameAt(60_000), past2 = await s.frameAt(61_000);
      expect(past?.equals(end ?? Buffer.alloc(0))).toBe(true);
      expect(past2?.equals(end ?? Buffer.alloc(0))).toBe(true);
    } finally { s.close(); }
  }, 30_000);

  it('matches a fresh decoder seeked straight to the moment', async () => {
    const long = new ClipStream(file, jpegFormat(160));
    const fresh = new ClipStream(file, jpegFormat(160));
    try {
      for (const ms of [0, 700]) await long.frameAt(ms);
      const viaStream = await long.frameAt(1234);
      const viaSeek = await fresh.frameAt(1234);
      expect(viaStream?.equals(viaSeek ?? Buffer.alloc(0))).toBe(true);
    } finally { long.close(); fresh.close(); }
  }, 30_000);

  it('a file ffmpeg cannot read gives null and keeps the reason', async () => {
    const s = new ClipStream(path.join(dir, 'missing.mp4'), jpegFormat(160));
    try {
      expect(await s.frameAt(0)).toBeNull();
      expect(s.tail).toMatch(/No such file|missing/i);
    } finally { s.close(); }
  }, 30_000);
});
