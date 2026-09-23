import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { DesignSpec } from '../../schema/types';
import { resolveSound, hasSound } from './sound-resolve';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;

describe('a video layer\'s sound joins the mix', () => {
  let dir: string;
  const spec = (): DesignSpec => ({
    meta: { name: 'v', version: '1' }, document: { width: 320, height: 180, unit: 'px' },
    layers: [
      { id: 'talk', type: 'video', src: 'assets/video/talk.mp4', x: 0, y: 0, width: 160, height: 90, z: 1, video: { volume: 0.8 } },
      { id: 'broll', type: 'video', src: 'assets/video/broll.mp4', x: 160, y: 0, width: 160, height: 90, z: 1 },
    ],
  } as unknown as DesignSpec);
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-vsound-'));
    fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets', 'video'), { recursive: true });
    if (!hasFfmpeg) return;
    const v = ['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=2'];
    spawnSync('ffmpeg', ['-v', 'error', ...v, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', path.join(dir, 'assets/video/talk.mp4')], { timeout: 30_000 });
    spawnSync('ffmpeg', ['-v', 'error', ...v, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(dir, 'assets/video/broll.mp4')], { timeout: 30_000 });
  }, 60_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('counts as sound', () => { expect(hasSound(spec())).toBe(true); });

  it.skipIf(!hasFfmpeg)('mixes the clip that has sound, and passes over the silent one without a note', () => {
    const r = resolveSound(spec(), path.join(dir, 'designs', 'd.design.yaml'), { total_ms: 3000, scenes: [] }, dir);
    expect(r.clips.map(c => [c.id, c.volume])).toEqual([['talk-sound', 0.8]]);
    expect(r.clips[0]?.file).toContain('talk.mp4');
    expect(Math.abs((r.clips[0]?.length_ms ?? 0) - 2000)).toBeLessThan(150);
    expect(r.plan.notes.join(' ')).not.toContain('broll');
  }, 30_000);
});
