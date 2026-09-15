// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import type { Layer } from '../../schema/types';
import { metricsForFamily } from '../../utils/font-metrics';
import { splitLayer, type SplitBy } from './text-split';
import { remeasureRun } from './text-remeasure';
import { dispatchAnimation } from '../dispatch';

const BUNDLE = [path.resolve('src/mcp/fonts')];
const STYLE = { font_family: 'Archivo', font_size: 120, font_weight: 800, letter_spacing: -2 };
const headline = (value: string): Layer => ({ id: 'head', type: 'text', x: 80, y: 120, width: 1500, content: { type: 'plain', value }, style: STYLE } as unknown as Layer);

type Piece = { piece: Record<string, unknown>; mask: Record<string, unknown> | null; n: number; by: 'w' | 'c' };

/** Pieces as op:text made them before the fix: placed by SemiBold advances, each in its mask. */
function oldSplit(value: string, by: SplitBy): Piece[] {
  const { units } = splitLayer(headline(value), by, metricsForFamily('Archivo', BUNDLE, 600));
  const pad = Math.round(120 * 0.15);
  return units.map((u, i) => {
    const piece = { id: `head_${by[0]}${i + 1}`, type: 'text', x: u.x, y: u.y, width: u.width, content: { type: 'plain', value: u.text }, style: STYLE };
    return { piece, mask: { id: `head_mask${i + 1}`, x: u.x - pad, width: u.width + pad * 2 }, n: i + 1, by: by[0] as 'w' | 'c' };
  });
}

const trueSplit = (value: string, by: SplitBy): Array<{ x: number; width: number }> =>
  splitLayer(headline(value), by, metricsForFamily('Archivo', BUNDLE, 800)).units.map(u => ({ x: u.x, width: u.width }));
const lookup = (): ReturnType<typeof metricsForFamily> => metricsForFamily('Archivo', BUNDLE, 800);

describe('remeasureRun', () => {
  // Found live: the promo's split "Words in." exported as "Wordsin." once fonts drew true ExtraBold.
  it('moves word pieces placed by the old widths to where a split at the true weight puts them, masks included', () => {
    const run = oldSplit('Words in. Design out.', 'word');
    expect(run.map(u => u.piece['x'])).not.toEqual(trueSplit('Words in. Design out.', 'word').map(u => u.x));
    remeasureRun(run, lookup);
    expect(run.map(u => ({ x: u.piece['x'], width: u.piece['width'] }))).toEqual(trueSplit('Words in. Design out.', 'word'));
    for (const u of run) expect([u.mask?.['x'], u.mask?.['width']]).toEqual([Number(u.piece['x']) - 18, Number(u.piece['width']) + 36]);
  });

  it('finds the spaces a character split dropped from how far apart its pieces sat', () => {
    const run = oldSplit('Hi yo, go', 'char');
    remeasureRun(run, lookup);
    expect(run.map(u => u.piece['x'])).toEqual(trueSplit('Hi yo, go', 'char').map(u => u.x));
  });
});

describe('animation(op:text, remeasure:true)', () => {
  let design = '';
  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-remeasure-'));
    fs.mkdirSync(path.join(root, 'designs'));
    design = path.join(root, 'designs/d.design.yaml');
    const run = oldSplit('Words in.', 'word');
    fs.writeFileSync(design, yaml.dump({
      meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1600, height: 420 },
      layers: run.map(u => ({ ...u.mask, type: 'group', z: 1, clip: true, y: 120, height: 160, layers: [{ ...u.piece, z: 1 }] })),
    }));
  });
  afterEach(() => { fs.rmSync(path.dirname(path.dirname(design)), { recursive: true, force: true }); });

  it('re-places every split in the design and writes it, without a layer_id', async () => {
    const r = await dispatchAnimation({ op: 'text', design_path: design, remeasure: true });
    expect(r, JSON.stringify(r)).toMatchObject({ success: true });
    expect(String((r['remeasured'] as string[])[0])).toMatch(/^head \(2 words\)/);
    const saved = yaml.load(fs.readFileSync(design, 'utf8')) as { layers: Array<{ layers: Array<{ x: number }> }> };
    expect(saved.layers.map(g => g.layers[0]?.x)).toEqual(trueSplit('Words in.', 'word').map(u => u.x));
  });

  it('says so when there is nothing split', async () => {
    expect(await dispatchAnimation({ op: 'text', design_path: design, layer_id: 'nope', remeasure: true })).toMatchObject({ success: false });
  });

  it('never moves a layer that only looks like a split piece — unmasked and unmarked — unless it is named', async () => {
    const cells = [{ id: 'row_c1', type: 'text', z: 1, x: 100, y: 40, width: 200, content: { type: 'plain', value: 'Revenue' }, style: STYLE },
      { id: 'row_c2', type: 'text', z: 1, x: 900, y: 40, width: 200, content: { type: 'plain', value: '2024' }, style: STYLE }];
    const table = path.join(path.dirname(design), 'table.design.yaml');
    fs.writeFileSync(table, yaml.dump({ meta: { id: 't', name: 'T', type: 'poster' }, document: { width: 1600, height: 420 }, layers: cells }));
    expect(await dispatchAnimation({ op: 'text', design_path: table, remeasure: true })).toMatchObject({ success: false });
    expect((yaml.load(fs.readFileSync(table, 'utf8')) as { layers: Array<{ x: number }> }).layers.map(l => l.x)).toEqual([100, 900]);
    const marked = cells.map(c => ({ ...c, split_of: 'row' }));
    fs.writeFileSync(table, yaml.dump({ meta: { id: 't', name: 'T', type: 'poster' }, document: { width: 1600, height: 420 }, layers: marked }));
    expect(await dispatchAnimation({ op: 'text', design_path: table, remeasure: true })).toMatchObject({ success: true });
  });
});
