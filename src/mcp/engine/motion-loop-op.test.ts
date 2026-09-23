// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';
import { ALL_HANDLERS } from '../handlers';
import { animationDuration } from '../../export/gif-frames';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-loop-'));
fs.mkdirSync(path.join(root, 'designs'), { recursive: true });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

const dot = (anim: object): object => ({ id: 'dot', type: 'ellipse', z: 2, x: 100, y: 500, width: 80, height: 80, fill: '#E4572E', animation: anim });
/** An entrance (0–400) then one bob (400–1000), a 3 s scene set by a caption's fade. */
const bob = { keyframes: [{ t: 0, opacity: 0, y: 40 }, { t: 400, opacity: 1, y: 0 }, { t: 700, y: 12 }, { t: 1000, y: 0 }], playback: { duration: 1000, origin: 'offset', delay: 200 } };
const caption = { id: 'cap', type: 'rect', z: 1, x: 0, y: 0, width: 50, height: 50, fill: '#111111', animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 3000, opacity: 1 }], playback: { duration: 3000, origin: 'offset' } } };
const write = (name: string, layers: object[]): string => {
  const p = path.join(root, 'designs', `${name}.design.yaml`);
  fs.writeFileSync(p, yaml.dump({ _protocol: 'design/v1', meta: { id: name, name, type: 'poster' }, document: { width: 1080, height: 1080 }, layers }));
  return p;
};
const loop = async (args: Record<string, unknown>): Promise<Record<string, unknown>> =>
  (await ALL_HANDLERS['animation']?.({ op: 'loop', ...args })) as unknown as Record<string, unknown>;
const dotTrack = (design: string): AnimationSpec => {
  const spec = yaml.load(fs.readFileSync(design, 'utf8')) as DesignSpec;
  return ((spec.layers ?? []).find(l => l.id === 'dot') as Layer & { animation: AnimationSpec }).animation;
};

describe('animation {op:"loop"}', () => {
  it('repeats the bob after the entrance until the scene ends, and the scene stays as long', async () => {
    const design = write('bob', [caption, dot(bob)]);
    const r = await loop({ design_path: design, layer_id: 'dot', from: 1 });
    expect(r['success']).toBe(true);
    expect(r['passes']).toBe(3);   // the bob ends at 1200 on the scene; 1800 ms to 3000 holds three seamless 600 ms passes
    const spec = yaml.load(fs.readFileSync(design, 'utf8')) as DesignSpec;
    expect(animationDuration(spec.layers ?? [])).toBe(3000);
    const keys = dotTrack(design).keyframes ?? [];
    expect(keys.filter(k => k.ambient).length).toBe(6);   // 700 and 1000 of each pass
    expect(dotTrack(design).playback?.duration).toBe(Math.max(...keys.map(k => k.t)));
  });

  it('replaces its own repeats when run again, and reaches a marker or a time when told', async () => {
    const design = write('again', [caption, dot(bob)]);
    await loop({ design_path: design, layer_id: 'dot', from: 1 });
    const r = await loop({ design_path: design, layer_id: 'dot', from: 1, mode: 'pingpong', until: '5000' });
    expect(r['success']).toBe(true);
    const keys = dotTrack(design).keyframes ?? [];
    // Pingpong passes are 600 ms: (5000 − 200 − 1000) / 600 → 6, and only the four authored keys are not repeats.
    expect(r['passes']).toBe(6);
    expect(keys.filter(k => !k.ambient).map(k => k.t)).toEqual([0, 400, 700, 1000]);
    expect(keys.every((k, i) => i === 0 || (keys[i - 1]?.t ?? 0) < k.t)).toBe(true);
  });

  it('refuses a track that loops as a whole, and says when there is no room for a pass', async () => {
    const whole = write('whole', [dot({ ...bob, playback: { ...bob.playback, loop: true } })]);
    expect((await loop({ design_path: whole, layer_id: 'dot' }))['error']).toMatch(/already loops as a whole/);
    const alone = write('alone', [dot(bob)]);
    const r = await loop({ design_path: alone, layer_id: 'dot', from: 1 });
    expect(r['error']).toMatch(/No room for one pass/);
    expect(r['hint']).toMatch(/until/);
  });
});
