import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { load } from 'js-yaml';
import { beatCutVideo } from './motion-video-beats';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;
type R = { success: boolean; error?: string; bpm?: number; moved?: Array<{ between: string[]; from_ms: number; to_ms: number }>; kept?: unknown[] };

describe.skipIf(!hasFfmpeg)('animation(op:video, on_beats)', () => {
  let dir = '', fp = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-beatcut-'));
    for (const d of ['designs', 'assets/video', 'assets/audio']) fs.mkdirSync(path.join(dir, d), { recursive: true });
    // A click every 500 ms (120 BPM) from 0, and one 8 s clip of footage.
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.5),0.03),sin(2*PI*1000*t)*exp(-mod(t,0.5)*80),0)':s=44100:d=10",
      '-y', path.join(dir, 'assets/audio/click.wav')], { timeout: 30_000 });
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y',
      path.join(dir, 'assets/video/take.mp4')], { timeout: 30_000 });
    fp = path.join(dir, 'designs', 'd.design.yaml');
    fs.writeFileSync(fp, `_protocol: design/v1
meta: {name: d, type: poster}
document: {width: 320, height: 180, unit: px}
audio: [{id: bed, src: assets/audio/click.wav}]
layers:
  - {id: a, type: video, src: assets/video/take.mp4, x: 0, 'y': 0, width: 320, height: 180, z: 1, in: 0, out: 2100, video: {offset_ms: 500, duration_ms: 2100}}
  - {id: b, type: video, src: assets/video/take.mp4, x: 0, 'y': 0, width: 320, height: 180, z: 1, in: 2100, out: 3900, video: {offset_ms: 3500, duration_ms: 1800}}
  - {id: c, type: video, src: assets/video/take.mp4, x: 0, 'y': 0, width: 320, height: 180, z: 1, in: 3900, out: 6100, video: {offset_ms: 1000, duration_ms: 2200}}
`);
  }, 90_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('moves each join onto the click it is nearest, and the last frame onto one too', async () => {
    const r = await beatCutVideo({ design_path: fp, layer_id: 'b', on_beats: true }) as unknown as R;
    expect(r.success, r.error).toBe(true);
    expect(Math.round(r.bpm ?? 0)).toBe(120);
    const to = (r.moved ?? []).map(m => m.to_ms);
    expect(to.length).toBe(3);
    // Each landed within one detector step (a few ms) of the 500 ms grid.
    for (const [ms, want] of to.map((v, i) => [v, [2000, 4000, 6000][i] ?? 0])) expect(Math.abs((ms ?? 0) - (want ?? 0))).toBeLessThan(15);
    const layers = (load(fs.readFileSync(fp, 'utf8')) as { layers: Array<{ id: string; in: number; out: number; video: { offset_ms: number } }> }).layers;
    const b = layers.find(l => l.id === 'b');
    expect(b?.in).toBe(to[0]);
    expect(b?.out).toBe(to[1]);
  }, 60_000);

  it('refuses a design with no music to cut to', async () => {
    const quiet = fp.replace('d.design.yaml', 'q.design.yaml');
    fs.writeFileSync(quiet, fs.readFileSync(fp, 'utf8').replace(/^audio:.*$/m, ''));
    const r = await beatCutVideo({ design_path: quiet, layer_id: 'a', on_beats: { every: 4 } }) as unknown as R;
    expect(r.success).toBe(false);
  }, 60_000);
});
