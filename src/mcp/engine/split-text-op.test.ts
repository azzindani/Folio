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
  it('makes one layer per VISIBLE character, in reading order', () => {
    const r = splitText({ design_path: dPath, layer_id: 'head' }) as Record<string, unknown>;
    expect(r['success']).toBe(true);
    // 7, not 8: the space in "Hi there" gets no layer of its own. A blank text
    // layer draws nothing yet still takes a slot in the staggered reveal these
    // pieces exist for. The gap survives as POSITION — see the x assertions.
    expect(r['count']).toBe(7);
    const made = layers().filter(l => String(l['id']).startsWith('head_c'));
    expect(made.map(l => (l['content'] as { value: string }).value).join('')).toBe('Hithere');
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

describe('split_text on a carousel — the ambiguity `update` already refuses', () => {
  /** A deck whose pages share the layer id, the way preset groups do. */
  function deck(): string {
    const dir = path.join(root, `deck-${n++}`, 'designs');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'deck.design.yaml');
    const page = (id: string): Record<string, unknown> => ({ id, layers: [text()] });
    fs.writeFileSync(p, yaml.dump({
      meta: { id: 'k', name: 'K', type: 'carousel' },
      document: { width: 800, height: 400 },
      pages: [page('page_1'), page('page_2'), page('page_3')],
    }));
    return p;
  }

  it('refuses to guess a page when the id is on several, and names them', () => {
    // Silently taking the FIRST page meant splitting a headline across a 7-page
    // deck did one page and reported success — found on a live carousel.
    const p = deck();
    const r = splitText({ design_path: p, layer_id: 'head' });
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('3 pages');
    expect(String(r.error)).toContain('page_2');
    expect(String(r.hint)).toContain('page_id');
  });

  it('splits exactly the page it was given, leaving the others alone', () => {
    const p = deck();
    const r = splitText({ design_path: p, layer_id: 'head', page_id: 'page_2', by: 'word' });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const spec = yaml.load(fs.readFileSync(p, 'utf8')) as DesignSpec & { pages: { id: string; layers: Layer[] }[] };
    const ids = (pg: string): string[] =>
      (spec.pages.find(x => x.id === pg)?.layers ?? []).map(l => String((l as { id?: unknown }).id));
    expect(ids('page_1')).toEqual(['head']);
    expect(ids('page_3')).toEqual(['head']);
    expect(ids('page_2')).toContain('head_w1');
    expect(ids('page_2')).not.toContain('head');
  });
});

describe('splitting the same layer twice', () => {
  it('does not mint a second layer with an id already in use', () => {
    // keep_source leaves the source in place, so a second split is reachable —
    // and reusing head_c1 meant a later `remove head_c1` deleted two layers.
    splitText({ design_path: dPath, layer_id: 'head', keep_source: true });
    splitText({ design_path: dPath, layer_id: 'head', keep_source: true });
    const ids = layers().map(l => String(l['id']));
    expect(new Set(ids).size, ids.join(',')).toBe(ids.length);
    expect(ids).toContain('head_c1');
    expect(ids).toContain('head_c1_2');
  });
});

describe('a char split is a reveal, so it emits no blank layers', () => {
  it('skips spaces but keeps every glyph where it was measured', () => {
    // 9 spaces in a sentence became 9 empty text layers — each one a stagger
    // slot that revealed nothing. Found by splitting a full sentence live.
    const ls = layers();
    const head = ls.find(l => l['id'] === 'head') as Record<string, unknown>;
    head['content'] = { type: 'plain', value: 'ab cd' };
    write(ls);
    const r = splitText({ design_path: dPath, layer_id: 'head' }) as Record<string, unknown>;
    expect(r['success']).toBe(true);
    expect(r['count']).toBe(4);
    const made = layers().filter(l => String(l['id']).startsWith('head_c'));
    expect(made.map(l => (l['content'] as { value?: string }).value)).toEqual(['a', 'b', 'c', 'd']);
    // 'c' must still sit where the space put it, not shifted left onto 'b'.
    const xs = made.map(l => l['x'] as number);
    expect(xs[2]).toBeGreaterThan(xs[1] as number);
    expect((xs[2] as number) - (xs[1] as number)).toBeGreaterThan((xs[1] as number) - (xs[0] as number));
  });
});
