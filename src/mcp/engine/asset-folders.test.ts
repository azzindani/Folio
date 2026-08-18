import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { projectFolders, createAssetFolder, removeAssetFolder } from './asset-folders';

let root = '';
let proj = '';
let lib = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-folders-'));
  proj = path.join(root, 'demo');
  lib = path.join(root, 'library');
  fs.mkdirSync(path.join(proj, 'assets', 'images'), { recursive: true });
  process.env['FOLIO_LIBRARY_DIR'] = lib;
});
afterEach(() => {
  delete process.env['FOLIO_LIBRARY_DIR'];
  fs.rmSync(root, { recursive: true, force: true });
});

describe('projectFolders', () => {
  it('reports a folder that holds nothing', () => {
    fs.mkdirSync(path.join(proj, 'assets', 'images', 'screenshots'));
    // The whole point: collectAssets derives folders from files, so an empty
    // one is invisible to it — and a folder you just made is empty.
    expect(projectFolders(proj)).toEqual(['screenshots']);
  });

  it('merges the same folder name across kinds into one entry', () => {
    fs.mkdirSync(path.join(proj, 'assets', 'images', 'brand'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'assets', 'fonts', 'brand'), { recursive: true });
    expect(projectFolders(proj)).toEqual(['brand']);
  });

  it('skips bookkeeping dot-dirs and names that would not survive sanitising', () => {
    fs.mkdirSync(path.join(proj, 'assets', 'images', '.trash'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'assets', 'images', 'Not Clean'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'assets', 'images', 'ok'), { recursive: true });
    // "Not Clean" sanitises to "not-clean", so the directory is unreachable by
    // the paths the store generates — listing it would offer a dead folder.
    expect(projectFolders(proj)).toEqual(['ok']);
  });

  it('is empty, not thrown, for a project with no assets dir', () => {
    expect(projectFolders(path.join(root, 'nope'))).toEqual([]);
  });
});

describe('createAssetFolder', () => {
  it('creates the folder under every kind so any file type can be filed there', () => {
    const res = createAssetFolder({ projectDir: proj, folder: 'Screenshots' });
    expect(res).toMatchObject({ success: true, folder: 'screenshots' });
    for (const kind of ['images', 'icons', 'fonts', 'docs']) {
      expect(fs.existsSync(path.join(proj, 'assets', kind, 'screenshots'))).toBe(true);
    }
    expect(projectFolders(proj)).toEqual(['screenshots']);
  });

  it('nests in the library, where the store allows depth', () => {
    const res = createAssetFolder({ folder: 'microsoft/logos', scope: 'library' });
    expect(res).toMatchObject({ success: true, folder: 'microsoft/logos' });
    expect(fs.existsSync(path.join(lib, 'microsoft', 'logos'))).toBe(true);
  });

  it('refuses a name that sanitises away, and says what is allowed', () => {
    const res = createAssetFolder({ projectDir: proj, folder: '../../etc' });
    expect(res.success).toBe(false);
    expect(res.hint).toContain('one level deep');
    // The traversal must not have created anything on the way to failing.
    expect(fs.existsSync(path.join(root, 'etc'))).toBe(false);
  });

  it('is idempotent — making a folder that exists is not an error', () => {
    createAssetFolder({ projectDir: proj, folder: 'shots' });
    expect(createAssetFolder({ projectDir: proj, folder: 'shots' }).success).toBe(true);
  });
});

describe('removeAssetFolder', () => {
  it('removes an empty folder from every kind', () => {
    createAssetFolder({ projectDir: proj, folder: 'shots' });
    expect(removeAssetFolder({ projectDir: proj, folder: 'shots' }).success).toBe(true);
    expect(projectFolders(proj)).toEqual([]);
  });

  it('refuses a folder that still holds files, and counts them', () => {
    createAssetFolder({ projectDir: proj, folder: 'shots' });
    fs.writeFileSync(path.join(proj, 'assets', 'images', 'shots', 'a.png'), 'x');
    const res = removeAssetFolder({ projectDir: proj, folder: 'shots' });
    // Deleting a folder full of work is the one action with no undo here: the
    // per-file delete route moves things to .trash, a recursive rmdir would not.
    expect(res.success).toBe(false);
    expect(res.error).toContain('1 item');
    expect(fs.existsSync(path.join(proj, 'assets', 'images', 'shots', 'a.png'))).toBe(true);
  });

  it('counts files in a sibling kind, not just the one that looks empty', () => {
    createAssetFolder({ projectDir: proj, folder: 'brand' });
    fs.writeFileSync(path.join(proj, 'assets', 'fonts', 'brand', 'x.ttf'), 'x');
    expect(removeAssetFolder({ projectDir: proj, folder: 'brand' }).success).toBe(false);
  });

  it('removes an empty library folder', () => {
    createAssetFolder({ folder: 'microsoft/logos', scope: 'library' });
    expect(removeAssetFolder({ folder: 'microsoft/logos', scope: 'library' }).success).toBe(true);
    expect(fs.existsSync(path.join(lib, 'microsoft', 'logos'))).toBe(false);
    expect(fs.existsSync(path.join(lib, 'microsoft'))).toBe(true);
  });
});
