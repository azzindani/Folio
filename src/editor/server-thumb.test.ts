import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { serveLibraryThumb, type ThumbContext } from './server-thumb';
import { thumbFileName } from '../mcp/engine/library-gallery';
import { renderFingerprint } from '../mcp/engine/render-fingerprint';

// Extracted from static-server.ts when that file hit the 700-line ceiling.
// These cover the paths that answer WITHOUT rasterizing — every guard, the
// cache hit, and the two-layer freshness check — so the move is proved to have
// kept the endpoint's behaviour rather than assumed to have.

let root = '';
let design = '';
let acquired = 0;

const ctx = (over: Partial<ThumbContext> = {}): ThumbContext => ({
  projectsDir: root,
  resolveDesign: rel => path.join(root, rel),
  heavy: { tryAcquire: () => { acquired++; return true; }, release: () => { /* counted above */ } },
  ...over,
});

const get = (query: string, headers: Record<string, string> = {}): Request =>
  new Request(`http://x/__library/thumb?${query}`, { headers });

const cacheFileFor = (abs: string): string => path.join(root, '.library', 'thumbs', thumbFileName(abs));

beforeEach(() => {
  acquired = 0;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-thumbsrv-'));
  fs.mkdirSync(path.join(root, 'proj', 'designs'), { recursive: true });
  design = path.join(root, 'proj', 'designs', 'p.design.yaml');
  fs.writeFileSync(design, 'document:\n  width: 100\n  height: 100\nlayers: []\n', 'utf8');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('what it refuses', () => {
  it('400 with no design key', async () => {
    expect((await serveLibraryThumb(get(''), new URL('http://x/?'), ctx())).status).toBe(400);
  });

  it('400 on a traversal attempt, before touching the disk', () => {
    const u = new URL('http://x/__library/thumb?d=../../etc/passwd');
    expect(serveLibraryThumb(get('d=x'), u, ctx()).status).toBe(400);
  });

  it('400 on an absolute path', () => {
    const u = new URL('http://x/__library/thumb?d=/etc/passwd');
    expect(serveLibraryThumb(get('d=x'), u, ctx()).status).toBe(400);
  });

  it('404 when the key escapes the projects dir', () => {
    const u = new URL('http://x/__library/thumb?d=proj/designs/p.design.yaml');
    expect(serveLibraryThumb(get('d=x'), u, ctx({ resolveDesign: () => null })).status).toBe(404);
  });

  it('404 for a design that is not there', () => {
    const u = new URL('http://x/__library/thumb?d=proj/designs/gone.design.yaml');
    expect(serveLibraryThumb(get('d=x'), u, ctx()).status).toBe(404);
  });

  it('404 for a directory', () => {
    const u = new URL('http://x/__library/thumb?d=proj/designs');
    expect(serveLibraryThumb(get('d=x'), u, ctx()).status).toBe(404);
  });

  it('503 rather than piling up renders when the gate is shut', () => {
    const u = new URL('http://x/__library/thumb?d=proj/designs/p.design.yaml');
    const res = serveLibraryThumb(get('d=x'), u, ctx({ heavy: { tryAcquire: () => false, release: () => { /* never taken */ } } }));
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('1');
  });
});

describe('the two-layer cache', () => {
  const u = (): URL => new URL('http://x/__library/thumb?d=proj/designs/p.design.yaml');

  const seedCache = (): string => {
    const p = cacheFileFor(design);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'cached-bytes');
    const future = Date.now() + 10_000;
    fs.utimesSync(p, future / 1000, future / 1000);
    return p;
  };

  it('serves the cached file without rendering', async () => {
    seedCache();
    const res = serveLibraryThumb(get('d=x'), u(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(await res.text()).toBe('cached-bytes');
    expect(acquired, 'took the render gate despite a cache hit').toBe(0);
  });

  it('the ETag carries BOTH the design mtime and the renderer', () => {
    seedCache();
    const tag = serveLibraryThumb(get('d=x'), u(), ctx()).headers.get('ETag') ?? '';
    const mtime = Math.floor(fs.statSync(design).mtimeMs);
    expect(tag).toBe(`"t${mtime}-${renderFingerprint()}"`);
  });

  it('304s the browser copy when that tag still matches', () => {
    seedCache();
    const tag = serveLibraryThumb(get('d=x'), u(), ctx()).headers.get('ETag') ?? '';
    const res = serveLibraryThumb(get('d=x', { 'if-none-match': tag }), u(), ctx());
    expect(res.status).toBe(304);
  });

  it('does NOT 304 a tag minted before the renderer was part of it', () => {
    // The whole point. A browser that visited before this fix holds `"t<mtime>"`
    // — the OLD shape, design mtime only. If that still matched, the browser
    // would be answered 304 and go on showing a pre-fix thumbnail for ever.
    // Building the stale tag with a made-up fingerprint instead would prove
    // nothing: it mismatches whether or not the fix is in.
    seedCache();
    const mtime = Math.floor(fs.statSync(design).mtimeMs);
    const legacy = `"t${mtime}"`;
    expect(serveLibraryThumb(get('d=x', { 'if-none-match': legacy }), u(), ctx()).status).toBe(200);
  });

  it('does not serve a cache file older than the design', () => {
    const p = seedCache();
    const past = (Date.now() - 60_000) / 1000;
    fs.utimesSync(p, past, past);
    // Falls through to a render, which takes the gate.
    serveLibraryThumb(get('d=x'), u(), ctx());
    expect(acquired).toBe(1);
  });
});
