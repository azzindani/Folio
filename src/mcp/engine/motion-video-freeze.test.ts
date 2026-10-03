import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { load } from 'js-yaml';
import { freezeVideo } from './motion-video-freeze';
import { videoMotion } from './motion-video-op';

type L = { id: string; in?: number; out?: number; video?: Record<string, unknown> };
type R = { success: boolean; error?: string; clips?: Array<{ id: string; plays: { from: number; until: number | null }; file: { from: number }; still?: true }> };

describe('animation(op:video, freeze)', () => {
  let dir = '', fp = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-freeze-'));
    fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
    fp = path.join(dir, 'designs', 'd.design.yaml');
    fs.writeFileSync(fp, `_protocol: design/v1
meta: {name: d, type: poster}
document: {width: 320, height: 180, unit: px}
markers: {cta: 4000}
layers:
  - {id: take, type: video, src: assets/video/take.mp4, x: 0, 'y': 0, width: 320, height: 180, z: 1, in: 0, out: 4000, video: {offset_ms: 1000, duration_ms: 4000, focus: [0.2, 0.5]}}
  - {id: title, type: text, x: 10, 'y': 10, width: 200, height: 40, z: 2, in: 3000, content: {type: plain, value: Hi}}
`);
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const layers = (): L[] => (load(fs.readFileSync(fp, 'utf8')) as { layers: L[] }).layers;
  const markers = (): Record<string, number> => (load(fs.readFileSync(fp, 'utf8')) as { markers: Record<string, number> }).markers;

  it('splits, opens the hold, and fills it with that frame — everything after moves later', () => {
    const r = freezeVideo({ design_path: fp, layer_id: 'take', freeze: { at: 2000, duration_ms: 1000 } }) as unknown as R;
    expect(r.success, r.error).toBe(true);
    expect(r.clips?.map(c => [c.id, c.plays.from, c.plays.until, c.file.from, c.still ?? false])).toEqual([
      ['take', 0, 2000, 1000, false], ['take_freeze', 2000, 3000, 3000, true], ['take_2', 3000, 5000, 3000, false],
    ]);
    const ls = layers();
    expect(ls.map(l => l.id)).toEqual(['take', 'take_freeze', 'take_2', 'title']);
    expect(ls.find(l => l.id === 'take_freeze')?.video).toMatchObject({ still: true, muted: true, focus: [0.2, 0.5], zoom: 1 });
    expect(ls.find(l => l.id === 'title')?.in).toBe(4000);
    expect(markers()['cta']).toBe(5000);
  });

  it('refuses a hold out of range, a moment outside the clip, and a freeze of a freeze', () => {
    expect((freezeVideo({ design_path: fp, layer_id: 'take', freeze: { at: 2000, duration_ms: 20 } }) as unknown as R).error).toContain('100–10000');
    expect((freezeVideo({ design_path: fp, layer_id: 'take', freeze: { at: 9000, duration_ms: 500 } }) as unknown as R).error).toContain('not while');
    freezeVideo({ design_path: fp, layer_id: 'take', freeze: { at: 2000, duration_ms: 1000 } });
    expect((freezeVideo({ design_path: fp, layer_id: 'take_freeze', freeze: { at: 2500, duration_ms: 500 } }) as unknown as R).error).toContain('already a freeze');
  });

  it('a ramp is set and cleared through op:video, and changes how long the clip plays', () => {
    const r = videoMotion({ design_path: fp, layer_id: 'take', ramp: [{ at_ms: 0, speed: 2 }] }) as unknown as R & { clips: Array<{ ramp?: unknown }> };
    expect(r.success, r.error).toBe(true);
    expect(r.clips[0]?.plays.until).toBe(2000);
    expect((videoMotion({ design_path: fp, layer_id: 'take', ramp: [{ at_ms: 0, speed: 20 }] }) as unknown as R).error).toContain('0.1–8');
    expect((videoMotion({ design_path: fp, layer_id: 'take', ramp: null }) as unknown as R & { clips: Array<{ ramp?: unknown }> }).clips[0]?.ramp).toBeUndefined();
  });
});
