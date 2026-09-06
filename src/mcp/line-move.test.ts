import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { updateLayer } from './engine-edit-tools';
import { alignLayers } from './engine-export-tools';
import type { DesignSpec, Layer } from '../schema/types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-linemove-'));
let dPath = '';
let n = 0;
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  const dir = path.join(root, `c${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({
    _protocol: 'design/v1',
    meta: { id: 'd', name: 'D', type: 'poster' },
    document: { width: 1000, height: 1000 },
    layers: [
      { id: 'ln', type: 'line', x: 100, y: 200, width: 600, height: 0, x1: 100, y1: 200, x2: 700, y2: 200, stroke: { color: '#111', width: 6 } },
      { id: 'box', type: 'rect', x: 100, y: 600, width: 600, height: 100, fill: { type: 'solid', color: '#003049' } },
    ],
  }));
});
const ln = (): Record<string, unknown> =>
  ((yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec).layers as Layer[])
    .map(l => l as unknown as Record<string, unknown>).find(l => l['id'] === 'ln') as Record<string, unknown>;

// A line renders from ABSOLUTE endpoints; the box is only what everything else
// measures. Moving the box alone left the ink behind — inspect, diagnose and
// collision all reported the new place and the picture showed the old one.
// Found by scanning the real library: one live design had a line whose box sat
// 430px from its own ink.
describe('moving a line takes its ink with it', () => {
  it('update {y} drags the endpoints', () => {
    updateLayer({ design_path: dPath, layer_id: 'ln', props: { y: 800 } as Partial<Layer> });
    const l = ln();
    expect(l['y']).toBe(800);
    expect(l['y1']).toBe(800);
    expect(l['y2']).toBe(800);
    expect(l['x1']).toBe(100);           // untouched axis stays put
  });

  it('update {x,y} drags both axes and keeps the length', () => {
    updateLayer({ design_path: dPath, layer_id: 'ln', props: { x: 300, y: 500 } as Partial<Layer> });
    const l = ln();
    expect([l['x1'], l['y1'], l['x2'], l['y2']]).toEqual([300, 500, 900, 500]);
  });

  it('an endpoint named in the same patch wins over the shift', () => {
    updateLayer({ design_path: dPath, layer_id: 'ln', props: { y: 800, y1: 42 } as unknown as Partial<Layer> });
    const l = ln();
    expect(l['y1']).toBe(42);
    expect(l['y2']).toBe(800);
  });

  it('a non-move patch leaves the endpoints alone', () => {
    updateLayer({ design_path: dPath, layer_id: 'ln', props: { opacity: 0.5 } as Partial<Layer> });
    expect([ln()['x1'], ln()['y1']]).toEqual([100, 200]);
  });

  it('align drags them too', () => {
    alignLayers({ design_path: dPath, layer_ids: ['ln', 'box'], operation: 'top' });
    const l = ln();
    expect(l['y1']).toBe(l['y']);
    expect(l['y2']).toBe(l['y']);
  });
});
