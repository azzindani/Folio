import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { updateLayer, removeLayer, patchDesign } from '../engine-edit-tools';
import { detachLayers } from './detach-op';
import { moveLayers } from '../engine-transform-tools';
import { resolveSpec } from '../../renderer/resolve-source';
import { renderToSVGString } from './svg-export';
import type { DesignSpec, Layer } from '../../schema/types';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-override-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

const PEOPLE = ['Ada', 'Grace', 'Edsger', 'Barbara'].map(name => ({ name, role: 'Speaker' }));
const spec = (overrides?: object): object => ({
  _protocol: 'design/v1',
  meta: { id: 'd', name: 'Overrides', type: 'poster', created: '', modified: '' },
  document: { width: 1080, height: 1350 },
  layers: [
    { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: '#FBF7F0' },
    { id: 'people', type: 'group', z: 1, x: 80, y: 400, width: 920, height: 600, layers: [], gallery: { items: PEOPLE, columns: 2, gap: 20, ...(overrides ? { overrides } : {}), template: [
      { id: 'card', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100, fill: '#F2EBDD', formulas: { width: '=CellW', height: '=CellH' } },
      { id: 'name', type: 'text', z: 1, x: 24, y: 24, width: 300, height: 48, content: { type: 'plain', value: '{{name}}' }, style: { font_size: 36, color: '#141414' } },
      { id: 'role', type: 'text', z: 1, x: 24, y: 80, width: 300, height: 32, content: { type: 'plain', value: '{{role}}' }, style: { font_size: 22, color: '#5A5147' } },
    ] } },
  ],
});
const write = (overrides?: object): string => { const p = path.join(tmpDir, 'd.design.yaml'); fs.writeFileSync(p, yaml.dump(spec(overrides))); return p; };
const read = (p: string): DesignSpec => yaml.load(fs.readFileSync(p, 'utf-8')) as DesignSpec;
const item = (s: DesignSpec, id: string): Layer | undefined => {
  const find = (ls: Layer[]): Layer | undefined => { for (const l of ls) { if (l.id === id) return l; const k = find((l as Layer & { layers?: Layer[] }).layers ?? []); if (k) return k; } return undefined; };
  return find(resolveSpec(s).layers ?? []);
};

