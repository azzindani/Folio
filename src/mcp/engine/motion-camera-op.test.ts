import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { cameraMotion } from './motion-camera-op';
import { layersAt } from '../../export/gif-frames';
import type { DesignSpec, Layer } from '../../schema/types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-camera-'));
let dPath = '';
let n = 0;
const ground = { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: '#111111' };
const stat = { id: 'stat', type: 'rect', z: 1, x: 700, y: 900, width: 200, height: 100, fill: '#E4572E' };
const label = { id: 'label', type: 'rect', z: 2, x: 80, y: 200, width: 400, height: 80, fill: '#FAF5EC' };

const write = (layers: unknown[]): void => {
  fs.writeFileSync(dPath, yaml.dump({ meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1350 }, layers }));
};
beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  write([ground, stat, label]);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

type Node = { id: string; type: string; layers?: Node[]; animation?: { keyframes: Array<Record<string, number>> } };
const top = (): Node[] => ((yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec).layers ?? []) as unknown as Node[];
const shots = [{ t: 0, target: 'all' }, { t: 1000, target: 'stat', padding: 40 }];

describe('animation op:camera', () => {
  it('moves the content under a camera and leaves the ground still', () => {
    const r = cameraMotion({ design_path: dPath, shots });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(top().map(l => l.id)).toEqual(['bg', '__camera']);
    const cam = top()[1];
    expect(cam?.layers?.map(l => l.id)).toEqual(['__camera_pin', 'stat', 'label']);
    const [wide, close] = cam?.animation?.keyframes ?? [];
    expect(wide).toMatchObject({ t: 0, scale: 1, x: 0, y: 0 });
    expect(close?.['scale']).toBeCloseTo(1080 / 280, 3);
  });

  it('works inside a carousel page group, so the page ground stays put', () => {
    write([{ id: 'page', type: 'group', locked: true, x: 0, y: 0, width: 1080, height: 1350, layers: [ground, stat, label] }]);
    const r = cameraMotion({ design_path: dPath, shots });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(top()[0]?.layers?.map(l => l.id)).toEqual(['bg', '__camera']);
  });

  it('re-frames the same camera instead of adding a second one', () => {
    cameraMotion({ design_path: dPath, shots });
    const r = cameraMotion({ design_path: dPath, shots: [{ t: 0, target: 'label' }, { t: 800, target: 'all' }] });
    expect(r['reused']).toBe(true);
    expect(top().filter(l => l.id === '__camera')).toHaveLength(1);
    expect(top()[1]?.layers?.some(l => l.id === '__camera')).toBe(false);
  });

  it('pushes in on the sampled frame too — the flipbook plays the camera', () => {
    cameraMotion({ design_path: dPath, shots });
    const frame = layersAt(top() as unknown as Layer[], 1000)[1] as unknown as Record<string, unknown>;
    expect(String(frame['transform'])).toMatch(/scale\(3\.857/);
  });

  it('refuses a shot at a layer that is not there, and leaves the file alone', () => {
    const before = fs.readFileSync(dPath, 'utf8');
    expect(cameraMotion({ design_path: dPath, shots: [{ t: 0, target: 'ghost' }] }).success).toBe(false);
    expect(fs.readFileSync(dPath, 'utf8')).toBe(before);
  });
});
