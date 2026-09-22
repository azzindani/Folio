import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { load } from 'js-yaml';
import { moveLayers, scaleLayers } from './engine-transform-tools';
import { alignLayers } from './engine-align-tools';

// Found live (2026-09-20): a revision moved a group and its children stayed
// behind — they carry absolute coordinates. move/scale edit what is DRAWN.

type Res = { success: boolean; dx?: number; dy?: number; factor?: number; before?: Record<string, number>; after?: Record<string, number>; error?: string; unresolved?: string[] };
type Node = Record<string, unknown> & { layers?: Node[] };

describe('edit_layer move / scale', () => {
  let tmp: string;
  let fp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-transform-'));
    fs.mkdirSync(path.join(tmp, 'designs'), { recursive: true });
    fp = path.join(tmp, 'designs', 'd.design.yaml');
    // A card group at the right edge: its box claims the whole canvas, its children sit at x 1400.
    fs.writeFileSync(fp, `_protocol: design/v1\nmeta:\n  name: T\n  type: poster\ndocument:\n  width: 1920\n  height: 1080\n  unit: px\n  dpi: 96\nlayers:
  - id: card
    type: group
    x: 0
    'y': 0
    width: 1920
    height: 1080
    layers:
      - { id: panel, type: rect, x: 1400, 'y': 700, width: 400, height: 300 }
      - { id: title, type: text, x: 1420, 'y': 720, width: 360, height: 60, content: { type: plain, value: Hi }, style: { font_size: 48 } }
      - { id: rule, type: path, d: 'M1420 800 L1780 800' }
`);
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const tree = (): Node[] => (load(fs.readFileSync(fp, 'utf8')) as { layers: Node[] }).layers;
  const kid = (id: string): Node | undefined => tree()[0]?.layers?.find(l => l['id'] === id);

  it('centres a group on the canvas — its children and path come along', () => {
    const r = moveLayers({ design_path: fp, layer_id: 'card', to: 'center' }) as unknown as Res;
    expect(r.success).toBe(true);
    expect(r.before).toEqual({ x: 1400, y: 700, width: 400, height: 300 });
    expect(r.after).toEqual({ x: 760, y: 390, width: 400, height: 300 });
    expect(kid('panel')?.['x']).toBe(760);
    expect(kid('title')?.['y']).toBe(410);
    expect(kid('rule')?.['d']).toBe('M780 490L1140 490');
  });

  it('moves by dx/dy and to a top-left x/y', () => {
    expect((moveLayers({ design_path: fp, layer_id: 'card', dx: -100 }) as unknown as Res).after?.['x']).toBe(1300);
    expect((moveLayers({ design_path: fp, layer_id: 'card', x: 80, y: 80 }) as unknown as Res).after).toEqual({ x: 80, y: 80, width: 400, height: 300 });
  });

  it('refuses a no-op move and an unknown layer', () => {
    expect((moveLayers({ design_path: fp, layer_id: 'card', dx: 0 }) as unknown as Res).success).toBe(false);
    expect((moveLayers({ design_path: fp, layer_id: 'ghost', dx: 10 }) as unknown as Res).success).toBe(false);
  });

  it('scales a group about its centre — type size with it', () => {
    const r = scaleLayers({ design_path: fp, layer_id: 'card', width: 800 }) as unknown as Res;
    expect(r.factor).toBe(2);
    expect(r.after).toEqual({ x: 1200, y: 550, width: 800, height: 600 });
    expect((kid('title')?.['style'] as { font_size: number }).font_size).toBe(96);
  });

  it('scales about an anchor, and rejects a bad one', () => {
    const r = scaleLayers({ design_path: fp, layer_id: 'card', factor: 0.5, anchor: 'top_left' }) as unknown as Res;
    expect(r.after).toEqual({ x: 1400, y: 700, width: 200, height: 150 });
    expect((scaleLayers({ design_path: fp, layer_id: 'card', factor: 2, anchor: 'middle' }) as unknown as Res).success).toBe(false);
  });

  it('align moves a group with its children (was: box moved, ink stayed)', () => {
    fs.writeFileSync(fp, `_protocol: design/v1\nmeta:\n  name: T\n  type: poster\ndocument:\n  width: 1920\n  height: 1080\n  unit: px\n  dpi: 96\nlayers:
  - { id: gA, type: group, x: 100, 'y': 100, width: 200, height: 100, layers: [{ id: a, type: rect, x: 100, 'y': 100, width: 200, height: 100 }] }
  - { id: gB, type: group, x: 500, 'y': 400, width: 200, height: 100, layers: [{ id: b, type: rect, x: 500, 'y': 400, width: 200, height: 100 }] }
`);
    const r = alignLayers({ design_path: fp, layer_ids: ['gA', 'gB'], operation: 'left' }) as unknown as Res;
    expect(r.success).toBe(true);
    const [gA, gB] = tree();
    expect(gB?.['x']).toBe(100);
    expect(gB?.layers?.[0]?.['x']).toBe(100);          // the child came along
    expect(gA?.layers?.[0]?.['x']).toBe(100);
  });
});
