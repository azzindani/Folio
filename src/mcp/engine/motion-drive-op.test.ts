// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';
import { ALL_HANDLERS } from '../handlers';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-drive-'));
fs.mkdirSync(path.join(root, 'designs'), { recursive: true });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

type Node = Layer & { animation?: AnimationSpec; layers?: Node[] };
const shape = (id: string, x: number, y: number, w: number, anim?: object): object =>
  ({ id, type: 'ellipse', z: 2, x, y, width: w, height: w, fill: '#E4572E', ...(anim ? { animation: anim } : {}) });
const write = (name: string, layers: object[]): string => {
  const p = path.join(root, 'designs', `${name}.design.yaml`);
  fs.writeFileSync(p, yaml.dump({ _protocol: 'design/v1', meta: { id: name, name, type: 'poster' }, document: { width: 1080, height: 1080 }, layers }));
  return p;
};
const drive = async (args: Record<string, unknown>): Promise<Record<string, unknown>> =>
  (await ALL_HANDLERS['animation']?.({ op: 'drive', ...args })) as unknown as Record<string, unknown>;
const layer = (design: string, id: string): Node | undefined => {
  const walk = (ls: Node[]): Node | undefined => { for (const l of ls) { if (l.id === id) return l; const k = l.layers && walk(l.layers); if (k) return k; } return undefined; };
  return walk(((yaml.load(fs.readFileSync(design, 'utf8')) as DesignSpec).layers ?? []) as Node[]);
};
const rollX = { keyframes: [{ t: 0, x: 0, easing: 'ease-in-out' }, { t: 1500, x: 300 }], playback: { duration: 1500, origin: 'offset' } };
const bounce = { keyframes: [{ t: 0, y: 0, easing: 'ease-out' }, { t: 400, y: -200, easing: 'ease-in' }, { t: 800, y: 0 }], playback: { duration: 800, origin: 'offset', delay: 300 } };

describe('animation {op:"drive"}', () => {
  it('turns a wheel by its own roll, on its own keys — it spins in place as it travels', async () => {
    const design = write('wheel', [shape('wheel', 100, 800, 100, rollX)]);
    const r = await drive({ design_path: design, layer_id: 'wheel', channel: 'rotation', roll: true });
    expect(r['success']).toBe(true);
    const keys = layer(design, 'wheel')?.animation?.keyframes ?? [];
    expect(keys.map(k => k['rotation'])).toEqual([0, Math.round((300 * 360) / (Math.PI * 100) * 1000) / 1000]);
    expect(layer(design, 'wheel_drive')).toBeUndefined();
  });

  it('gives a still shadow its ball\'s rise as scale, on the ball\'s times and curves, lag ms later', async () => {
    const design = write('shadow', [shape('ball', 500, 400, 120, bounce), shape('shadow', 500, 900, 120)]);
    const r = await drive({ design_path: design, layer_id: 'shadow', channel: 'scale', driver: { layer_id: 'ball', channel: 'y' }, factor: 0.002, add: 1, lag: 40 });
    expect(r['rule']).toBe('scale = 1 + 0.002 × ball.y, 40 ms later');
    const a = layer(design, 'shadow')?.animation;
    expect(a?.keyframes).toEqual([{ t: 0, scale: 1, easing: 'ease-out' }, { t: 400, scale: 0.6, easing: 'ease-in' }, { t: 800, scale: 1 }]);
    expect(a?.playback).toMatchObject({ duration: 800, delay: 340, origin: 'offset' });
  });

  it('puts the driven channel on a wrapper when the layer already moves, and says when it will swing wide', async () => {
    const design = write('wrap', [shape('ball', 500, 400, 120, bounce), shape('rider', 100, 700, 80, rollX)]);
    const r = await drive({ design_path: design, layer_id: 'rider', channel: 'rotation', driver: { layer_id: 'ball', channel: 'y' }, factor: 0.1 });
    expect(r['success']).toBe(true);
    expect(layer(design, 'rider_drive')?.animation?.keyframes?.map(k => k['rotation'])).toEqual([0, -20, 0]);
    expect(layer(design, 'rider')?.animation?.keyframes).toEqual(rollX.keyframes);
    expect(JSON.stringify(r['progress'])).toMatch(/also travels/);
  });

  it('refuses a driver with no keys on that channel, and roll on anything but rotation by x', async () => {
    const design = write('bad', [shape('ball', 500, 400, 120, bounce), shape('dot', 100, 100, 40)]);
    expect((await drive({ design_path: design, layer_id: 'dot', channel: 'x', driver: { layer_id: 'ball', channel: 'x' } }))['error']).toMatch(/no x keys/);
    expect((await drive({ design_path: design, layer_id: 'ball', channel: 'scale', roll: true }))['error']).toMatch(/roll:true turns rotation by x/);
  });
});
