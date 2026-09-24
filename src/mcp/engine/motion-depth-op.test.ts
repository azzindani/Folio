// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import type { DesignSpec, Layer } from '../../schema/types';
import { ALL_HANDLERS } from '../handlers';
import { layersAt } from '../../export/gif-frames';
import { canvasBoxes } from '../../export/frame-cull';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-depth-'));
fs.mkdirSync(path.join(root, 'designs'), { recursive: true });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

const rect = (id: string, x: number, y: number, w: number, h: number, z = 1): object => ({ id, type: 'rect', z, x, y, width: w, height: h, fill: '#E4572E' });
const write = (name: string): string => {
  const p = path.join(root, 'designs', `${name}.design.yaml`);
  fs.writeFileSync(p, yaml.dump({ _protocol: 'design/v1', meta: { id: name, name, type: 'poster' }, document: { width: 1920, height: 1080 },
    world: { x: 0, y: 0, width: 3840, height: 1080 },
    layers: [rect('ground', 0, 0, 1920, 1080, 0), rect('hills', 400, 700, 3000, 200), rect('a', 610, 340, 700, 400, 2), rect('b', 2530, 340, 700, 400, 2), rect('grass', 200, 980, 3400, 60, 3)] }));
  return p;
};
const call = async (tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
  (await ALL_HANDLERS[tool]?.(args)) as unknown as Record<string, unknown>;
const load = (p: string): Layer[] => ((yaml.load(fs.readFileSync(p, 'utf8')) as DesignSpec).layers ?? []) as Layer[];
const at = (p: string, t: number, id: string): number => canvasBoxes(layersAt(load(p), t)).find(b => b.layer.id === id)?.box.x ?? NaN;
const pan = async (p: string, from: string, to: string): Promise<void> => {
  const r = await call('animation', { op: 'camera', design_path: p, shots: [{ t: 0, target: from, padding: 60 }, { t: 2000, target: to, padding: 60 }] });
  expect(r['success']).toBe(true);
};

describe('animation {op:"depth"}', () => {
  it('gives a far layer half the camera\'s travel and a near one twice — at the keys and between them', async () => {
    const p = write('parallax');
    await pan(p, 'a', 'b');
    const r = await call('animation', { op: 'depth', design_path: p, depths: { hills: 1, grass: -0.5 } });
    expect(r['success']).toBe(true);
    const card = at(p, 2000, 'a') - at(p, 0, 'a');
    expect(card).toBeLessThan(-1000);                                    // the camera panned right: the world slid left
    for (const t of [1000, 2000]) {
      const c = at(p, t, 'a') - at(p, 0, 'a');
      expect(at(p, t, 'hills') - at(p, 0, 'hills')).toBeCloseTo(c / 2, 0);
      expect(at(p, t, 'grass') - at(p, 0, 'grass')).toBeCloseTo(c * 2, 0);
    }
    const ls = load(p) as Array<Layer & { z?: number }>;
    const z = (id: string): number => ls.find(l => l.id === id)?.z ?? NaN;
    expect(z('__depth_1')).toBeLessThan(z('__camera'));
    expect(z('__depth_m0_5')).toBeGreaterThan(z('__camera'));
    expect(z('__depth_1')).toBeGreaterThan(z('ground'));
  });

  it('keeps the depths in step when the camera is re-framed, and puts a layer back at 0', async () => {
    const p = write('reshoot');
    await pan(p, 'a', 'b');
    await call('animation', { op: 'depth', design_path: p, depths: { hills: 1 } });
    await pan(p, 'b', 'a');
    const c = at(p, 2000, 'a') - at(p, 0, 'a');
    expect(c).toBeGreaterThan(1000);
    expect(at(p, 2000, 'hills') - at(p, 0, 'hills')).toBeCloseTo(c / 2, 0);
    await call('animation', { op: 'depth', design_path: p, depths: { hills: 0 } });
    expect(load(p).some(l => l.id.startsWith('__depth_'))).toBe(false);
    expect(at(p, 2000, 'hills') - at(p, 0, 'hills')).toBeCloseTo(c, 0);
  });

  it('says when a backdrop the camera carries would hide what is set behind it', async () => {
    const p = path.join(root, 'designs', 'haze.design.yaml');
    fs.writeFileSync(p, yaml.dump({ _protocol: 'design/v1', meta: { id: 'haze', name: 'haze', type: 'poster' }, document: { width: 1920, height: 1080 },
      world: { x: 0, y: 0, width: 3840, height: 1080 },
      layers: [rect('ground', 0, 0, 1920, 1080, 0), { id: 'scene', type: 'group', z: 1, x: 0, y: 0, width: 3840, height: 1080, layers: [
        { id: 'haze', type: 'rect', z: 0, x: 0, y: 0, width: 3840, height: 1080, fill: '#F3D9B1' }, rect('hills', 400, 700, 3000, 200), rect('a', 610, 340, 700, 400, 2), rect('b', 2530, 340, 700, 400, 2)] }] }));
    await pan(p, 'a', 'b');
    const r = await call('animation', { op: 'depth', design_path: p, depths: { hills: 1 } });
    const said = (r['progress'] as Array<{ message: string }>).map(x => x.message);
    expect(said).toContain('"haze" covers the whole world inside the camera');
  });

  it('says how far a band at a depth must reach to fill the frame to the end, and is quiet once it does (r8 grass)', async () => {
    const p = path.join(root, 'designs', 'band.design.yaml');
    fs.writeFileSync(p, yaml.dump({ _protocol: 'design/v1', meta: { id: 'band', name: 'band', type: 'poster' }, document: { width: 1920, height: 1080 },
      world: { x: 0, y: 0, width: 3840, height: 1080 },
      layers: [rect('ground', 0, 0, 1920, 1080, 0), rect('a', 0, 0, 1920, 1080, 2), rect('b', 1920, 0, 1920, 1080, 2), rect('band', 0, 900, 3840, 180, 3)] }));
    const shots = [{ t: 0, target: 'a' }, { t: 2000, target: 'b' }];
    await call('animation', { op: 'camera', design_path: p, shots });
    const r = await call('animation', { op: 'depth', design_path: p, depths: { band: -0.5 } });
    const warn = (r['progress'] as Array<{ message: string; detail?: string }>).find(x => x.message.startsWith('"band" leaves the frame bare on the right'));
    // Twice the camera's 1920 px: at the end the frame shows x 3840–5760 of the band's plane.
    expect(warn?.detail).toMatch(/its right edge \(x 3840\) must reach x 5760 — 1920 px further/);
    const spec = yaml.load(fs.readFileSync(p, 'utf8')) as DesignSpec;
    const band = (spec.layers ?? []).flatMap(l => (l as Layer & { layers?: Layer[] }).layers ?? []).find(l => l.id === 'band') as unknown as { width: number };
    band.width = 5760;
    fs.writeFileSync(p, yaml.dump(spec));
    const again = await call('animation', { op: 'camera', design_path: p, shots });
    expect(JSON.stringify(again['progress'])).not.toMatch(/leaves the frame bare/);
  });

  it('asks for a camera first, and for layers the camera carries', async () => {
    const p = write('nocam');
    expect((await call('animation', { op: 'depth', design_path: p, depths: { hills: 1 } }))['error']).toMatch(/No camera/);
    await pan(p, 'a', 'b');
    expect((await call('animation', { op: 'depth', design_path: p, depths: { nope: 1 } }))['error']).toMatch(/Not under the camera: nope/);
  });
});
