import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';

import { setMotionPath } from './motion-path-op';
import { layersAt, animationDuration } from '../../export/gif-frames';
import type { DesignSpec, Layer } from '../../schema/types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-mpath-'));
let dPath = '';
let n = 0;

beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({
    meta: { id: 'd', name: 'D', type: 'poster' },
    document: { width: 1080, height: 1080 },
    layers: [{ id: 'dot', type: 'circle', x: 100, y: 100, width: 40, height: 40 }],
  }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const read = (): DesignSpec => yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec;

describe('animation op:motion_path', () => {
  it('stores the path and reports how far the layer travels', () => {
    const r = setMotionPath({ design_path: dPath, layer_ids: ['dot'], path: 'M 0 0 L 300 0' }) as Record<string, unknown>;
    expect(r['success']).toBe(true);
    expect(r['path_length_px']).toBe(300);
    const mp = (read().layers?.[0] as unknown as Record<string, unknown>)['motion_path'] as Record<string, unknown>;
    expect(mp['path']).toBe('M 0 0 L 300 0');
    expect(mp['duration']).toBe(2000);
  });

  // The whole reason this op and the sampler shipped together.
  it('actually MOVES the layer in the shared frame sampler', () => {
    setMotionPath({ design_path: dPath, layer_ids: ['dot'], path: 'M 0 0 L 400 0', duration: 1000 });
    const layers = read().layers as Layer[];
    const at = (t: number): Record<string, unknown> => layersAt(layers, t)[0] as unknown as Record<string, unknown>;
    expect(at(0)['x']).toBeCloseTo(100, 0);          // authored position
    expect(at(500)['x']).toBeCloseTo(300, 0);        // halfway along, offset from it
    expect(at(1000)['x']).toBeCloseTo(500, 0);
  });

  it('gives a path-only design a real duration, so the flipbook makes frames', () => {
    setMotionPath({ design_path: dPath, layer_ids: ['dot'], path: 'M 0 0 L 10 0', duration: 1500 });
    expect(animationDuration(read().layers as Layer[])).toBe(1500);
  });

  it('turns the layer along the curve only when asked', () => {
    setMotionPath({ design_path: dPath, layer_ids: ['dot'], path: 'M 0 0 L 0 200', duration: 1000, auto_rotate: true });
    const rot = (layersAt(read().layers as Layer[], 500)[0] as unknown as Record<string, unknown>)['rotation'];
    expect(rot).toBeCloseTo(90, 0);
  });

  it('refuses an arc rather than exporting a different curve than the browser draws', () => {
    const r = setMotionPath({ design_path: dPath, layer_ids: ['dot'], path: 'M 0 0 A 50 50 0 0 1 100 0' });
    expect(r.success).toBe(false);
    expect(String(r.hint)).toContain('C or Q');
    // Refused BEFORE writing — the design is untouched.
    expect((read().layers?.[0] as unknown as Record<string, unknown>)['motion_path']).toBeUndefined();
  });

  it('refuses a path that goes nowhere', () => {
    expect(setMotionPath({ design_path: dPath, layer_ids: ['dot'], path: 'M 5 5 L 5 5' }).success).toBe(false);
  });

  it('names the layers it could not find, and fails when none matched', () => {
    const ok = setMotionPath({ design_path: dPath, layer_ids: ['dot', 'ghost'], path: 'M 0 0 L 9 0' }) as Record<string, unknown>;
    expect(ok['not_found']).toEqual(['ghost']);
    expect(setMotionPath({ design_path: dPath, layer_ids: ['ghost'], path: 'M 0 0 L 9 0' }).success).toBe(false);
  });

  it('clears a path and the layer stops travelling', () => {
    setMotionPath({ design_path: dPath, layer_ids: ['dot'], path: 'M 0 0 L 400 0', duration: 1000 });
    setMotionPath({ design_path: dPath, layer_ids: ['dot'], clear: true });
    expect((read().layers?.[0] as unknown as Record<string, unknown>)['motion_path']).toBeUndefined();
    const x = (layersAt(read().layers as Layer[], 500)[0] as unknown as Record<string, unknown>)['x'];
    expect(x).toBe(100);
  });
});
