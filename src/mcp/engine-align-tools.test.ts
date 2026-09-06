import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { alignLayers } from './engine-align-tools';

// Found by asking what a FAILED call leaves behind, then noticing align never
// failed at all: it answered success:true for ids that do not exist, and could
// not see inside a group — which is where 267 of 279 real designs keep their
// layers, because every MCP poster is ONE group.

type Res = { success: boolean; aligned?: string[]; unresolved?: string[]; skipped_locked?: string[]; error?: string };

describe('alignLayers', () => {
  let tmp: string;
  let fp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-align-'));
    fs.mkdirSync(path.join(tmp, 'designs'), { recursive: true });
    fp = path.join(tmp, 'designs', 'd.design.yaml');
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const write = (layersYaml: string): void => fs.writeFileSync(fp,
    `_protocol: design/v1\nmeta:\n  name: T\n  type: poster\ndocument:\n  width: 1000\n  height: 1000\n  unit: px\n  dpi: 96\nlayers:\n${layersYaml}`);

  const box = (id: string, x: number, y: number, indent = '  '): string =>
    `${indent}- id: ${id}\n${indent}  type: rect\n${indent}  x: ${x}\n${indent}  'y': ${y}\n${indent}  width: 100\n${indent}  height: 50\n`;

  const layers = (): Record<string, unknown>[] =>
    (require('js-yaml') as { load: (s: string) => { layers: Record<string, unknown>[] } }).load(fs.readFileSync(fp, 'utf8')).layers;

  it('reaches layers nested inside a group', () => {
    write(`  - id: g\n    type: group\n    x: 0\n    'y': 0\n    width: 1000\n    height: 1000\n    layers:\n${box('a', 100, 10, '      ')}${box('b', 400, 80, '      ')}`);
    const r = alignLayers({ design_path: fp, layer_ids: ['a', 'b'], operation: 'left' }) as unknown as Res;
    expect(r.success).toBe(true);
    expect(r.aligned).toEqual(['a', 'b']);
    const kids = (layers()[0]?.['layers'] as Record<string, unknown>[]);
    expect(kids.map(k => k['x'])).toEqual([100, 100]);   // b pulled to a's left edge
  });

  it('names the ids it could not find instead of quietly doing less', () => {
    write(`${box('a', 100, 10)}${box('b', 400, 80)}`);
    const r = alignLayers({ design_path: fp, layer_ids: ['a', 'b', 'ghost'], operation: 'left' }) as unknown as Res;
    expect(r.success).toBe(true);
    expect(r.aligned).toEqual(['a', 'b']);
    expect(r.unresolved).toEqual(['ghost']);
  });

  it('says nothing about unresolved when every id was found', () => {
    write(`${box('a', 100, 10)}${box('b', 400, 80)}`);
    const r = alignLayers({ design_path: fp, layer_ids: ['a', 'b'], operation: 'left' }) as unknown as Res;
    expect(r.unresolved).toBeUndefined();
    expect(r.skipped_locked).toBeUndefined();
  });

  it('leaves a child of a LOCKED group alone and reports it', () => {
    write(`  - id: g\n    type: group\n    locked: true\n    x: 0\n    'y': 0\n    width: 1000\n    height: 1000\n    layers:\n${box('a', 100, 10, '      ')}\n${box('b', 400, 80)}`);
    const r = alignLayers({ design_path: fp, layer_ids: ['a', 'b'], operation: 'left' }) as unknown as Res;
    expect(r.aligned).toEqual(['b']);
    expect(r.skipped_locked?.[0]).toContain('a');
    const kids = (layers()[0]?.['layers'] as Record<string, unknown>[]);
    expect(kids[0]?.['x']).toBe(100);            // untouched
  });

  it('still errors when nothing usable was named', () => {
    write(`${box('a', 100, 10)}`);
    const r = alignLayers({ design_path: fp, layer_ids: ['ghost1', 'ghost2'], operation: 'left' }) as unknown as Res;
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('No positioned target layers');
  });
});
