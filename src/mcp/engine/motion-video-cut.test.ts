import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { load } from 'js-yaml';
import { readSpans, cutVideo } from './motion-video-cut';
import { parseSilence, detectSilence } from './video-silence';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined;

describe('readSpans', () => {
  it('sorts and merges overlapping spans', () => {
    expect(readSpans([[5000, 6000], [1000, 2000], [1500, 2500]])).toEqual([[1000, 2500], [5000, 6000]]);
  });
  it('refuses what is not a forward span', () => {
    expect(typeof readSpans([[3000, 2000]])).toBe('string');
    expect(typeof readSpans([])).toBe('string');
    expect(typeof readSpans([[1, 'x']])).toBe('string');
  });
});

describe('parseSilence', () => {
  it('reads start/end pairs on the file clock and closes one still open at the end', () => {
    const log = '[silencedetect @ 0x1] silence_start: 1.002\n[silencedetect @ 0x1] silence_end: 2.004 | silence_duration: 1.002\n[silencedetect @ 0x1] silence_start: 3.5';
    expect(parseSilence(log, 1000, 5000)).toEqual([[2002, 3004], [4500, 5000]]);
  });
});

describe('cutVideo', () => {
  let dir = '';
  const design = (): string => path.join(dir, 'designs', 'd.design.yaml');
  const layers = (): Array<Record<string, unknown>> => (load(fs.readFileSync(design(), 'utf8')) as { layers: Array<Record<string, unknown>> }).layers;
  const byId = (id: string): Record<string, unknown> | undefined => layers().find(l => l['id'] === id);
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-cut-'));
    fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
    fs.writeFileSync(design(), JSON.stringify({ meta: { name: 'd' }, document: { width: 320, height: 180 }, layers: [
      { id: 'take', type: 'video', src: 'assets/video/take.mp4', x: 0, y: 0, width: 320, height: 180, z: 0, video: { offset_ms: 0, duration_ms: 6000 } },
      { id: 'cta', type: 'text', x: 10, y: 10, width: 200, height: 40, z: 1, content: { type: 'text', value: 'Go' }, in: 5000 },
    ] }));
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('takes a span out and closes the gap: the rest of the clip and what follows move up', () => {
    const r = cutVideo({ design_path: design(), layer_id: 'take', cut: [[2000, 3000]] }) as unknown as { success: boolean; removed_ms: number };
    expect(r.success).toBe(true);
    expect(r.removed_ms).toBe(1000);
    expect(byId('take')).toMatchObject({ out: 2000, video: { offset_ms: 0, duration_ms: 2000 } });
    expect(byId('take_2')).toMatchObject({ in: 2000, video: { offset_ms: 3000, duration_ms: 3000 } });
    expect(byId('cta')?.['in']).toBe(4000);
  });

  it('ripple:false leaves the gap', () => {
    cutVideo({ design_path: design(), layer_id: 'take', cut: [[2000, 3000]], ripple: false });
    expect(byId('take_2')?.['in']).toBe(3000);
    expect(byId('cta')?.['in']).toBe(5000);
  });

  it('several spans, from the clip start and to its end', () => {
    cutVideo({ design_path: design(), layer_id: 'take', cut: [[0, 500], [2000, 3000], [5500, 6000]] });
    const clips = layers().filter(l => l['type'] === 'video').map(l => [(l['in'] as number) ?? 0, (l['video'] as { offset_ms: number; duration_ms: number })]);
    expect(clips).toEqual([[0, { offset_ms: 500, duration_ms: 1500 }], [1500, { offset_ms: 3000, duration_ms: 2500 }]]);
    expect(byId('cta')?.['in']).toBe(3500);
  });

  it('refuses to swallow something timed inside the span, and a span outside the clip', () => {
    const blocked = cutVideo({ design_path: design(), layer_id: 'take', cut: [[4000, 5500]] }) as unknown as { success: boolean; error: string };
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain('cta');
    expect((cutVideo({ design_path: design(), layer_id: 'take', cut: [[5000, 7000]] }) as unknown as { success: boolean }).success).toBe(false);
  });
});

describe.skipIf(!hasFfmpeg)('detectSilence on real sound', () => {
  it('finds the second of silence between two tones', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-sil-'));
    try {
      const file = path.join(dir, 's.m4a');
      spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=1', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1', '-f', 'lavfi', '-i', 'sine=f=440:d=1',
        '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]', '-map', '[a]', '-y', file], { timeout: 30_000 });
      const spans = await detectSilence(file, 0, 3000);
      expect(spans.length).toBe(1);
      expect(Math.abs((spans[0]?.[0] ?? 0) - 1000)).toBeLessThan(80);
      expect(Math.abs((spans[0]?.[1] ?? 0) - 2000)).toBeLessThan(80);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);
});
