import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { thumbFileName, pruneStaleThumbs } from './library-gallery';
import { renderFingerprint } from './render-fingerprint';

// A thumbnail is rendered output, and both caches holding one — the gallery
// export's .library/thumbs/ directory and the live /__library/thumb endpoint —
// validated it against the DESIGN's mtime alone. Neither mtime moves when the
// rendering code changes, so a renderer fix reached no thumbnail already on
// disk. Same species as the export receipt, one cache over.

const design = (root: string, project: string, name: string): string =>
  path.join(root, project, 'designs', `${name}.design.yaml`);

describe('the thumbnail cache name carries the renderer', () => {
  it('includes the current fingerprint', () => {
    const f = thumbFileName(design('/r', 'proj', 'poster'));
    expect(f).toBe(`proj__poster_design_yaml.${renderFingerprint()}.png`);
  });

  it('a different renderer means a different file — so the cache misses', async () => {
    const nameUnder = async (fp: string): Promise<string> => {
      vi.resetModules();
      vi.doMock('./render-fingerprint', () => ({
        renderFingerprint: () => fp, resetRenderFingerprint: () => { /* unused */ }, fingerprintOf: () => fp,
      }));
      const mod = await import('./library-gallery');
      return mod.thumbFileName(design('/r', 'proj', 'poster'));
    };
    try {
      expect(await nameUnder('aaaaaaaaaaaaaaaa')).not.toBe(await nameUnder('bbbbbbbbbbbbbbbb'));
    } finally {
      vi.doUnmock('./render-fingerprint');
      vi.resetModules();
    }
  });

  it('still separates two designs, and two projects sharing a design name', () => {
    const a = thumbFileName(design('/r', 'proj', 'one'));
    const b = thumbFileName(design('/r', 'proj', 'two'));
    const c = thumbFileName(design('/r', 'other', 'one'));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('puts the fingerprint in its own dot segment — design names cannot forge one', () => {
    // slug() strips dots from the design part, so the only dot before .png is
    // the separator. A design called "poster.v2" cannot collide with a
    // fingerprint segment.
    const f = thumbFileName(design('/r', 'proj', 'poster.v2'));
    expect(f.split('.').length).toBe(3);
    expect(f.endsWith(`.${renderFingerprint()}.png`)).toBe(true);
  });
});

describe('pruning earlier renderer generations', () => {
  let tmp = '';
  const dPath = (): string => design(tmp, 'proj', 'poster');

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-thumb-'));
    fs.mkdirSync(path.join(tmp, 'thumbs'), { recursive: true });
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const write = (name: string): string => {
    const p = path.join(tmp, 'thumbs', name);
    fs.writeFileSync(p, 'png', 'utf8');
    return p;
  };

  it('removes this design\'s thumbs from other generations, keeps the current one', () => {
    const old1 = write('proj__poster_design_yaml.0000000000000000.png');
    const old2 = write('proj__poster_design_yaml.1111111111111111.png');
    const keep = write(thumbFileName(dPath()));
    pruneStaleThumbs(path.join(tmp, 'thumbs'), dPath());
    expect(fs.existsSync(old1)).toBe(false);
    expect(fs.existsSync(old2)).toBe(false);
    expect(fs.existsSync(keep)).toBe(true);
  });

  it('never touches another design\'s thumbs', () => {
    const other = write('proj__another_design_yaml.0000000000000000.png');
    const otherProject = write('zzz__poster_design_yaml.0000000000000000.png');
    write(thumbFileName(dPath()));
    pruneStaleThumbs(path.join(tmp, 'thumbs'), dPath());
    expect(fs.existsSync(other)).toBe(true);
    expect(fs.existsSync(otherProject)).toBe(true);
  });

  it('leaves non-png files alone', () => {
    const sidecar = write('proj__poster_design_yaml.0000000000000000.json');
    pruneStaleThumbs(path.join(tmp, 'thumbs'), dPath());
    expect(fs.existsSync(sidecar)).toBe(true);
  });

  it('a missing directory is not an error — the render still stands', () => {
    expect(() => pruneStaleThumbs(path.join(tmp, 'nope'), dPath())).not.toThrow();
  });
});
