// GET /__library/thumb?d=<relKey> — render + cache one design thumbnail.
//
// Split out of static-server.ts, which had reached the 700-line ceiling. The
// endpoint is self-contained: given a design key it answers a PNG, a 304, or a
// reason it cannot. Auth stays at the front door in static-server, because
// every /__library/* route shares it; what lives here is resolve → cache →
// render → serve.
//
// The cache is two-layered and BOTH layers have to agree on what "unchanged"
// means: a file under <projects>/.library/thumbs/ and an ETag the browser
// holds. Each is keyed on the design's mtime AND the renderer fingerprint —
// mtime alone answers "has the design changed?" and leaves "has the code that
// draws it changed?" unasked, so a renderer fix would reach neither the file on
// disk nor the copy in the browser.
import * as fs from 'fs';
import * as path from 'path';
import { renderThumb, thumbFileName, pruneStaleThumbs } from '../mcp/engine/library-gallery';
import { renderFingerprint } from '../mcp/engine/render-fingerprint';

export interface ThumbContext {
  /** Root of the projects directory — thumbs cache under <root>/.library/thumbs. */
  projectsDir: string;
  /** Resolve a relative design key to an absolute path, or null if it escapes. */
  resolveDesign: (rel: string) => string | null;
  /** Concurrency gate: rasterizing blocks the single event loop. */
  heavy: { tryAcquire: () => boolean; release: () => void };
}

// `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`: the latter widens to
// ArrayBufferLike, which a SharedArrayBuffer could back, and so is not a valid
// BodyInit. The copy at the call site is what makes it a plain ArrayBuffer.
const png = (body: Uint8Array<ArrayBuffer>, etag: string): Response =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'image/png', ETag: etag, 'Cache-Control': 'no-cache' } });

/** Serve one thumbnail. The caller has already authorised the request. */
export function serveLibraryThumb(req: Request, url: URL, ctx: ThumbContext): Response {
  const d = url.searchParams.get('d') ?? '';
  if (!d || d.includes('..') || path.isAbsolute(d)) return new Response('Bad design key', { status: 400 });
  const abs = ctx.resolveDesign(d);
  if (!abs || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return new Response('Not found', { status: 404 });

  const mtime = Math.floor(fs.statSync(abs).mtimeMs);
  // The renderer goes in the ETag as well as the filename. Without it a browser
  // holding the old tag is answered 304 and goes on showing a pre-fix thumbnail
  // even once the server would render a correct one.
  const etag = `"t${mtime}-${renderFingerprint()}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-cache' } });
  }

  const thumbsDir = path.join(ctx.projectsDir, '.library', 'thumbs');
  const cachePath = path.join(thumbsDir, thumbFileName(abs));
  let body: Buffer | null = null;
  try { if (fs.existsSync(cachePath) && fs.statSync(cachePath).mtimeMs >= mtime) body = fs.readFileSync(cachePath); }
  catch { /* unreadable cache — re-render below */ }

  if (!body) {
    // Cap concurrent renders so a burst of cache-misses can't pile up. Cache
    // hits above skip the gate.
    if (!ctx.heavy.tryAcquire()) {
      return new Response('Server busy — retry shortly', { status: 503, headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' } });
    }
    try { body = renderThumb(abs); } finally { ctx.heavy.release(); }
    if (body) {
      try {
        fs.mkdirSync(thumbsDir, { recursive: true });
        fs.writeFileSync(cachePath, body);
        pruneStaleThumbs(thumbsDir, abs);
      } catch { /* serve it uncached */ }
    }
  }
  if (!body) return new Response('No preview', { status: 404 });
  // Wrap in a fresh ArrayBuffer-backed view: renderThumb's Buffer is typed
  // Buffer<ArrayBufferLike>, which a SharedArrayBuffer could back and so is not
  // a valid BodyInit; a copied Uint8Array always is.
  return png(new Uint8Array(body), etag);
}
