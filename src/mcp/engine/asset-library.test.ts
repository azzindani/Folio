import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  sanitizeFolderPath, parseLibPath, libraryAbsPath, libraryRoot, isLibraryPath,
  ingestLibraryAsset, collectLibraryAssets, libraryBySource, libraryFolders,
  moveLibraryAsset, deleteLibraryAsset, libraryTotalBytes,
} from './asset-library';
import { readLibraryIndex, sha256 } from './asset-library-index';

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#2B4AF2"/></svg>');
const SVG2 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#D6301F"/></svg>');

describe('asset library', () => {
  let tmp: string, prevLib: string | undefined;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-lib-'));
    prevLib = process.env['FOLIO_LIBRARY_DIR'];
    process.env['FOLIO_LIBRARY_DIR'] = path.join(tmp, 'lib-root');
  });
  afterEach(() => {
    if (prevLib === undefined) delete process.env['FOLIO_LIBRARY_DIR'];
    else process.env['FOLIO_LIBRARY_DIR'] = prevLib;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('paths', () => {
    it('keeps nested folders, unlike the project store', () => {
      expect(sanitizeFolderPath('Microsoft/Logos')).toBe('microsoft/logos');
      expect(sanitizeFolderPath('AI logo')).toBe('ai-logo');
    });
    it('caps depth and drops traversal segments', () => {
      expect(sanitizeFolderPath('a/b/c/d/e/f')).toBe('a/b/c/d');
      expect(sanitizeFolderPath('../../etc')).toBe('etc');
      expect(sanitizeFolderPath('')).toBe('');
    });
    it('parses lib paths and refuses malformed ones', () => {
      expect(parseLibPath('lib/microsoft/logos/pa.svg')).toEqual({ folder: 'microsoft/logos', name: 'pa.svg' });
      expect(parseLibPath('lib/pa.svg')).toEqual({ folder: '', name: 'pa.svg' });
      expect(parseLibPath('assets/images/pa.svg')).toBeNull();
      expect(parseLibPath('lib/pa.exe')).toBeNull();
      expect(parseLibPath('lib/../../etc/passwd')).toBeNull();
    });
    it('never resolves outside the library root', () => {
      expect(libraryAbsPath('lib/../../secret.png')).toBeNull();
      const abs = libraryAbsPath('lib/microsoft/pa.svg');
      expect(abs).toBe(path.join(libraryRoot(), 'microsoft', 'pa.svg'));
      expect(isLibraryPath('lib/x.svg')).toBe(true);
      expect(isLibraryPath('assets/images/x.svg')).toBe(false);
    });
  });

  describe('ingest', () => {
    it('stores under a nested folder and indexes the hash', () => {
      const { entry, deduped } = ingestLibraryAsset({ name: 'power-automate.svg', data: SVG, folder: 'Microsoft/Logos' });
      expect(deduped).toBe(false);
      expect(entry.path).toBe('lib/microsoft/logos/power-automate.svg');
      expect(entry.sha256).toBe(sha256(SVG));
      expect(entry.width).toBe(10);
      expect(fs.existsSync(path.join(libraryRoot(), 'microsoft/logos/power-automate.svg'))).toBe(true);
      expect(readLibraryIndex(libraryRoot())).toHaveLength(1);
    });

    it('reuses identical bytes instead of storing a second copy', () => {
      const first = ingestLibraryAsset({ name: 'pa.svg', data: SVG, folder: 'microsoft' });
      const again = ingestLibraryAsset({ name: 'power-automate-again.svg', data: SVG, folder: 'other' });
      expect(again.deduped).toBe(true);
      expect(again.entry.path).toBe(first.entry.path);
      expect(collectLibraryAssets()).toHaveLength(1);
      expect(fs.existsSync(path.join(libraryRoot(), 'other'))).toBe(false);
    });

    it('keeps both files when the name collides but the bytes differ', () => {
      ingestLibraryAsset({ name: 'logo.svg', data: SVG, folder: 'microsoft' });
      const second = ingestLibraryAsset({ name: 'logo.svg', data: SVG2, folder: 'microsoft' });
      expect(second.deduped).toBe(false);
      expect(second.entry.path).toBe('lib/microsoft/logo-2.svg');
      expect(collectLibraryAssets()).toHaveLength(2);
    });

    it('records the source ref so the same fetch skips the network', () => {
      ingestLibraryAsset({ name: 'pa.svg', data: SVG, folder: 'microsoft', source: 'wikimedia:File:Power Automate.svg' });
      expect(libraryBySource('wikimedia:file:power automate.svg')?.path).toBe('lib/microsoft/pa.svg');
      expect(libraryBySource('wikimedia:File:Something Else.svg')).toBeUndefined();
    });

    it('strips scripts out of stored SVG', () => {
      const nasty = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5"><script>alert(1)</script></svg>');
      const { entry, warnings } = ingestLibraryAsset({ name: 'x.svg', data: nasty });
      const stored = fs.readFileSync(path.join(libraryRoot(), 'x.svg'), 'utf8');
      expect(stored).not.toContain('<script');
      expect(warnings.join(' ')).toContain('stripped');
      expect(entry.path).toBe('lib/x.svg');
    });

    it('rejects unsupported types and empty bytes', () => {
      expect(() => ingestLibraryAsset({ name: 'evil.exe', data: SVG })).toThrow(/Unsupported/);
      expect(() => ingestLibraryAsset({ name: 'empty.svg', data: Buffer.alloc(0) })).toThrow(/empty/);
    });
  });

  describe('tree', () => {
    it('picks up a file dropped in by hand and reports folders', () => {
      const dir = path.join(libraryRoot(), 'ai', 'logos');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'chatgpt.svg'), SVG);
      const rows = collectLibraryAssets();
      expect(rows.map(r => r.path)).toEqual(['lib/ai/logos/chatgpt.svg']);
      expect(rows[0]?.folder).toBe('ai/logos');
      expect(libraryFolders()).toEqual(['ai', 'ai/logos']);
      expect(libraryTotalBytes()).toBe(SVG.length);
    });

    it('moves and renames, keeping the index in step', () => {
      ingestLibraryAsset({ name: 'pa.svg', data: SVG, folder: 'inbox' });
      const moved = moveLibraryAsset('lib/inbox/pa.svg', { folder: 'microsoft/logos', new_name: 'power-automate.svg' });
      expect(moved.path).toBe('lib/microsoft/logos/power-automate.svg');
      expect(fs.existsSync(path.join(libraryRoot(), 'inbox/pa.svg'))).toBe(false);
      expect(readLibraryIndex(libraryRoot()).map(r => r.path)).toEqual([moved.path]);
    });

    it('deletes softly, into the library trash', () => {
      ingestLibraryAsset({ name: 'pa.svg', data: SVG });
      const { trash } = deleteLibraryAsset('lib/pa.svg');
      expect(fs.existsSync(trash)).toBe(true);
      expect(collectLibraryAssets()).toHaveLength(0);
      expect(() => deleteLibraryAsset('lib/pa.svg')).toThrow(/Not in the library/);
    });
  });
});

