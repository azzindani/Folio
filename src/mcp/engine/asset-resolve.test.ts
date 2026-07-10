import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveImageAssets, assetBaseDirs } from './asset-resolve';
import type { DesignSpec, Layer } from '../../schema/types';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

function makeSpec(layers: Layer[], pages?: { id: string; layers: Layer[] }[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'x', name: 'x', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
    document: { width: 100, height: 100, unit: 'px', dpi: 96 },
    layers, ...(pages ? { pages } : {}),
  } as unknown as DesignSpec;
}
const img = (id: string, src: string): Layer => ({ id, type: 'image', x: 0, y: 0, width: 10, height: 10, src } as unknown as Layer);

describe('resolveImageAssets', () => {
  let tmp: string, proj: string, dPath: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-resolve-'));
    proj = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(proj, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'assets/images'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'assets/images/dot.png'), Buffer.from(PNG_B64, 'base64'));
    dPath = path.join(proj, 'designs/d.design.yaml');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('embeds an existing assets/ file as a data: URI (no note)', () => {
    const spec = makeSpec([img('a', 'assets/images/dot.png')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect(notes).toEqual([]);
    expect((spec.layers![0] as Layer & { src: string }).src).toMatch(/^data:image\/png;base64,/);
  });

  it('blanks a missing file and says how to fix it', () => {
    const spec = makeSpec([img('a', 'assets/images/nope.jpg')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect((spec.layers![0] as Layer & { src: string }).src).toBe('');
    expect(notes[0]).toMatch(/not found/);
    expect(notes[0]).toMatch(/asset_add/);
  });

  it('blanks an https URL with the editor-only warning', () => {
    const spec = makeSpec([img('a', 'https://example.com/x.png')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect((spec.layers![0] as Layer & { src: string }).src).toBe('');
    expect(notes[0]).toMatch(/EDITOR only/);
  });

  it('blanks an undecodable data: URI', () => {
    const spec = makeSpec([img('a', 'data:image/png;base64,not-a-png')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect((spec.layers![0] as Layer & { src: string }).src).toBe('');
    expect(notes[0]).toMatch(/not a decodable image/);
  });

  it('keeps a valid data: URI untouched', () => {
    const uri = `data:image/png;base64,${PNG_B64}`;
    const spec = makeSpec([img('a', uri)]);
    expect(resolveImageAssets(spec, dPath, proj)).toEqual([]);
    expect((spec.layers![0] as Layer & { src: string }).src).toBe(uri);
  });

  it('resolves image FILLS: embeds found files, degrades missing ones to a neutral solid', () => {
    const ok = { id: 'r1', type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: { type: 'image', src: 'assets/images/dot.png' } } as unknown as Layer;
    const missing = { id: 'r2', type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: { type: 'image', src: 'assets/images/nope.png' } } as unknown as Layer;
    const spec = makeSpec([ok, missing]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect((spec.layers![0] as Layer & { fill: { src: string } }).fill.src).toMatch(/^data:/);
    expect((spec.layers![1] as Layer & { fill: { type: string } }).fill.type).toBe('solid');
    expect(notes[0]).toMatch(/image fill on "r2"/);
  });

  it('recurses groups and carousel pages', () => {
    const grp = { id: 'g', type: 'group', x: 0, y: 0, width: 10, height: 10, layers: [img('inner', 'https://x.com/a.png')] } as unknown as Layer;
    const spec = makeSpec([grp], [{ id: 'p2', layers: [img('pg', 'assets/images/dot.png')] }]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect(notes).toHaveLength(1);
    const pageImg = (spec.pages![0].layers![0]) as Layer & { src: string };
    expect(pageImg.src).toMatch(/^data:/);
  });

  it('sniffs content over a lying extension (PNG bytes named .jpg)', () => {
    fs.writeFileSync(path.join(proj, 'assets/images/liar.jpg'), Buffer.from(PNG_B64, 'base64'));
    const spec = makeSpec([img('a', 'assets/images/liar.jpg')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect(notes).toEqual([]);
    expect((spec.layers![0] as Layer & { src: string }).src).toMatch(/^data:image\/png;base64,/);
  });

  it('keeps the historical base-dir search order', () => {
    // path.join uses the platform separator — normalize so the assertion
    // holds on Windows runners too ('\\p\\assets').
    const dirs = assetBaseDirs('/p/designs/d.design.yaml', '/p').map(d => d.replace(/\\/g, '/'));
    expect(dirs).toEqual(['/p/designs', '/p', '/p', '/p/assets']);
  });
});
