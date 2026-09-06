import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readYAML } from './utils';

// A layer authored with `pos: [x,y,w,h]` was persisted with the shorthand
// intact, and every MUTATION reads x/y/width/height. Found live, by moving a
// layer and looking at the picture:
//
//   edit_layer {op:"update", layer_id:"card", props:{y:800}}
//     -> pos: [80,540,400,220] gains a SIBLING y: 800
//     -> inspect reports y=800 (and w:0, h:0)
//     -> the renderer draws it at y=540, where it always was
//     -> both the tool and the inspector report success
//
// and resize scaled the same layer's font, stroke and radius by 2 while leaving
// its box at the old coordinates on a canvas that had doubled — a background
// covering the top-left quarter of the page.

type Rec = Record<string, unknown>;
const write = (fp: string, body: string): void => fs.writeFileSync(fp, body);

describe('pos shorthand is folded on read', () => {
  let tmp: string;
  let fp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-pos-')); fp = path.join(tmp, 'd.design.yaml'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const layersOf = (): Rec[] => (readYAML<{ layers: Rec[] }>(fp)).layers;

  it('expands pos into x/y/width/height and drops the shorthand', () => {
    write(fp, `_protocol: design/v1\nlayers:\n  - id: card\n    type: rect\n    pos:\n      - 80\n      - 540\n      - 400\n      - 220\n`);
    const [l] = layersOf();
    expect(l).toMatchObject({ x: 80, y: 540, width: 400, height: 220 });
    expect(l?.['pos']).toBeUndefined();
  });

  it('lets an edit written beside the shorthand win', () => {
    // The exact corrupted shape an update produced before the fix.
    write(fp, `_protocol: design/v1\nlayers:\n  - id: card\n    type: rect\n    pos:\n      - 80\n      - 540\n      - 400\n      - 220\n    'y': 800\n`);
    const [l] = layersOf();
    expect(l?.['y']).toBe(800);              // the edit takes effect
    expect(l).toMatchObject({ x: 80, width: 400, height: 220 });  // pos fills the rest
  });

  it('keeps a zero dimension rather than inventing one', () => {
    // A horizontal rule is genuinely h=0; rounding it up to 1 would be a lie.
    write(fp, `_protocol: design/v1\nlayers:\n  - id: rule\n    type: line\n    pos:\n      - 80\n      - 480\n      - 700\n      - 0\n`);
    expect(layersOf()[0]).toMatchObject({ x: 80, y: 480, width: 700, height: 0 });
  });

  it('folds nested children too', () => {
    write(fp, `_protocol: design/v1\nlayers:\n  - id: g\n    type: group\n    x: 0\n    'y': 0\n    width: 100\n    height: 100\n    layers:\n      - id: kid\n        type: rect\n        pos:\n          - 10\n          - 20\n          - 30\n          - 40\n`);
    const kid = (layersOf()[0]?.['layers'] as Rec[])[0];
    expect(kid).toMatchObject({ x: 10, y: 20, width: 30, height: 40 });
    expect(kid?.['pos']).toBeUndefined();
  });

  it('folds layers on every page of a carousel', () => {
    write(fp, `_protocol: design/v1\npages:\n  - id: p1\n    layers:\n      - id: a\n        type: rect\n        pos:\n          - 1\n          - 2\n          - 3\n          - 4\n  - id: p2\n    layers:\n      - id: b\n        type: rect\n        pos:\n          - 5\n          - 6\n          - 7\n          - 8\n`);
    const pages = (readYAML<{ pages: { layers: Rec[] }[] }>(fp)).pages;
    expect(pages[0]?.layers[0]).toMatchObject({ x: 1, y: 2, width: 3, height: 4 });
    expect(pages[1]?.layers[0]).toMatchObject({ x: 5, y: 6, width: 7, height: 8 });
  });

  it('leaves a pos that is not a 4-number box alone', () => {
    // Only a real [x,y,w,h] box is shorthand; anything else is someone else's field.
    write(fp, `_protocol: design/v1\nlayers:\n  - id: a\n    type: rect\n    pos:\n      - 1\n      - 2\n  - id: b\n    type: rect\n    pos: middle\n`);
    const [a, b] = layersOf();
    expect(a?.['pos']).toEqual([1, 2]);
    expect(b?.['pos']).toBe('middle');
  });

  it('does not touch a preset spec’s own pos', () => {
    // _spec.pos describes the box the preset was AUTHORED at and is read back by
    // patch_spec; it is not the layer's geometry and must survive untouched.
    write(fp, `_protocol: design/v1\nlayers:\n  - id: s\n    type: group\n    x: 0\n    'y': 0\n    width: 10\n    height: 10\n    _spec:\n      type: stat\n      pos:\n        - 200\n        - 200\n        - 800\n        - 800\n`);
    const spec = layersOf()[0]?.['_spec'] as Rec;
    expect(spec['pos']).toEqual([200, 200, 800, 800]);
  });

  it('does not touch a gradient stop’s pos', () => {
    write(fp, `_protocol: design/v1\nlayers:\n  - id: a\n    type: rect\n    x: 0\n    'y': 0\n    width: 10\n    height: 10\n    fill:\n      type: linear\n      stops:\n        - color: '#fff'\n          pos: 0\n        - color: '#000'\n          pos: 1\n`);
    const stops = ((layersOf()[0]?.['fill'] as Rec)['stops']) as Rec[];
    expect(stops.map(s => s['pos'])).toEqual([0, 1]);
  });
});
