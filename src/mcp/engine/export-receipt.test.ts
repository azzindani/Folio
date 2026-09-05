import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { exportKey, findReusable, recordExport } from './export-receipt';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-receipt-'));
let designPath = '';
let out = '';
let n = 0;

beforeEach(() => {
  const dir = path.join(root, `case-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  designPath = path.join(dir, 'deck.design.yaml');
  out = path.join(dir, 'deck.pdf');
  fs.writeFileSync(designPath, 'meta: {}\n');
  fs.writeFileSync(out, 'PDFBYTES');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('exportKey', () => {
  it('is stable for identical inputs', () => {
    expect(exportKey('h1', 'pdf', 2, '/a/b.pdf')).toBe(exportKey('h1', 'pdf', 2, '/a/b.pdf'));
  });

  it('moves when ANY of the four inputs moves', () => {
    const base = exportKey('h1', 'pdf', 2, '/a/b.pdf');
    expect(exportKey('h2', 'pdf', 2, '/a/b.pdf')).not.toBe(base);   // design changed
    expect(exportKey('h1', 'png', 2, '/a/b.pdf')).not.toBe(base);   // format
    expect(exportKey('h1', 'pdf', 3, '/a/b.pdf')).not.toBe(base);   // scale
    expect(exportKey('h1', 'pdf', 2, '/a/c.pdf')).not.toBe(base);   // destination
  });

  it('treats a relative and absolute path to the same file as one key', () => {
    const abs = path.resolve('out.pdf');
    expect(exportKey('h', 'pdf', 1, 'out.pdf')).toBe(exportKey('h', 'pdf', 1, abs));
  });
});

describe('findReusable', () => {
  it('is null before anything was recorded', () => {
    expect(findReusable(designPath, 'k')).toBeNull();
  });

  it('returns the receipt once the export is recorded', () => {
    recordExport(designPath, 'k', out, 8);
    expect(findReusable(designPath, 'k')?.output).toBe(path.resolve(out));
  });

  // The point of the size check: a receipt is a claim about a file, and the
  // claim has to still be true.
  it('refuses a receipt whose file has since been deleted', () => {
    recordExport(designPath, 'k', out, 8);
    fs.rmSync(out);
    expect(findReusable(designPath, 'k')).toBeNull();
  });

  it('refuses a receipt whose file is no longer the size recorded', () => {
    recordExport(designPath, 'k', out, 8);
    fs.writeFileSync(out, 'TRUNC');
    expect(findReusable(designPath, 'k')).toBeNull();
  });

  it('refuses when the path now names a directory', () => {
    recordExport(designPath, 'k', out, 8);
    fs.rmSync(out);
    fs.mkdirSync(out);
    expect(findReusable(designPath, 'k')).toBeNull();
  });

  it('survives a corrupt receipt file instead of throwing', () => {
    recordExport(designPath, 'k', out, 8);
    const rp = path.join(path.dirname(designPath), '.mcp_versions', 'deck.exports.json');
    fs.writeFileSync(rp, 'not json');
    expect(findReusable(designPath, 'k')).toBeNull();
  });
});

describe('recordExport', () => {
  it('keeps separate keys side by side', () => {
    const other = path.join(path.dirname(out), 'deck.png');
    fs.writeFileSync(other, 'PNG');
    recordExport(designPath, 'a', out, 8);
    recordExport(designPath, 'b', other, 3);
    expect(findReusable(designPath, 'a')?.bytes).toBe(8);
    expect(findReusable(designPath, 'b')?.bytes).toBe(3);
  });

  it('caps the file so a long-lived project does not grow one forever', () => {
    for (let i = 0; i < 50; i++) recordExport(designPath, `k${i}`, out, 8);
    const rp = path.join(path.dirname(designPath), '.mcp_versions', 'deck.exports.json');
    const parsed = JSON.parse(fs.readFileSync(rp, 'utf8')) as { exports: Record<string, unknown> };
    expect(Object.keys(parsed.exports).length).toBeLessThanOrEqual(40);
    // The most recent survives; the oldest is the one dropped.
    expect(parsed.exports['k49']).toBeDefined();
  });

  it('does not throw when the design directory is unwritable or absent', () => {
    expect(() => recordExport(path.join(root, 'gone', 'x.design.yaml'), 'k', out, 8)).not.toThrow();
  });
});

describe('the unit the size is measured in', () => {
  // The live failure: an 8.8 MB HTML export recorded doc.length (UTF-16 code
  // units) against a file written as UTF-8. Off by 27 bytes, so findReusable's
  // own size check rejected the receipt on every retry and the reuse path never
  // fired once. Recording what is actually on disk is the only version of this
  // that cannot drift.
  it('a receipt written from the real file size matches on the next look', () => {
    const text = path.join(path.dirname(out), 'multibyte.html');
    const body = '<p>café — naïve — 日本語</p>';
    fs.writeFileSync(text, body, 'utf8');
    const onDisk = fs.statSync(text).size;
    expect(onDisk).not.toBe(body.length);          // the trap

    recordExport(designPath, 'k', text, onDisk);
    expect(findReusable(designPath, 'k')).not.toBeNull();

    recordExport(designPath, 'k2', text, body.length);
    expect(findReusable(designPath, 'k2')).toBeNull();
  });
});
