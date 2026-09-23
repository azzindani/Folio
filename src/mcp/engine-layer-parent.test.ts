import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { createProject, createDesign } from './engine-project-tools';
import { addLayers } from './engine-layer-tools';
import { findGroup } from './engine-layer-parent';
import type { DesignSpec, Layer } from '../schema/types';

let root = '', dPath = '';

const scene = (locked: boolean): Layer[] => ([{
  id: 'scene', type: 'group', z: 1, locked, x: 0, y: 0, width: 1920, height: 1080,
  layers: [{ id: 'card', type: 'rect', z: 2, x: 100, y: 100, width: 400, height: 200, fill: '#FFFFFF' }],
} as unknown as Layer]);
// Deep in a zoom, authored text is a few px tall — the size the rescue passes exist to "fix".
const tiny: Layer[] = [{
  id: 'tiny', type: 'text', z: 9, x: 1416, y: 740, width: 46, height: 6,
  content: { type: 'plain', value: 'the gap' }, style: { font_family: 'Archivo', font_size: 2.1, color: '#0B0B0B' },
} as unknown as Layer];

const load = (): DesignSpec => yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-parent-'));
  process.env['FOLIO_PROJECTS_DIR'] = root;
  createProject({ name: 'p', canvas: '1920x1080' });
  const made = createDesign({ project_path: 'p', name: 'd', type: 'poster', width: 1920, height: 1080 }) as unknown as { path: string };
  dPath = made.path;
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env['FOLIO_PROJECTS_DIR'];
});

describe('add_layers {parent_id} — extending a scene that is already built', () => {
  it('puts the layers inside the named group, not at the top level', () => {
    addLayers({ design_path: dPath, layers: scene(false) });
    const r = addLayers({ design_path: dPath, parent_id: 'scene', layers: [{ id: 'chip', type: 'rect', z: 3, x: 200, y: 200, width: 80, height: 30, fill: '#C6FF1F' } as unknown as Layer] });
    expect(r.success).toBe(true);
    const spec = load();
    expect(findGroup(spec.layers ?? [], 'scene')?.layers?.map(l => l.id)).toEqual(['card', 'chip']);
    expect((spec.layers ?? []).map(l => l.id)).not.toContain('chip');
  });

  it('leaves authored geometry alone under a LOCKED parent, and still rescues it under an unlocked one', () => {
    addLayers({ design_path: dPath, layers: scene(true) });
    addLayers({ design_path: dPath, parent_id: 'scene', layers: tiny });
    const kept = findGroup(load().layers ?? [], 'scene')?.layers?.find(l => l.id === 'tiny') as unknown as { style?: { font_size?: number } };
    expect(kept.style?.font_size).toBe(2.1);
  });

  it('inherits the lock: a beat inside a locked scene is authored geometry too', () => {
    const nested = scene(true);
    (nested[0] as unknown as { layers: Layer[] }).layers.push({ id: 'b8', type: 'group', z: 8, x: 0, y: 0, width: 1920, height: 1080, layers: [] } as unknown as Layer);
    addLayers({ design_path: dPath, layers: nested });
    addLayers({ design_path: dPath, parent_id: 'b8', layers: tiny });
    const kept = findGroup(load().layers ?? [], 'b8')?.layers?.find(l => l.id === 'tiny') as unknown as { style?: { font_size?: number } };
    expect(kept.style?.font_size).toBe(2.1);
  });

  it('stacks what it adds on top of the group, unless told a z', () => {
    addLayers({ design_path: dPath, layers: scene(true) });
    const lines = [1, 2, 3].map(i => ({ id: `line${i}`, type: 'rect', z: i + 1, x: 300 * i, y: 0, width: 2, height: 1080, fill: '#18222D' }));
    addLayers({ design_path: dPath, parent_id: 'scene', layers: lines as unknown as Layer[] });
    addLayers({ design_path: dPath, parent_id: 'scene', layers_shorthand: [{ id: 'mark', type: 'rect', pos: [280, 300, 400, 40], fill: '#C6F432' }, { id: 'under', type: 'rect', z: 1, pos: [0, 0, 10, 10], fill: '#000000' }] } as never);
    const kids = findGroup(load().layers ?? [], 'scene')?.layers ?? [];
    const z = (id: string): number => Number(kids.find(l => l.id === id)?.z);
    expect(z('mark')).toBeGreaterThan(Math.max(z('line1'), z('line2'), z('line3'), z('card')));
    expect(z('under')).toBe(1);
    expect(JSON.stringify(load())).not.toContain('__auto_z');
    addLayers({ design_path: dPath, layers_shorthand: [{ id: 'top', type: 'rect', pos: [0, 0, 10, 10], fill: '#000000' }] } as never);
    expect(JSON.stringify(load())).not.toContain('__auto_z');
  });

  it('says so when the parent is not there', () => {
    addLayers({ design_path: dPath, layers: scene(false) });
    const r = addLayers({ design_path: dPath, parent_id: 'nope', layers: tiny });
    expect(r.success).toBe(false);
    expect(String((r as unknown as { error: string }).error)).toContain('nope');
  });
});
