import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { load } from 'js-yaml';
import { videoMotion, summarize, type ClipLayer } from './motion-video-op';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;
type R = { success: boolean; error?: string; clips?: Array<{ id: string; plays: { from: number; until: number | null }; file: { from: number; to: number | null }; speed: number; sound?: Record<string, number> }> };

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

  it('sets the clip\'s edge sound, keeps each edge with its half on a split, and 0 clears', () => {
    const r = videoMotion({ design_path: fp, layer_id: 'take', fade_in: 300, fade_out: 400, audio_lead_ms: 250, audio_tail_ms: 500 }) as unknown as R;
    expect(r.clips?.[0]).toMatchObject({ sound: { fade_in_ms: 300, fade_out_ms: 400, lead_ms: 250, tail_ms: 500 } });
    const [a, b] = (videoMotion({ design_path: fp, layer_id: 'take', split_at: 1500 }) as unknown as R).clips ?? [];
    expect(a?.sound).toEqual({ fade_in_ms: 300, lead_ms: 250 });
    expect(b?.sound).toEqual({ fade_out_ms: 400, tail_ms: 500 });
    expect((videoMotion({ design_path: fp, layer_id: 'take', fade_in: 0, audio_lead_ms: null }) as unknown as R).clips?.[0]?.sound).toBeUndefined();
    expect((videoMotion({ design_path: fp, layer_id: 'take', audio_tail_ms: -5 }) as unknown as R).error).toContain('out of range');
  });

  it('a transition joins a clip to the one ending where it starts; a lone clip has none to join', () => {
    videoMotion({ design_path: fp, layer_id: 'take', split_at: 1500 });
    const r = videoMotion({ design_path: fp, layer_id: 'take_2', clip_transition: { type: 'crossfade', duration_ms: 400 } }) as unknown as R & { clips: Array<{ transition?: unknown }> };
    expect(r.success).toBe(true);
    expect(r.clips[0]?.transition).toEqual({ type: 'crossfade', duration_ms: 400 });
    expect((videoMotion({ design_path: fp, layer_id: 'take', clip_transition: { type: 'dip' } }) as unknown as R).error).toContain('No clip ends where');
    expect((videoMotion({ design_path: fp, layer_id: 'take_2', clip_transition: { type: 'spin' } }) as unknown as R).error).toContain('Unknown transition type');
    expect((videoMotion({ design_path: fp, layer_id: 'take_2', clip_transition: null }) as unknown as R & { clips: Array<{ transition?: unknown }> }).clips[0]?.transition).toBeUndefined();
  });

  it('keys a green screen out, keeps it on both halves of a split, and null clears', () => {
    const r = videoMotion({ design_path: fp, layer_id: 'take', key: { color: '#00b140', similarity: 0.3 } }) as unknown as R & { clips: Array<{ key?: unknown }> };
    expect(r.clips[0]?.key).toEqual({ color: '#00b140', similarity: 0.3, blend: 0.1 });
    const halves = (videoMotion({ design_path: fp, layer_id: 'take', split_at: 1500 }) as unknown as { clips: Array<{ key?: unknown }> }).clips;
    expect(halves.map(c => c.key !== undefined)).toEqual([true, true]);
    expect((videoMotion({ design_path: fp, layer_id: 'take', key: { color: '#888888' } }) as unknown as R).error).toContain('grey');
    expect((videoMotion({ design_path: fp, layer_id: 'take', key: null }) as unknown as R & { clips: Array<{ key?: unknown }> }).clips[0]?.key).toBeUndefined();
  });

  it('refuses a cut outside the clip, an offset past the file, and a layer that is not a clip', () => {
    expect((videoMotion({ design_path: fp, layer_id: 'take', split_at: 9000 }) as unknown as R).success).toBe(false);
    expect((videoMotion({ design_path: fp, layer_id: 'take', offset_ms: 9000 }) as unknown as R).error).toContain('past the end');
    expect((videoMotion({ design_path: fp, layer_id: 'bg', speed: 2 }) as unknown as R).error).toContain('not a video layer');
    expect((videoMotion({ design_path: fp, layer_id: 'take', speed: 20 }) as unknown as R).success).toBe(false);
  });
});
