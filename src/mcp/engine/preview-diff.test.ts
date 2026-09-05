import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { baselinePath, hashSVG, readBaseline, writeBaseline, diffPages } from './preview-diff';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-pdiff-'));
let designPath = '';
let n = 0;

beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  designPath = path.join(dir, 'deck.design.yaml');
  fs.writeFileSync(designPath, 'meta: {}\n');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const page = (id: string, svg: string): { id: string; svg: string } => ({ id, svg });

describe('baselinePath', () => {
  it('files the baseline beside the other tool state, never inside the design', () => {
    const p = baselinePath(designPath);
    expect(path.basename(p)).toBe('deck.preview.json');
    expect(path.basename(path.dirname(p))).toBe('.mcp_versions');
    expect(p.startsWith(path.dirname(designPath))).toBe(true);
  });
});

describe('hashSVG', () => {
  it('is stable for identical output and moves for any difference', () => {
    expect(hashSVG('<svg>a</svg>')).toBe(hashSVG('<svg>a</svg>'));
    expect(hashSVG('<svg>a</svg>')).not.toBe(hashSVG('<svg>b</svg>'));
  });
});

describe('readBaseline', () => {
  it('reads back what was written', () => {
    writeBaseline(designPath, { p1: 'abc' });
    expect(readBaseline(designPath).pages).toEqual({ p1: 'abc' });
  });

  it('treats a missing file as "never looked" rather than an error', () => {
    expect(readBaseline(designPath)).toEqual({ version: 1, pages: {} });
  });

  it('treats a corrupt or hand-edited file as fresh instead of throwing', () => {
    const p = baselinePath(designPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'not json at all');
    expect(readBaseline(designPath).pages).toEqual({});
  });

  it('rejects a file from a future version rather than trusting its shape', () => {
    const p = baselinePath(designPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ version: 2, pages: { p1: 'x' } }));
    expect(readBaseline(designPath).pages).toEqual({});
  });
});

describe('diffPages', () => {
  it('calls everything a FIRST LOOK when there is no baseline, not a change', () => {
    const { diffs } = diffPages({ version: 1, pages: {} }, [page('p1', '<a/>'), page('p2', '<b/>')]);
    expect(diffs.every(d => d.first_look)).toBe(true);
    expect(diffs.some(d => d.changed)).toBe(false);
  });

  it('reports only the page that actually moved — the whole point of the mode', () => {
    const first = diffPages({ version: 1, pages: {} }, [page('p1', '<a/>'), page('p2', '<b/>'), page('p3', '<c/>')]);
    // p2 edited, the others untouched.
    const second = diffPages({ version: 1, pages: first.next }, [page('p1', '<a/>'), page('p2', '<B EDITED/>'), page('p3', '<c/>')]);
    expect(second.diffs.filter(d => d.changed).map(d => d.id)).toEqual(['p2']);
    expect(second.diffs.filter(d => !d.changed && !d.first_look).map(d => d.id)).toEqual(['p1', 'p3']);
  });

  it('says nothing changed when a re-render is byte-identical', () => {
    const first = diffPages({ version: 1, pages: {} }, [page('p1', '<a/>')]);
    const second = diffPages({ version: 1, pages: first.next }, [page('p1', '<a/>')]);
    expect(second.diffs[0]?.changed).toBe(false);
    expect(second.diffs[0]?.first_look).toBe(false);
  });

  it('treats a newly appended page as a first look while the rest stay quiet', () => {
    const first = diffPages({ version: 1, pages: {} }, [page('p1', '<a/>')]);
    const second = diffPages({ version: 1, pages: first.next }, [page('p1', '<a/>'), page('p2', '<new/>')]);
    expect(second.diffs.find(d => d.id === 'p2')?.first_look).toBe(true);
    expect(second.diffs.find(d => d.id === 'p1')?.changed).toBe(false);
  });

  it('carries the index so the caller can rasterise the right page', () => {
    const { diffs } = diffPages({ version: 1, pages: {} }, [page('a', '<1/>'), page('b', '<2/>')]);
    expect(diffs.map(d => d.index)).toEqual([0, 1]);
  });

  it('returns the next baseline covering every page, including unchanged ones', () => {
    const { next } = diffPages({ version: 1, pages: { p1: 'stale' } }, [page('p1', '<a/>'), page('p2', '<b/>')]);
    expect(Object.keys(next).sort()).toEqual(['p1', 'p2']);
    expect(next['p1']).toBe(hashSVG('<a/>'));
  });
});
