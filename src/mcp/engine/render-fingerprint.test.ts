import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderFingerprint, resetRenderFingerprint, fingerprintOf } from './render-fingerprint';
import { exportKey } from './export-receipt';

// An export is a pure function of (design bytes, format, scale, destination)
// AND THE RENDERER. The fifth term was missing, so a renderer fix reached no
// design that had already been exported — the cache went on serving pre-fix
// bytes forever. Found live: the `noise` fill fix was verified on a NEW design,
// while the design that had EXPOSED the bug re-exported byte-identical, still
// carrying the dead filter, because it had been exported once before the fix.

let tmp = '';

/** A throwaway src/ tree with one file in each render directory. */
function tree(marker: string): string {
  for (const d of ['renderer', 'export', 'engine']) {
    fs.mkdirSync(path.join(tmp, 'src', d), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', d, 'mod.ts'), `export const x = '${marker}';\n`, 'utf8');
  }
  return path.join(tmp, 'src');
}

describe('the fingerprint of this repo', () => {
  it('is a real hash, computed from sources that are actually there', () => {
    expect(renderFingerprint()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable — the same code fingerprints the same', () => {
    const a = renderFingerprint();
    resetRenderFingerprint();
    expect(renderFingerprint()).toBe(a);
  });

  it('is found from the module\'s own location, not the working directory', () => {
    // Production runs `bun src/mcp/http-server.ts` from anywhere; a fingerprint
    // that followed cwd would silently become `src-unavailable` and freeze.
    const cwd = process.cwd();
    process.chdir(os.tmpdir());
    resetRenderFingerprint();
    try { expect(renderFingerprint()).toMatch(/^[0-9a-f]{16}$/); }
    finally { process.chdir(cwd); resetRenderFingerprint(); }
  });
});

describe('what the fingerprint reacts to', () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-fp-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('a one-character edit to renderer code', () => {
    const before = fingerprintOf(tree('v1'));
    expect(fingerprintOf(tree('v2'))).not.toBe(before);
  });

  it('a NEW renderer file', () => {
    const root = tree('v1');
    const before = fingerprintOf(root);
    fs.writeFileSync(path.join(root, 'renderer', 'extra.ts'), 'export const y = 1;\n', 'utf8');
    expect(fingerprintOf(root)).not.toBe(before);
  });

  it('MOVING a file, even with identical contents', () => {
    // Paths are hashed alongside contents precisely so a reorganisation counts.
    const root = tree('v1');
    const before = fingerprintOf(root);
    fs.mkdirSync(path.join(root, 'renderer', 'sub'), { recursive: true });
    fs.renameSync(path.join(root, 'renderer', 'mod.ts'), path.join(root, 'renderer', 'sub', 'mod.ts'));
    expect(fingerprintOf(root)).not.toBe(before);
  });

  it('a bumped rasteriser version — resvg puts pixels on the page too', () => {
    const root = tree('v1');
    const read = (v: string): string => {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { '@resvg/resvg-js': v } }), 'utf8');
      return fingerprintOf(root);
    };
    expect(read('2.4.0')).not.toBe(read('2.6.0'));
  });
});

describe('what it deliberately ignores', () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-fp-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('a test file — tests do not render anything', () => {
    const root = tree('v1');
    const before = fingerprintOf(root);
    fs.writeFileSync(path.join(root, 'renderer', 'mod.test.ts'), 'it("x", () => {});\n', 'utf8');
    expect(fingerprintOf(root)).toBe(before);
  });

  it('code outside the rendering path', () => {
    const root = tree('v1');
    const before = fingerprintOf(root);
    fs.mkdirSync(path.join(root, 'editor'), { recursive: true });
    fs.writeFileSync(path.join(root, 'editor', 'panel.ts'), 'export const p = 1;\n', 'utf8');
    expect(fingerprintOf(root)).toBe(before);
  });

  it('missing sources degrade to a constant, not to the hash of nothing', () => {
    // A hash of zero files is a real-looking value that would never change
    // again — the exact silent staleness this module exists to prevent.
    expect(fingerprintOf(tmp)).toBe('src-unavailable');
    expect(fingerprintOf(null)).toBe('src-unavailable');
  });
});

describe('the export key carries it', () => {
  it('two renderers, same design → two different keys', async () => {
    const keyUnder = async (fp: string): Promise<string> => {
      vi.resetModules();
      vi.doMock('./render-fingerprint', () => ({
        renderFingerprint: () => fp,
        resetRenderFingerprint: () => { /* not used here */ },
        fingerprintOf: () => fp,
      }));
      const mod = await import('./export-receipt');
      return mod.exportKey('h1', 'svg', 1, '/p/d.svg');
    };
    try {
      // Every term the OLD key used is identical. Only the code differs.
      expect(await keyUnder('renderer-a')).not.toBe(await keyUnder('renderer-b'));
    } finally {
      vi.doUnmock('./render-fingerprint');
      vi.resetModules();
    }
  });

  it('and every original term still moves it on its own', () => {
    const base = exportKey('h1', 'pdf', 2, '/a/b.pdf');
    expect(exportKey('h2', 'pdf', 2, '/a/b.pdf')).not.toBe(base);
    expect(exportKey('h1', 'png', 2, '/a/b.pdf')).not.toBe(base);
    expect(exportKey('h1', 'pdf', 3, '/a/b.pdf')).not.toBe(base);
    expect(exportKey('h1', 'pdf', 2, '/a/c.pdf')).not.toBe(base);
  });
});
