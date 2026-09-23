import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { load } from 'js-yaml';
import type { Layer } from '../../schema/types';
import { animationDuration, oneShotDuration } from '../../export/gif-frames';
import { writeYAML } from './utils';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;
const clip = (extra: Record<string, unknown>): Layer =>
  ({ id: 'c', type: 'video', src: 'assets/video/take.mp4', x: 0, y: 0, width: 100, height: 100, z: 1, ...extra }) as unknown as Layer;

describe('footage counts as motion', () => {
  it('a page whose only motion is a clip runs as long as the clip', () => {
    expect(animationDuration([clip({ in: 1000, video: { duration_ms: 4000, speed: 2 } })])).toBe(3000);
    expect(oneShotDuration([clip({ video: { duration_ms: 4000 } })])).toBe(4000);
  });
  it('a looping clip never finishes; a clip of unknown length adds nothing', () => {
    expect(oneShotDuration([clip({ video: { duration_ms: 4000, loop: true } })])).toBe(0);
    expect(animationDuration([clip({ video: { duration_ms: 4000, loop: true } })])).toBe(4000);
    expect(animationDuration([clip({})])).toBe(0);
  });
});

describe('writing a design gives a clip its length', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-vlen-'));
    fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets', 'video'), { recursive: true });
    if (hasFfmpeg) {
      spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y',
        path.join(dir, 'assets/video/take.mp4')], { timeout: 30_000 });
    }
  }, 60_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it.skipIf(!hasFfmpeg)('stamps the rest of the file after the offset — and keeps one the model wrote', () => {
    const fp = path.join(dir, 'designs', 'd.design.yaml');
    writeYAML(fp, { meta: { name: 'd' }, document: { width: 100, height: 100 }, layers: [clip({ video: { offset_ms: 1000 } }), { ...clip({ video: { duration_ms: 500 } }), id: 'd' }] });
    const [a, b] = (load(fs.readFileSync(fp, 'utf8')) as { layers: Array<{ video: { duration_ms: number } }> }).layers;
    expect(Math.abs((a?.video.duration_ms ?? 0) - 2000)).toBeLessThan(150);
    expect(b?.video.duration_ms).toBe(500);
  }, 30_000);
});
