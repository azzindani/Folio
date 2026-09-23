import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { load } from 'js-yaml';
import { videoMotion, summarize, type ClipLayer } from './motion-video-op';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;
type R = { success: boolean; error?: string; clips?: Array<{ id: string; plays: { from: number; until: number | null }; file: { from: number; to: number | null }; speed: number }> };

describe('summarize', () => {
  it('reads a clip on both clocks', () => {
    const s = summarize({ id: 'c', type: 'video', z: 1, in: 1000, video: { offset_ms: 500, duration_ms: 4000, speed: 2 } } as unknown as ClipLayer);
    expect(s).toMatchObject({ plays: { from: 1000, until: 3000 }, file: { from: 500, to: 4500 }, speed: 2 });
  });
});

describe.skipIf(!hasFfmpeg)('animation {op:"video"}', () => {
  let dir: string;
  let fp: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-vop-'));
    fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets', 'video'), { recursive: true });
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y',
      path.join(dir, 'assets/video/take.mp4')], { timeout: 30_000 });
    fp = path.join(dir, 'designs', 'd.design.yaml');
  }, 60_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  beforeEach(() => {
    fs.writeFileSync(fp, `_protocol: design/v1\nmeta:\n  name: d\n  type: poster\ndocument:\n  width: 320\n  height: 180\n  unit: px\nlayers:
  - { id: bg, type: rect, x: 0, 'y': 0, width: 320, height: 180, z: 0, fill: { type: solid, color: '#000000' } }
  - { id: take, type: video, src: assets/video/take.mp4, x: 0, 'y': 0, width: 320, height: 180, z: 1 }
`);
  });
  const layers = (): ClipLayer[] => (load(fs.readFileSync(fp, 'utf8')) as { layers: ClipLayer[] }).layers;

  it('starts, trims and speeds a clip — the rest of the file follows the offset', () => {
    const r = videoMotion({ design_path: fp, layer_id: 'take', in: 1000, offset_ms: 1000, speed: 2 }) as unknown as R;
    expect(r.success).toBe(true);
    expect(r.clips?.[0]).toMatchObject({ plays: { from: 1000, until: 2000 }, file: { from: 1000 }, speed: 2 });
    expect(Math.abs((r.clips?.[0]?.file.to ?? 0) - 3000)).toBeLessThan(150);
  });

  it('cuts a clip in two: the second half starts where the first stopped', () => {
    const r = videoMotion({ design_path: fp, layer_id: 'take', split_at: '1200' }) as unknown as R;
    expect(r.success).toBe(true);
    const [a, b] = r.clips ?? [];
    expect(a).toMatchObject({ id: 'take', plays: { from: 0, until: 1200 }, file: { from: 0, to: 1200 } });
    expect(b).toMatchObject({ id: 'take_2', plays: { from: 1200 }, file: { from: 1200 } });
    expect(layers().map(l => l.id)).toEqual(['bg', 'take', 'take_2']);
  });

  it('refuses a cut outside the clip, an offset past the file, and a layer that is not a clip', () => {
    expect((videoMotion({ design_path: fp, layer_id: 'take', split_at: 9000 }) as unknown as R).success).toBe(false);
    expect((videoMotion({ design_path: fp, layer_id: 'take', offset_ms: 9000 }) as unknown as R).error).toContain('past the end');
    expect((videoMotion({ design_path: fp, layer_id: 'bg', speed: 2 }) as unknown as R).error).toContain('not a video layer');
    expect((videoMotion({ design_path: fp, layer_id: 'take', speed: 20 }) as unknown as R).success).toBe(false);
  });
});
