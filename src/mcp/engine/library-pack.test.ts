import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { seedPack, packLibPath, describeSeed, type PackFile } from './library-pack';
import { readLibraryIndex } from './asset-library-index';

const svg = (fill: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="${fill}"/></svg>`;

let tmp = '', pack = '', lib = '';
function writePack(files: Array<PackFile & { body: string }>): void {
  fs.rmSync(pack, { recursive: true, force: true });
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(pack, f.path)), { recursive: true });
    fs.writeFileSync(path.join(pack, f.path), f.body);
  }
  const manifest = { version: 1, updated: '2026-09-23', files: files.map(({ body: _body, ...f }) => f) };
  fs.writeFileSync(path.join(pack, 'manifest.json'), JSON.stringify(manifest));
}
const seed = (): ReturnType<typeof seedPack> => seedPack({ dir: pack, root: lib });
const libFile = (rel: string): string => path.join(lib, 'folio', ...rel.split('/'));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-pack-'));
  pack = path.join(tmp, 'library');
  lib = path.join(tmp, 'lib-root');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env['FOLIO_PACK']; });

describe('packLibPath', () => {
  it('seeds under lib/folio/, and only clean paths', () => {
    expect(packLibPath('svg/marks/star.svg')).toBe('lib/folio/svg/marks/star.svg');
    expect(packLibPath('svg/../etc/passwd.svg')).toBeNull();
    expect(packLibPath('svg/Marks/star.svg')).toBeNull();
    expect(packLibPath('a/b/c/d/deep.svg')).toBeNull();
    expect(packLibPath('svg/run.exe')).toBeNull();
  });
});

describe('seedPack', () => {
  it('copies the pack in with its licence on record, then leaves it alone', () => {
    writePack([{ path: 'svg/star.svg', license: 'CC0', title: 'five-point star', source: 'https://example.org/star.svg', body: svg('#f00') }]);
    const first = seed();
    expect(first.added).toEqual(['lib/folio/svg/star.svg']);
    expect(fs.readFileSync(libFile('svg/star.svg'), 'utf8')).toContain('#f00');
    const row = readLibraryIndex(lib).find(r => r.path === 'lib/folio/svg/star.svg');
    expect(row).toMatchObject({ kind: 'images', folder: 'folio/svg', alt: 'five-point star', width: 24, provenance: { source: 'folio-pack', license: 'CC0' } });

    const indexBefore = fs.statSync(path.join(lib, 'index.json')).mtimeMs;
    const second = seed();
    expect(second).toMatchObject({ added: [], updated: [], kept: ['lib/folio/svg/star.svg'] });
    expect(fs.statSync(path.join(lib, 'index.json')).mtimeMs).toBe(indexBefore);
  });

  it('updates an untouched seeded copy, but never one the operator changed', () => {
    writePack([
      { path: 'svg/a.svg', license: 'MIT', body: svg('#111') },
      { path: 'svg/b.svg', license: 'MIT', body: svg('#222') },
    ]);
    seed();
    fs.writeFileSync(libFile('svg/b.svg'), svg('#bbb'));           // the operator's own edit
    writePack([
      { path: 'svg/a.svg', license: 'MIT', body: svg('#999') },
      { path: 'svg/b.svg', license: 'MIT', body: svg('#999') },
    ]);
    const r = seed();
    expect(r.updated).toEqual(['lib/folio/svg/a.svg']);
    expect(r.kept).toEqual(['lib/folio/svg/b.svg']);
    expect(fs.readFileSync(libFile('svg/b.svg'), 'utf8')).toContain('#bbb');
  });

  it('never re-adds a file the operator deleted', () => {
    writePack([{ path: 'svg/gone.svg', license: 'CC0', body: svg('#0f0') }]);
    seed();
    fs.rmSync(libFile('svg/gone.svg'));
    const r = seed();
    expect(r.deleted_by_you).toEqual(['lib/folio/svg/gone.svg']);
    expect(fs.existsSync(libFile('svg/gone.svg'))).toBe(false);
    expect(describeSeed(r)).toContain('1 you deleted');
  });

  it('refuses a licence the pack may not redistribute, and a file the manifest lists but lacks', () => {
    writePack([{ path: 'svg/nc.svg', license: 'CC BY-NC 4.0', body: svg('#000') }]);
    fs.writeFileSync(path.join(pack, 'manifest.json'), JSON.stringify({ version: 1, updated: '', files: [
      { path: 'svg/nc.svg', license: 'CC BY-NC 4.0' }, { path: 'svg/missing.svg', license: 'CC0' },
    ] }));
    const r = seed();
    expect(r.added).toEqual([]);
    expect(r.errors.join('\n')).toMatch(/nc\.svg: licence "CC BY-NC 4.0"[\s\S]*missing\.svg: listed but missing/);
  });

  it('takes a sound\'s length from the manifest — seeding runs no ffprobe', () => {
    // Not decodable audio: a probe would have failed, so the length can only
    // have come from the manifest.
    writePack([{ path: 'sfx/ui/click.mp3', license: 'CC0', duration_ms: 90, tags: ['click'], body: 'not really an mp3' }]);
    expect(seed().added).toEqual(['lib/folio/sfx/ui/click.mp3']);
    expect(readLibraryIndex(lib)[0]).toMatchObject({ kind: 'audio', duration_ms: 90, folder: 'folio/sfx/ui' });
  });

  it('does nothing when FOLIO_PACK=0 or there is no pack', () => {
    writePack([{ path: 'svg/x.svg', license: 'CC0', body: svg('#abc') }]);
    process.env['FOLIO_PACK'] = '0';
    expect(seed().added).toEqual([]);
    delete process.env['FOLIO_PACK'];
    expect(seedPack({ dir: path.join(tmp, 'nowhere'), root: lib }).added).toEqual([]);
    expect(fs.existsSync(lib)).toBe(false);
  });
});
