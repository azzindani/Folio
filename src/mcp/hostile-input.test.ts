import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProject, createDesign, addLayers, exportDesign } from './engine';
import { readYAML } from './engine/utils';
import { ensureLayerZ, coerceLayerScalars, normalizeGroupChildren } from './engine-finalize-geom';
import { coerceLayerArray } from './shorthand-coerce';
import type { DesignSpec, Layer } from '../schema/types';

// Pass 26 fed the live wire degenerate input — numbers that are not numbers,
// zero and enormous geometry, values of the wrong type at every position. Most
// of it was already handled (NaN/negative/zero sizes all get a clear error).
// These are what got through.

let dir = '';
let proj = '';
const BG = { id: 'bg', type: 'rect', x: 0, y: 0, width: 1080, height: 1080, fill: '#FAF5EC' };
const rec = (x: unknown): Record<string, unknown> => x as Record<string, unknown>;

function design(name: string): string {
  createDesign({ project_path: proj, name, type: 'poster', width: 1080, height: 1080 } as never);
  return path.join(proj, `designs/${name}.design.yaml`);
}
const layersOf = (p: string): Layer[] => (readYAML<DesignSpec>(p).layers ?? []) as Layer[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-hostile-'));
  proj = path.join(dir, 'p');
  createProject({ name: 'P', path: proj } as never);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('a stray null in the layers array', () => {
  // Live: `null is not an object (evaluating 'o.children')`. stripNullLayers has
  // always existed and its comment says it must run "before any pass reads .id
  // off it" — but it sat THIRD in the ingest chain, so every pass added above it
  // inherited the hazard. The guard now leads the chain it guards.
  it('is dropped, not crashed on', () => {
    const p = design('nulls');
    const r = rec(addLayers({ design_path: p, layers: [BG, null] as never }));
    expect(r['success']).toBe(true);
    expect(r['error']).toBeUndefined();
    expect(layersOf(p).length).toBe(1);
  });

  it('and the alias fold survives one on its own', () => {
    expect(() => normalizeGroupChildren([null, undefined] as never)).not.toThrow();
  });
});

describe('`layers` sent as something that is not an array', () => {
  // `layers` is TYPED Layer[], so nothing checked it, and "nope".length === 4
  // walked past the emptiness guard. The model was answered
  // `layers.filter is not a function. (In 'layers.filter((l) => …)')`.
  it('answers actionably instead of leaking a TypeError', () => {
    const r = rec(addLayers({ design_path: design('str'), layers: 'nope' as never }));
    expect(r['success']).toBe(false);
    expect(String(r['error'])).toMatch(/must be an ARRAY/);
    expect(String(r['error']) + String(r['hint'])).not.toMatch(/is not a function/);
  });

  it('recovers a JSON-encoded array, the way layers_shorthand already does', () => {
    const p = design('strarr');
    const r = rec(addLayers({ design_path: p, layers: JSON.stringify([BG]) as never }));
    expect(r['success']).toBe(true);
    expect(layersOf(p).length).toBe(1);
  });

  it('coerceLayerArray: array through, object wrapped, scalar refused', () => {
    expect(coerceLayerArray(null)).toEqual([]);
    expect(coerceLayerArray([1, 2])).toEqual([1, 2]);
    expect(coerceLayerArray({ id: 'a' })).toEqual([{ id: 'a' }]);
    expect(coerceLayerArray('[{"id":"a"}]')).toEqual([{ id: 'a' }]);
    expect(coerceLayerArray(42)).toBeNull();
    expect(coerceLayerArray(true)).toBeNull();
  });
});

describe('a layer with no z-index', () => {
  // The worst of the six, because nothing about it looks degenerate. Two
  // ordinary verbose layers with no `z`: add_layers succeeded, render_preview
  // DREW it, seal_design sealed it clean and handed over the share link — and
  // export_design refused the whole design with "Layer z-index is required".
  it('exports, instead of being refused after it has been sealed', () => {
    const p = design('noz');
    addLayers({ design_path: p, layers: [BG, {
      id: 'h', type: 'text', x: 80, y: 200, width: 900, height: 200,
      content: { type: 'text', value: 'No z anywhere' }, style: { font_size: 84, color: '#111111' },
    }] as never });
    for (const l of layersOf(p)) expect(typeof (l as unknown as Record<string, unknown>)['z'], String(l.id)).toBe('number');
    expect(rec(exportDesign({ design_path: p, format: 'svg' }))['success']).toBe(true);
  });

  it('assigns 0, not the index — the renderer sorts by (z ?? 0), stably', () => {
    // An index would lift an unzoned layer above an explicit z:5 and silently
    // restack the design.
    const ls = [{ id: 'a', type: 'rect' }, { id: 'b', type: 'rect', z: 5 }, { id: 'c', type: 'rect' }] as never as Layer[];
    expect(ensureLayerZ(ls)).toBe(2);
    expect(ls.map(l => (l as unknown as Record<string, unknown>)['z'])).toEqual([0, 5, 0]);
  });

  it('keeps a numeric string, which already sorted correctly', () => {
    const ls = [{ id: 'a', type: 'rect', z: '3' }] as never as Layer[];
    ensureLayerZ(ls);
    expect((ls[0] as unknown as Record<string, unknown>)['z']).toBe(3);
  });

  it('replaces a z that is not an order at all', () => {
    // `"top" - 0` is NaN, so the comparator returns NaN and the sort is undefined.
    const ls = [{ id: 'a', type: 'rect', z: 'top' }] as never as Layer[];
    ensureLayerZ(ls);
    expect((ls[0] as unknown as Record<string, unknown>)['z']).toBe(0);
  });

  it('reaches layers inside a group', () => {
    const ls = [{ id: 'g', type: 'group', layers: [{ id: 'k', type: 'rect' }] }] as never as Layer[];
    ensureLayerZ(ls);
    const kid = ((ls[0] as unknown as Record<string, unknown>)['layers'] as Array<Record<string, unknown>>)[0];
    expect(kid?.['z']).toBe(0);
  });
});

describe('scalar fields of the wrong type', () => {
  it('a numeric id would be unreachable for ever — store it as a string', () => {
    // Live: written to disk as `id: 99`, then every lookup compares === against
    // a string, so edit_layer answered "Layer not found: 99" about a layer
    // plainly in the file.
    const p = design('numid');
    addLayers({ design_path: p, layers: [BG, {
      id: 77, type: 'text', x: 80, y: 300, width: 900, height: 100,
      content: { type: 'text', value: 'x' }, style: { font_size: 40, color: '#111111' },
    }] as never });
    const t = layersOf(p).find(l => l.type === 'text') as unknown as Record<string, unknown>;
    expect(typeof t?.['id']).toBe('string');
    expect(t?.['id']).toBe('77');
  });

  it('a MISSING id is assigned one — unreachable and unexportable otherwise', () => {
    // "Layer id is required" refuses the whole export. 5 real designs in the
    // library could not be exported at all; a re-seal now repairs 4 of them.
    const ls = [{ type: 'rect' }, { type: 'rect' }, { id: 'rect_1', type: 'text' }] as never as Layer[];
    expect(coerceLayerScalars(ls)).toBe(2);
    const ids = ls.map(l => (l as unknown as Record<string, unknown>)['id']);
    expect(ids[2]).toBe('rect_1');                       // existing id untouched
    expect(new Set(ids).size).toBe(3);                   // and never collided with
    for (const id of ids) expect(typeof id).toBe('string');
  });

  it('assigns ids inside groups too, without colliding across the tree', () => {
    const ls = [{ id: 'g', type: 'group', layers: [{ type: 'rect' }, { type: 'rect' }] }] as never as Layer[];
    coerceLayerScalars(ls);
    const kids = (ls[0] as unknown as Record<string, unknown>)['layers'] as Array<Record<string, unknown>>;
    expect(new Set(kids.map(k => k['id'])).size).toBe(2);
  });

  it('a bare scalar as text content rendered a ⚠ placeholder — keep the text', () => {
    const ls = [{ id: 't', type: 'text', content: 7 }] as never as Layer[];
    expect(coerceLayerScalars(ls)).toBe(1);
    expect((ls[0] as unknown as Record<string, unknown>)['content']).toEqual({ type: 'plain', value: '7' });
  });

  it('leaves a well-formed layer untouched', () => {
    const ls = [{ id: 'a', type: 'text', content: { type: 'plain', value: 'hi' } }] as never as Layer[];
    expect(coerceLayerScalars(ls)).toBe(0);
  });

  it('leaves a bare STRING content alone — the renderer reads that shape', () => {
    const ls = [{ id: 'a', type: 'text', content: 'hi' }] as never as Layer[];
    expect(coerceLayerScalars(ls)).toBe(0);
  });
});

describe('what was already handled — do not regress it', () => {
  const CASES: Array<[string, string, unknown]> = [['NaN', 'wa', 'NaN'], ['negative', 'wb', -500], ['zero', 'wc', 0]];
  for (const [label, name, w] of CASES) {
    it(`a ${label} width is refused with a clear message`, () => {
      const r = rec(addLayers({ design_path: design(name), layers: [
        { id: 'a', type: 'rect', x: 0, y: 0, width: w, height: 10, fill: '#000' },
      ] as never }));
      expect(r['success']).toBe(false);
      expect(String(r['error'])).toMatch(/positive width/);
    });
  }
});
