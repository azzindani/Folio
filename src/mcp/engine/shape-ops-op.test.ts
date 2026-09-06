import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { shapeOp } from './shape-ops-op';
import type { DesignSpec, Layer } from '../../schema/types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-shape-'));
let dPath = '';
let n = 0;

const SQ = 'M 0 0 L 100 0 L 100 100 L 0 100 Z';
const TRI = 'M 50 0 L 100 100 L 0 100 Z';

beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({
    meta: { id: 'd', name: 'D', type: 'poster' },
    document: { width: 400, height: 400 },
    layers: [
      { id: 'sq', type: 'path', d: SQ, fill: '#111' },
      { id: 'tri', type: 'path', d: TRI, fill: '#222' },
      { id: 'line', type: 'path', d: 'M 0 50 L 200 50', stroke: '#f00', stroke_width: 20 },
      // The shape the SCHEMA uses — a Stroke is {color, width}. Every fixture
      // here used the flat `stroke_width` the code happened to read, which is
      // why outline_stroke passed its tests while refusing every real layer.
      { id: 'rule', type: 'path', d: 'M 0 50 L 200 50', stroke: { color: '#f00', width: 14 } },
      { id: 'box', type: 'rect', x: 0, y: 0, width: 10, height: 10 },
    ],
  }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const read = (): DesignSpec => yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec;
const byId = (id: string): Record<string, unknown> | undefined =>
  (read().layers as Layer[]).map(l => l as unknown as Record<string, unknown>).find(l => l['id'] === id);

describe('edit_layer op:shape', () => {
  it('offsets a path into a new layer and leaves the original', async () => {
    const r = await shapeOp({ design_path: dPath, shape_op: 'offset', layer_ids: ['sq'], delta: -10 }) as Record<string, unknown>;
    expect(r['success']).toBe(true);
    expect(r['created']).toEqual(['sq_offset']);
    expect(byId('sq')?.['d']).toBe(SQ);
    expect(String(byId('sq_offset')?.['d'])).toContain('10.00');
  });

  it('drops the source when asked', async () => {
    await shapeOp({ design_path: dPath, shape_op: 'offset', layer_ids: ['sq'], delta: 5, keep_source: false });
    expect(byId('sq')).toBeUndefined();
    expect(byId('sq_offset')).toBeDefined();
  });

  it('outlines a stroke into a FILLED shape carrying the stroke colour', async () => {
    const r = await shapeOp({ design_path: dPath, shape_op: 'outline_stroke', layer_ids: ['line'] }) as Record<string, unknown>;
    expect(r['success']).toBe(true);
    const out = byId('line_outlined');
    expect(out?.['fill']).toBe('#f00');
    expect(out?.['stroke_width']).toBeUndefined();
  });

  it('blends between two shapes without consuming either', async () => {
    const r = await shapeOp({ design_path: dPath, shape_op: 'blend', layer_ids: ['sq', 'tri'], steps: 3 }) as Record<string, unknown>;
    expect(r['created']).toEqual(['sq_blend_1', 'sq_blend_2', 'sq_blend_3']);
    expect(byId('sq')).toBeDefined();
    expect(byId('tri')).toBeDefined();
  });

  it('says what it needs instead of guessing', async () => {
    expect((await shapeOp({ design_path: dPath, shape_op: 'blend', layer_ids: ['sq'] })).success).toBe(false);
    expect((await shapeOp({ design_path: dPath, shape_op: 'offset', layer_ids: ['sq'], delta: 0 })).success).toBe(false);
  });

  it('refuses a layer that has no path of its own, and says why', async () => {
    const r = await shapeOp({ design_path: dPath, shape_op: 'offset', layer_ids: ['box'], delta: 5 });
    expect(r.success).toBe(false);
    expect(String(r.hint)).toContain('type:"path"');
  });

  it('refuses an outline with no width to outline', async () => {
    const r = await shapeOp({ design_path: dPath, shape_op: 'outline_stroke', layer_ids: ['sq'] });
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('No stroke width');
  });

  // ── The three faults a live call found, that passing tests did not ──
  // All of them the same mistake: asserting against the shape the code wanted
  // rather than the shape a real design has.

  it('takes the width from the schema stroke object, not a flat field', async () => {
    const r = await shapeOp({ design_path: dPath, shape_op: 'outline_stroke', layer_ids: ['rule'] });
    expect(r.success).toBe(true);
    expect(r['created']).toEqual(['rule_outlined']);
  });

  it('fills the outline with the stroke COLOUR, never the stroke object', async () => {
    await shapeOp({ design_path: dPath, shape_op: 'outline_stroke', layer_ids: ['rule'] });
    const made = byId('rule_outlined');
    // `fill: {color,width}` is not a Fill — it renders as nothing at all, which
    // is how this shipped: the op reported success and drew an invisible layer.
    expect(made?.['fill']).toBe('#f00');
    expect(made?.['stroke']).toBeUndefined();
  });

  it('gives every generated path a box, so heal does not treat it as a stray', async () => {
    await shapeOp({ design_path: dPath, shape_op: 'offset', layer_ids: ['sq'], delta: 10 });
    const made = byId('sq_offset');
    for (const k of ['x', 'y', 'width', 'height']) expect(typeof made?.[k]).toBe('number');
    // Grown by 10 from a 100×100 square at the origin.
    expect(made?.['x']).toBe(-10);
    expect(made?.['width']).toBe(120);
  });
});

describe('op:shape on a carousel — same refusal as split_text and update', () => {
  it('refuses to guess which page, and names them', async () => {
    const dir = path.join(root, `deck-${n++}`, 'designs');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'deck.design.yaml');
    const page = (id: string): Record<string, unknown> => ({
      id, layers: [{ id: 'sq', type: 'path', d: SQ, fill: '#111' }],
    });
    fs.writeFileSync(p, yaml.dump({
      meta: { id: 'k', name: 'K', type: 'carousel' },
      document: { width: 400, height: 400 },
      pages: [page('page_1'), page('page_2')],
    }));
    const r = await shapeOp({ design_path: p, shape_op: 'offset', layer_ids: ['sq'], delta: 5 });
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('2 pages');
    // ...and works when told which one.
    const ok = await shapeOp({ design_path: p, shape_op: 'offset', layer_ids: ['sq'], delta: 5, page_id: 'page_2' });
    expect(ok.success, JSON.stringify(ok)).toBe(true);
  });
});

describe('repeat invocations must not collide', () => {
  // Running an op twice named both results `sq_offset`. Duplicate ids are not
  // cosmetic: on the live server `update sq_offset` then patched BOTH layers
  // and `remove word_c1` deleted BOTH. Found by calling the same op twice.
  const idsOf = (): string[] => (read().layers as Layer[]).map(l => String((l as { id?: unknown }).id));

  it('appends a suffix instead of reusing a taken id', async () => {
    await shapeOp({ design_path: dPath, shape_op: 'offset', layer_ids: ['sq'], delta: 20 });
    await shapeOp({ design_path: dPath, shape_op: 'offset', layer_ids: ['sq'], delta: 20 });
    const ids = idsOf();
    expect(ids).toContain('sq_offset');
    expect(ids).toContain('sq_offset_2');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the whole batch of a repeated blend unique', async () => {
    await shapeOp({ design_path: dPath, shape_op: 'blend', layer_ids: ['sq', 'tri'], steps: 2 });
    await shapeOp({ design_path: dPath, shape_op: 'blend', layer_ids: ['sq', 'tri'], steps: 2 });
    const ids = idsOf();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter(i => i.startsWith('sq_blend')).length).toBe(4);
  });
});
