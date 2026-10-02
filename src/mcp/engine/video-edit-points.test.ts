import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { parseFrames, shotCuts, bucketFor, bucketMeans, motionArgs, editPoints, SHOT_SCORE } from './video-edit-points';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined;

describe('edit point arithmetic', () => {
  it('reads one key per printed frame on the file clock; -inf reads as NaN', () => {
    const out = 'frame:0 pts:0 pts_time:0\nlavfi.scd.mafd=0.5\nlavfi.scd.score=0\nframe:1 pts:512 pts_time:0.0333\nlavfi.scd.score=42.5\nframe:2 pts:1024 pts_time:0.0667\nx.y=-inf\n';
    expect(parseFrames(out, 1000, 'lavfi.scd.score')).toEqual([{ ms: 1000, v: 0 }, { ms: 1033, v: 42.5 }]);
    expect(Number.isNaN(parseFrames(out, 0, 'x.y')[0]?.v)).toBe(true);
  });
  it('a cut is a frame scoring past the threshold; a flash within 300 ms is the same cut', () => {
    const r = shotCuts([{ ms: 100, v: 2 }, { ms: 2000, v: SHOT_SCORE + 5 }, { ms: 2100, v: 60 }, { ms: 4000, v: 30 }]);
    expect(r).toEqual({ cuts: [2100, 4000], dropped: 0 });
  });
  it('buckets stay 500 ms on short windows and grow to keep a long one under 40', () => {
    expect(bucketFor(0, 10_000)).toBe(500);
    expect(bucketFor(0, 600_000)).toBe(15_000);
    expect(bucketMeans([{ ms: 0, v: 2 }, { ms: 400, v: 4 }, { ms: 1200, v: 1 }], 0, 1500, 500)).toEqual([3, null, 1]);
  });
  it('scales down before scoring, and prints every frame', () => {
    expect(motionArgs('/c.mp4', 0, 5000).join(' ')).toContain("scale=160:-2,scdet=threshold=10,metadata=mode=print:file='pipe\\:1'");
  });
});

describe.skipIf(!hasFfmpeg)('editPoints on a real clip', () => {
  let dir = '', file = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-edit-points-'));
    file = path.join(dir, 'three.mp4');
    // Three shots of 2 s — still red, moving test card, still blue — over a tone that drops at 3 s.
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=2',
      '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=300:d=6',
      '-filter_complex', "[0:v][1:v][2:v]concat=n=3:v=1[v];[3:a]volume='if(lt(t,3),1,0.05)':eval=frame[a]",
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', file], { timeout: 60_000 });
  }, 90_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('finds the two cuts, the moving shot and the quiet half — in a window too', async () => {
    const r = await editPoints(file, 0, 6000, true);
    expect(r.shots).toEqual([2000, 4000]);
    const m = r.activity.motion;
    expect(Math.min(...m.slice(4, 8))).toBeGreaterThan(0.2);   // 2–4 s moves
    expect(Math.max(...m.slice(0, 4), ...m.slice(8))).toBeLessThan(0.1);
    expect(r.activity.loud_db[1] ?? -99).toBeGreaterThan((r.activity.loud_db[9] ?? 0) + 15);
    expect((await editPoints(file, 1000, 5000, true)).shots).toEqual([2000, 4000]);
  }, 60_000);
});