describe('the folder tree stays honest', () => {
  let tmp: string, prevLib: string | undefined;
  const SVG3 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="6" height="6"><rect width="6" height="6" fill="#0F6B5C"/></svg>');
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-folders-'));
    prevLib = process.env['FOLIO_LIBRARY_DIR'];
    process.env['FOLIO_LIBRARY_DIR'] = path.join(tmp, 'lib-root');
  });
  afterEach(() => {
    if (prevLib === undefined) delete process.env['FOLIO_LIBRARY_DIR'];
    else process.env['FOLIO_LIBRARY_DIR'] = prevLib;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('never lists .trash as a folder — it selects nothing', () => {
    ingestLibraryAsset({ name: 'a.svg', data: SVG3, folder: 'scratch' });
    deleteLibraryAsset('lib/scratch/a.svg');
    expect(fs.existsSync(path.join(libraryRoot(), '.trash'))).toBe(true);
    expect(libraryFolders()).not.toContain('.trash');
  });

  it('prunes folders left empty by a delete', () => {
    ingestLibraryAsset({ name: 'a.svg', data: SVG3, folder: 'scratch/probe' });
    expect(libraryFolders()).toEqual(['scratch', 'scratch/probe']);
    deleteLibraryAsset('lib/scratch/probe/a.svg');
    expect(libraryFolders()).toEqual([]);
  });

  it('prunes the folder a move emptied, keeping ones still in use', () => {
    ingestLibraryAsset({ name: 'a.svg', data: SVG3, folder: 'scratch/probe' });
    ingestLibraryAsset({ name: 'b.svg', data: Buffer.concat([SVG3, Buffer.from(' ')]), folder: 'scratch/keep' });
    moveLibraryAsset('lib/scratch/probe/a.svg', { folder: 'microsoft/logos' });
    const folders = libraryFolders();
    expect(folders).toContain('microsoft/logos');
    expect(folders).toContain('scratch/keep');
    expect(folders).not.toContain('scratch/probe');
  });
});
