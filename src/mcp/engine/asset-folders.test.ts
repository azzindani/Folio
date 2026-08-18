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

  it('reports nested folders, at every level', () => {
    fs.mkdirSync(path.join(proj, 'assets', 'images', 'clients', 'acme', 'logos'), { recursive: true });
    expect(projectFolders(proj)).toEqual(['clients', 'clients/acme', 'clients/acme/logos']);
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

  it('nests, and neutralises traversal instead of escaping with it', () => {
    const res = createAssetFolder({ projectDir: proj, folder: 'Clients/Acme Corp' });
    expect(res).toMatchObject({ success: true, folder: 'clients/acme-corp' });
    expect(fs.existsSync(path.join(proj, 'assets', 'images', 'clients', 'acme-corp'))).toBe(true);

    // ".." cannot survive a segment clean, so a traversal attempt lands INSIDE
    // the kind dir under whatever safe parts remain — never outside the project.
    const trav = createAssetFolder({ projectDir: proj, folder: '../../etc' });
    expect(trav).toMatchObject({ success: true, folder: 'etc' });
    expect(fs.existsSync(path.join(root, 'etc')), 'escaped the project').toBe(false);
    expect(fs.existsSync(path.join(proj, 'assets', 'images', 'etc'))).toBe(true);
  });

  it('refuses a name with nothing usable left in it', () => {
    const res = createAssetFolder({ projectDir: proj, folder: '..' });
    expect(res.success).toBe(false);
    expect(res.hint).toContain('4 levels');
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

  it('deletes a folder WITH its contents, moving the files to .trash', () => {
    createAssetFolder({ projectDir: proj, folder: 'shots' });
    fs.writeFileSync(path.join(proj, 'assets', 'images', 'shots', 'a.png'), 'x');
    // A folder you must empty by hand before you may remove it is a folder you
    // cannot remove. Contents go to .trash, exactly as a per-file delete does.
    const res = removeAssetFolder({ projectDir: proj, folder: 'shots' });
    expect(res).toMatchObject({ success: true, trashed: 1 });
    expect(fs.existsSync(path.join(proj, 'assets', 'images', 'shots'))).toBe(false);
    const trashed = fs.readdirSync(path.join(proj, '.trash'));
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toContain('a.png');
  });

  it('sweeps every kind and every level below the folder', () => {
    createAssetFolder({ projectDir: proj, folder: 'brand/logos' });
    fs.writeFileSync(path.join(proj, 'assets', 'fonts', 'brand', 'x.ttf'), 'x');
    fs.writeFileSync(path.join(proj, 'assets', 'images', 'brand', 'logos', 'y.png'), 'y');
    const res = removeAssetFolder({ projectDir: proj, folder: 'brand' });
    expect(res).toMatchObject({ success: true, trashed: 2 });
    expect(projectFolders(proj)).toEqual([]);
  });

  it('requireEmpty keeps the cautious behaviour for callers that want it', () => {
    createAssetFolder({ projectDir: proj, folder: 'keep' });
    fs.writeFileSync(path.join(proj, 'assets', 'images', 'keep', 'a.png'), 'x');
    const res = removeAssetFolder({ projectDir: proj, folder: 'keep', requireEmpty: true });
    expect(res.success).toBe(false);
    expect(res.error).toContain('1 item');
    expect(fs.existsSync(path.join(proj, 'assets', 'images', 'keep', 'a.png'))).toBe(true);
  });

  it('says so when the folder is not there at all', () => {
    expect(removeAssetFolder({ projectDir: proj, folder: 'ghost' }).error).toContain('No such folder');
  });

  it('removes an empty library folder', () => {
    createAssetFolder({ folder: 'microsoft/logos', scope: 'library' });
    expect(removeAssetFolder({ folder: 'microsoft/logos', scope: 'library' }).success).toBe(true);
    expect(fs.existsSync(path.join(lib, 'microsoft', 'logos'))).toBe(false);
    expect(fs.existsSync(path.join(lib, 'microsoft'))).toBe(true);
  });
});
