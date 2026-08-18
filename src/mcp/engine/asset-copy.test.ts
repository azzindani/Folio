import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { copyAsset } from './asset-copy';
import { ingestAsset } from './assets';
import { ingestLibraryAsset } from './asset-library';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let root = '';
let a = '';
let b = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-copy-'));
  a = path.join(root, 'alpha');
  b = path.join(root, 'beta');
  for (const dir of [a, b]) {
    fs.mkdirSync(path.join(dir, 'assets', 'images'), { recursive: true });
    // A real project always has this; the manifest is only written when it does.
    fs.writeFileSync(path.join(dir, 'project.yaml'), '_protocol: project/v1\nmeta:\n  name: p\n');
  }
  process.env['FOLIO_LIBRARY_DIR'] = path.join(root, 'lib');
});
afterEach(() => {
  delete process.env['FOLIO_LIBRARY_DIR'];
  fs.rmSync(root, { recursive: true, force: true });
});

describe('copyAsset', () => {
  it('copies inside one project, into a folder', () => {
    ingestAsset({ projectDir: a, name: 'mark.png', data: PNG });
    const res = copyAsset({ assetPath: 'assets/images/mark.png', fromDir: a, toDir: a, folder: 'brand' });
    expect(res).toMatchObject({ success: true, path: 'assets/images/brand/mark.png' });
    // The original stays — that is the whole difference from a move.
    expect(fs.existsSync(path.join(a, 'assets/images/mark.png'))).toBe(true);
    expect(fs.existsSync(path.join(a, 'assets/images/brand/mark.png'))).toBe(true);
  });

  it('copies ACROSS projects — the main reason to copy rather than move', () => {
    ingestAsset({ projectDir: a, name: 'mark.png', data: PNG });
    const res = copyAsset({ assetPath: 'assets/images/mark.png', fromDir: a, toDir: b });
    expect(res).toMatchObject({ success: true, path: 'assets/images/mark.png' });
    expect(fs.existsSync(path.join(b, 'assets/images/mark.png'))).toBe(true);
    expect(fs.existsSync(path.join(a, 'assets/images/mark.png')), 'source lost').toBe(true);
  });

  it('promotes a project asset into the shared library', () => {
    ingestAsset({ projectDir: a, name: 'mark.png', data: PNG });
    const res = copyAsset({ assetPath: 'assets/images/mark.png', fromDir: a, scope: 'library', folder: 'brand/marks' });
    expect(res).toMatchObject({ success: true, path: 'lib/brand/marks/mark.png' });
    expect(fs.existsSync(path.join(root, 'lib', 'brand', 'marks', 'mark.png'))).toBe(true);
  });

  it('pulls a library asset down into a project', () => {
    ingestLibraryAsset({ name: 'logo.png', data: PNG, folder: 'microsoft' });
    const res = copyAsset({ assetPath: 'lib/microsoft/logo.png', toDir: b, folder: 'vendor' });
    expect(res).toMatchObject({ success: true, path: 'assets/images/vendor/logo.png' });
    expect(fs.existsSync(path.join(b, 'assets/images/vendor/logo.png'))).toBe(true);
  });

  it('re-measures the copy rather than trusting the source manifest', () => {
    ingestAsset({ projectDir: a, name: 'mark.png', data: PNG });
    copyAsset({ assetPath: 'assets/images/mark.png', fromDir: a, toDir: b });
    // The bytes go back through the normal ingest, so the destination knows the
    // dimensions without anyone copying metadata across.
    const yaml = fs.readFileSync(path.join(b, 'project.yaml'), 'utf8');
    expect(yaml).toContain('mark.png');
    expect(yaml).toMatch(/width:\s*1/);
  });

  it('refuses a source that does not exist, and one that tries to climb out', () => {
    expect(copyAsset({ assetPath: 'assets/images/ghost.png', fromDir: a, toDir: b }).success).toBe(false);
    const escape = copyAsset({ assetPath: 'assets/images/../../../etc/passwd', fromDir: a, toDir: b });
    expect(escape.success).toBe(false);
    expect(escape.error).toContain('No such asset');
  });

  it('needs a destination project when the scope is not the library', () => {
    ingestAsset({ projectDir: a, name: 'mark.png', data: PNG });
    expect(copyAsset({ assetPath: 'assets/images/mark.png', fromDir: a }).error).toContain('No destination');
  });
});
