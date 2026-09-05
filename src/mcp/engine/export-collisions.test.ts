import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { willOverwrite, stalePageSiblings, collisionReport } from './export-collisions';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-collide-'));
let dir = '';
let n = 0;

beforeEach(() => {
  dir = path.join(root, `case-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const touch = (name: string): void => fs.writeFileSync(path.join(dir, name), 'x');

describe('willOverwrite', () => {
  it('is true only for a file that is already there', () => {
    touch('out.svg');
    expect(willOverwrite(path.join(dir, 'out.svg'))).toBe(true);
    expect(willOverwrite(path.join(dir, 'nope.svg'))).toBe(false);
  });

  it('is false for a directory, which is not something an export replaces', () => {
    fs.mkdirSync(path.join(dir, 'out.svg'));
    expect(willOverwrite(path.join(dir, 'out.svg'))).toBe(false);
  });
});

describe('stalePageSiblings', () => {
  // The live repro: a 7-page deck exported to /tmp/e2/out.svg, then a 1-page
  // poster exported to the same path. Pages 1-7 stay on disk and a directory
  // listing reads all 8 files as one export.
  it('finds every page left by a longer earlier export', () => {
    for (let i = 1; i <= 7; i++) touch(`out-p${i}.svg`);
    touch('out.svg');
    const stale = stalePageSiblings(path.join(dir, 'out.svg'), 0);
    expect(stale).toHaveLength(7);
    expect(stale.map(p => path.basename(p))).toEqual([
      'out-p1.svg', 'out-p2.svg', 'out-p3.svg', 'out-p4.svg', 'out-p5.svg', 'out-p6.svg', 'out-p7.svg',
    ]);
  });

  it('keeps the pages this export is rewriting and reports only the overhang', () => {
    for (let i = 1; i <= 7; i++) touch(`out-p${i}.svg`);
    const stale = stalePageSiblings(path.join(dir, 'out.svg'), 3).map(p => path.basename(p));
    expect(stale).toEqual(['out-p4.svg', 'out-p5.svg', 'out-p6.svg', 'out-p7.svg']);
  });

  it('sorts by page number, not by the string — p10 comes after p9', () => {
    for (const i of [2, 10, 9]) touch(`out-p${i}.svg`);
    const stale = stalePageSiblings(path.join(dir, 'out.svg'), 1).map(p => path.basename(p));
    expect(stale).toEqual(['out-p2.svg', 'out-p9.svg', 'out-p10.svg']);
  });

  it('does not claim a neighbour that merely shares a prefix or an extension', () => {
    touch('out-p1.svg');
    touch('outside-p1.svg');     // different stem
    touch('out-p1.png');         // different format
    touch('out-page1.svg');      // not the -pN shape
    touch('out-px.svg');         // not a number
    const stale = stalePageSiblings(path.join(dir, 'out.svg'), 0).map(p => path.basename(p));
    expect(stale).toEqual(['out-p1.svg']);
  });

  it('treats a stem with regex characters as a literal name', () => {
    touch('a+b(1)-p1.svg');
    touch('axb(1)-p1.svg');
    const stale = stalePageSiblings(path.join(dir, 'a+b(1).svg'), 0).map(p => path.basename(p));
    expect(stale).toEqual(['a+b(1)-p1.svg']);
  });

  it('is empty, never an error, when the directory does not exist', () => {
    expect(stalePageSiblings(path.join(dir, 'gone', 'out.svg'), 0)).toEqual([]);
  });
});

describe('collisionReport', () => {
  it('says nothing at all for a clean first export', () => {
    expect(collisionReport(path.join(dir, 'out.svg'), 0, false)).toEqual({});
  });

  it('reports the overwrite and the orphans together, each on its own key', () => {
    touch('out-p1.svg');
    const r = collisionReport(path.join(dir, 'out.svg'), 0, true);
    expect(r.overwrote).toBe(true);
    expect(r.stale_siblings).toHaveLength(1);
    // The note has to say these are NOT part of this export — that is the whole
    // point of reporting them.
    expect(r.stale_note).toContain('EARLIER export');
  });

  it('omits stale_note when there is nothing stale, so the reply stays quiet', () => {
    const r = collisionReport(path.join(dir, 'out.svg'), 0, true);
    expect(r).toEqual({ overwrote: true });
  });
});