describe('gallery overrides', () => {
  it('replay one item\'s edits on every resolve — over the template\'s formula, and null takes an item out', () => {
    const s = spec({ people_2_name: { style: { color: '#E4572E' } }, people_1_card: { width: 120 }, people_3: null }) as unknown as DesignSpec;
    expect(item(s, 'people_2_name')).toMatchObject({ style: { color: '#E4572E', font_size: 36 } });
    expect(item(s, 'people_1_name')).toMatchObject({ style: { color: '#141414' } });
    expect(item(s, 'people_1_card')).toMatchObject({ width: 120 });
    expect(item(s, 'people_2_card')).toMatchObject({ width: 450 });
    expect(item(s, 'people_3')).toBeUndefined();
    expect(renderToSVGString(s)).not.toContain('>Edsger<');
  });

  it('store an edit_layer update of a generated item in the template\'s frame, so it moves with the gallery', () => {
    const p = write();
    const r = updateLayer({ design_path: p, layer_id: 'people_4_name', props: { y: 900, color: '#1B998B' } as never });
    expect(r.success).toBe(true);
    const g = (read(p).layers ?? [])[1] as Layer & { gallery: { overrides: object } };
    expect(g.gallery.overrides).toEqual({ people_4_name: { y: 900 - 710, style: { color: '#1B998B' } } });
    expect(item(read(p), 'people_4_name')).toMatchObject({ y: 900, style: { color: '#1B998B' } });
    const moved = read(p);
    (moved.layers ?? [])[1]!.y = 500;
    expect(item(moved, 'people_4_name')).toMatchObject({ y: 1000 });
    // Set back to the template's colour: the item's own colour is cleared, not kept.
    updateLayer({ design_path: p, layer_id: 'people_4_name', props: { color: '#141414' } as never });
    expect(((read(p).layers ?? [])[1] as Layer & { gallery: { overrides: object } }).gallery.overrides).toEqual({ people_4_name: { y: 190 } });
  });

  it('take an item out on remove, route a patch_design path, and refuse to move a cell\'s box', () => {
    const p = write();
    expect(removeLayer({ design_path: p, layer_id: 'people_1' }).success).toBe(true);
    const patched = patchDesign({ design_path: p, selectors: [{ path: 'layers[id=people_2_role].style.color', value: '#E4572E' }] }) as unknown as { success: boolean; routed: object[] };
    expect(patched.success).toBe(true);
    expect(patched.routed).toEqual([{ from: 'layers[id=people_2_role].style.color', to: 'layers[id=people].gallery.overrides.people_2_role.style.color' }]);
    expect(item(read(p), 'people_1')).toBeUndefined();
    expect(item(read(p), 'people_2_role')).toMatchObject({ style: { color: '#E4572E' } });
    expect(updateLayer({ design_path: p, layer_id: 'people_2', props: { x: 10 } as never }).error).toMatch(/its box is the gallery's layout/);
    expect(updateLayer({ design_path: p, layer_id: 'people_9_name', props: { x: 10 } as never }).error).toMatch(/Layer not found/);
  });

  it('take edit_layer move — the fix call diagnose writes — on a generated item', () => {
    const p = write();
    const r = moveLayers({ design_path: p, layer_id: 'people_3_role', dy: -40 }) as unknown as { success: boolean; dy: number };
    expect(r.success).toBe(true);
    expect(r.dy).toBe(-40);
    expect(item(read(p), 'people_3_role')).toMatchObject({ x: 104, y: 710 + 80 - 40 });
    expect(((read(p).layers ?? [])[1] as Layer & { gallery: { overrides: object } }).gallery.overrides).toEqual({ people_3_role: { y: 40 } });
    expect(item(read(p), 'people_4_role')).toMatchObject({ y: 710 + 80 });
    expect(moveLayers({ design_path: p, layer_id: 'people_2', dx: 10 }).error).toMatch(/moves with its cell/);
  });

  it('are baked by detach along with the rest', () => {
    const p = write({ people_2_name: { style: { color: '#E4572E' } } });
    detachLayers({ design_path: p, layer_id: 'people' });
    const cells = ((read(p).layers ?? [])[1] as Layer & { layers: (Layer & { layers: Layer[] })[] }).layers;
    expect(cells[1]?.layers.find(l => l.id === 'people_2_name')).toMatchObject({ style: { color: '#E4572E' } });
  });
});

describe('overrides on a gallery nested in a gallery (close-out C3)', () => {
  // Two rows, each holding a nested gallery of three chips: rows_2_chips_3_chip is generated twice over.
  const nested = (overrides?: object): object => ({
    _protocol: 'design/v1', meta: { id: 'n', name: 'Nested', type: 'poster', created: '', modified: '' }, document: { width: 1080, height: 1080 },
    layers: [{ id: 'rows', type: 'group', z: 1, x: 100, y: 100, width: 800, height: 400, layers: [], gallery: { items: [{ t: 'A' }, { t: 'B' }], columns: 1, gap: 40,
      ...(overrides ? { overrides } : {}), template: [
        { id: 'title', type: 'text', z: 1, x: 0, y: 0, width: 300, height: 40, content: { type: 'plain', value: '{{t}}' }, style: { font_size: 30, color: '#141414' } },
        { id: 'chips', type: 'group', z: 1, x: 0, y: 60, width: 600, height: 60, layers: [], gallery: { items: 3, gap: 20, template: [
          { id: 'chip', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 60, fill: '#2B3A4A' }] } },
      ] } }],
  });
  const put = (overrides?: object): string => { const p = path.join(tmpDir, 'n.design.yaml'); fs.writeFileSync(p, yaml.dump(nested(overrides))); return p; };

  it('move, restyle and remove one nested item by the id diagnose names — stored on the outer gallery, that cell only', () => {
    const p = put();
    const before = item(read(p), 'rows_2_chips_3_chip') as Layer & { x: number; y: number };
    expect(before).toMatchObject({ x: 100 + 2 * (560 / 3 + 20), y: 100 + 180 + 40 + 60 });
    const r = moveLayers({ design_path: p, layer_id: 'rows_2_chips_3_chip', dy: 10 }) as unknown as { success: boolean };
    expect(r.success).toBe(true);
    expect(updateLayer({ design_path: p, layer_id: 'rows_2_chips_2_chip', props: { fill: '#E4572E' } as never }).success).toBe(true);
    expect(removeLayer({ design_path: p, layer_id: 'rows_1_chips_1' }).success).toBe(true);
    const s = read(p);
    const ov = (s.layers?.[0] as unknown as { gallery: { overrides: Record<string, unknown> } }).gallery.overrides;
    expect(Object.keys(ov).sort()).toEqual(['rows_1_chips_1', 'rows_2_chips_2_chip', 'rows_2_chips_3_chip']);
    expect(item(s, 'rows_2_chips_3_chip')).toMatchObject({ y: before.y + 10 });
    expect(item(s, 'rows_1_chips_3_chip')).toMatchObject({ y: 100 + 60 });
    expect(item(s, 'rows_2_chips_2_chip')).toMatchObject({ fill: '#E4572E' });
    expect(item(s, 'rows_1_chips_2_chip')).toMatchObject({ fill: '#2B3A4A' });
    expect(item(s, 'rows_1_chips_1')).toBeUndefined();
    expect(item(s, 'rows_2_chips_1')).toBeDefined();
  });

  it('refuses a nested cell\'s box by the gallery that makes it, and an item past the rows', () => {
    const p = put();
    expect(updateLayer({ design_path: p, layer_id: 'rows_1_chips_2', props: { x: 10 } as never }).error).toMatch(/cell of "rows_1_chips"/);
    expect(updateLayer({ design_path: p, layer_id: 'rows_3_chips_1_chip', props: { x: 10 } as never }).error).toMatch(/Layer not found/);
  });
});
