import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { splitText } from './split-text-op';
import type { DesignSpec, Layer } from '../../schema/types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-split-'));
let dPath = '';
let n = 0;

const text = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'head', type: 'text', x: 100, y: 50, width: 600,
  content: { type: 'plain', value: 'Hi there' },
  style: { font_size: 40, font_family: 'Plus Jakarta Sans' },
  ...extra,
});

beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({
    meta: { id: 'd', name: 'D', type: 'poster' },
    document: { width: 800, height: 400 },
    layers: [text(), { id: 'box', type: 'rect', x: 0, y: 0, width: 10, height: 10 }],
  }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const layers = (): Record<string, unknown>[] =>
  ((yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec).layers as Layer[])
    .map(l => l as unknown as Record<string, unknown>);
const write = (ls: Record<string, unknown>[]): void => {
  const s = yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec;
  (s as unknown as Record<string, unknown>)['layers'] = ls;
  fs.writeFileSync(dPath, yaml.dump(s));
};

describe('edit_layer op:split_text', () => {
  it('makes one layer per character, in reading order', () => {
    const r = splitText({ design_path: dPath, layer_id: 'head' }) as Record<string, unknown>;
    expect(r['success']).toBe(true);
    expect(r['count']).toBe(8);                       // "Hi there"
    const made = layers().filter(l => String(l['id']).startsWith('head_c'));
    expect(made.map(l => (l['content'] as { value: string }).value).join('')).toBe('Hi there');
    // Monotonically increasing x — the run reads left to right.
    const xs = made.map(l => l['x'] as number);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('uses REAL font metrics for a bundled family, not an average', () => {
    const r = splitText({ design_path: dPath, layer_id: 'head' }) as Record<string, unknown>;
    expect(r['measured']).toBe('font metrics');
    expect(r['measurement_warning']).toBeUndefined();
    // "H" is wider than "i" — the whole point of reading the font.
    const made = layers().filter(l => String(l['id']).startsWith('head_c'));
    expect((made[0]?.['width'] as number)).toBeGreaterThan(made[1]?.['width'] as number);
  });

  it('says so when it had to estimate, because drift and a missing font look alike', () => {
    write([text({ style: { font_size: 40, font_family: 'No Such Family' } })]);
    const r = splitText({ design_path: dPath, layer_id: 'head' }) as Record<string, unknown>;
    expect(r['measured']).toBe('estimate');
    expect(String(r['measurement_warning'])).toContain('drift');
  });

  it('splits by word when asked, keeping the words intact', () => {
    const r = splitText({ design_path: dPath, layer_id: 'head', by: 'word' }) as Record<string, unknown>;
    expect(r['count']).toBe(2);
    const made = layers().filter(l => String(l['id']).startsWith('head_w'));
    expect(made.map(l => (l['content'] as { value: string }).value)).toEqual(['Hi', 'there']);
  });

  it('consumes the source by default and can hide it instead', () => {
    splitText({ design_path: dPath, layer_id: 'head' });
    expect(layers().find(l => l['id'] === 'head')).toBeUndefined();

    write([text()]);
    splitText({ design_path: dPath, layer_id: 'head', keep_source: true });
    expect(layers().find(l => l['id'] === 'head')?.['visible']).toBe(false);
  });

  it('shifts a centred run so the pieces land where the text was drawn', () => {
    write([text({ style: { font_size: 40, font_family: 'Plus Jakarta Sans', align: 'center' } })]);
    splitText({ design_path: dPath, layer_id: 'head' });
    const first = layers().filter(l => String(l['id']).startsWith('head_c'))[0];
    // Centre-shifted, so it starts well past the box's left edge.
    expect(first?.['x'] as number).toBeGreaterThan(150);
  });

  it('refuses a non-text layer, empty text and multi-line text, each with its reason', () => {
    expect(splitText({ design_path: dPath, layer_id: 'box' }).success).toBe(false);

    write([text({ content: { type: 'plain', value: '   ' } })]);
    expect(splitText({ design_path: dPath, layer_id: 'head' }).success).toBe(false);

    write([text({ content: { type: 'plain', value: 'two\nlines' } })]);
    const r = splitText({ design_path: dPath, layer_id: 'head' });
    expect(r.success).toBe(false);
    expect(String(r.hint)).toContain('own text layer');
  });
});
