import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { shapeOp } from './shape-ops-op';
import type { DesignSpec, Layer } from '../../schema/types';

// `shape` was the ONLY design-writing op that awaited between reading the
// design and writing it back — `await import('polygon-clipping')` inside
// offsetPath/outlineStroke. It held a whole-document spec across that yield and
// wrote it back afterwards, so any edit that landed in the window was reported
// successful and then silently reverted.
//
// Measured live against the deployed server: 20 concurrent updates, each on its
// own layer, fired alongside one cold `shape offset`. All 20 answered
// success:true; 18 were in the file. The same 20 with no shape op: 20 of 20.
// Every other op is atomic only because it happens never to yield.

// The race has to be DETERMINISTIC to be evidence. Relying on `await
// import('polygon-clipping')` being slow only works while the module is cold —
// the first version of this file passed its first test and silently stopped
// racing at all in the rest. So gate the async step explicitly: the op parks
// where it really yields, the concurrent write lands, and only then is it let
// through.
const gate = vi.hoisted(() => {
  let release: () => void = () => { /* replaced by arm() */ };
  let current: Promise<void> = Promise.resolve();
  return {
    arm(): void { current = new Promise<void>(r => { release = r; }); },
    open(): void { release(); },
    wait(): Promise<void> { return current; },
  };
});

vi.mock('../../engine/path-ops', async importOriginal => {
  const actual = await importOriginal<typeof import('../../engine/path-ops')>();
  return {
    ...actual,
    offsetPath: async (d: string, delta: number) => { await gate.wait(); return actual.offsetPath(d, delta); },
    outlineStroke: async (d: string, w: number) => { await gate.wait(); return actual.outlineStroke(d, w); },
  };
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-shape-race-'));
let dPath = '';
let n = 0;

const SQ = 'M 0 0 L 100 0 L 100 100 L 0 100 Z';

beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({
    meta: { id: 'd', name: 'D', type: 'poster' },
    document: { width: 400, height: 400 },
    layers: [
      { id: 'sq', type: 'path', d: SQ, fill: '#111' },
      { id: 'rule', type: 'path', d: 'M 0 50 L 200 50', stroke: { color: '#f00', width: 14 } },
      { id: 'bystander', type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#000000' },
    ],
  }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const read = (): DesignSpec => yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec;
const byId = (id: string): Record<string, unknown> | undefined =>
  (read().layers as Layer[]).map(l => l as unknown as Record<string, unknown>).find(l => l['id'] === id);

/** Exactly what a second concurrent request does: read, change one layer, write. */
function concurrentEdit(id: string, fill: string): void {
  const spec = read();
  const layer = (spec.layers as Layer[]).map(l => l as unknown as Record<string, unknown>).find(l => l['id'] === id);
  if (layer) layer['fill'] = fill;
  fs.writeFileSync(dPath, yaml.dump(spec));
}

describe('a write landing during the path math survives', () => {
  it('offset does not revert a concurrent edit', async () => {
    gate.arm();
    const running = shapeOp({ design_path: dPath, shape_op: 'offset', layer_ids: ['sq'], delta: -10 });
    await new Promise(r => setTimeout(r, 0));   // op is now parked on the gate
    concurrentEdit('bystander', '#EE0000');
    gate.open();
    const r = await running as Record<string, unknown>;

    expect(r['success'], 'the shape op itself should still succeed').toBe(true);
    expect(byId('bystander')?.['fill'], 'the concurrent edit was silently reverted').toBe('#EE0000');
    expect(byId('sq_offset'), 'the shape op still did its own work').toBeDefined();
  });

  it('outline_stroke does not revert a concurrent edit', async () => {
    gate.arm();
    const running = shapeOp({ design_path: dPath, shape_op: 'outline_stroke', layer_ids: ['rule'] });
    await new Promise(r => setTimeout(r, 0));
    concurrentEdit('bystander', '#00EE00');
    gate.open();
    const r = await running as Record<string, unknown>;

    expect(r['success']).toBe(true);
    expect(byId('bystander')?.['fill']).toBe('#00EE00');
    expect(byId('rule_outlined')).toBeDefined();
  });

  it('a layer ADDED during the math is not deleted', async () => {
    // The reverted write need not be an edit — a whole layer can disappear.
    gate.arm();
    const running = shapeOp({ design_path: dPath, shape_op: 'offset', layer_ids: ['sq'], delta: 6 });
    await new Promise(r => setTimeout(r, 0));
    const spec = read();
    (spec.layers as Layer[]).push({ id: 'arrived', type: 'rect', x: 1, y: 1, width: 5, height: 5 } as unknown as Layer);
    fs.writeFileSync(dPath, yaml.dump(spec));
    gate.open();
    await running;

    expect(byId('arrived'), 'a layer added during the math was wiped out').toBeDefined();
    expect(byId('sq_offset')).toBeDefined();
  });

  it('still refuses cleanly if its target vanishes mid-flight, writing nothing', async () => {
    gate.arm();
    const running = shapeOp({ design_path: dPath, shape_op: 'offset', layer_ids: ['sq'], delta: 6 });
    await new Promise(r => setTimeout(r, 0));
    const spec = read();
    spec.layers = (spec.layers as Layer[]).filter(l => (l as unknown as Record<string, unknown>)['id'] !== 'sq');
    fs.writeFileSync(dPath, yaml.dump(spec));
    gate.open();
    const r = await running as Record<string, unknown>;

    expect(r['success']).toBe(false);
    expect(String(r['error'])).toMatch(/no longer there/i);
    // The removal stands; the op did not resurrect `sq` by writing a stale doc.
    expect(byId('sq')).toBeUndefined();
  });

  it('reads its style from the FRESH layer, not the one it started with', async () => {
    // The produced layer inherits the source's style. Taking that from the
    // pre-await copy would silently use a colour the design no longer has.
    gate.arm();
    const running = shapeOp({ design_path: dPath, shape_op: 'offset', layer_ids: ['sq'], delta: 4 });
    await new Promise(r => setTimeout(r, 0));
    concurrentEdit('sq', '#ABCDEF');
    gate.open();
    await running;

    expect(byId('sq_offset')?.['fill']).toBe('#ABCDEF');
  });
});
