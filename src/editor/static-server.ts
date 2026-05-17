// Minimal static-file server for the production editor bundle.
//
// Serves the contents of `dist/` (the Vite build output) plus a fallback to
// `index.html` for SPA-style routing. Runs on Bun's native `Bun.serve` so
// the runtime container only needs bun — no node, no npm, no vite preview.
//
//   PORT (default 4173)
//   HOST (default 0.0.0.0)
//   FOLIO_DIST_DIR (default ./dist)
import * as path from 'path';
import * as fs from 'fs';

const PORT = parseInt(process.env['PORT'] ?? '4173', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const DIST = path.resolve(process.env['FOLIO_DIST_DIR'] ?? 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.map':  'application/json; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml':  'text/yaml; charset=utf-8',
  '.wasm': 'application/wasm',
};

function mime(p: string): string { return MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream'; }

function safeJoin(rel: string): string | null {
  const clean = rel.replace(/\?.*$/, '').replace(/#.*$/, '');
  const decoded = decodeURIComponent(clean);
  const joined = path.normalize(path.join(DIST, decoded));
  if (!joined.startsWith(DIST)) return null; // directory traversal guard
  return joined;
}

const INDEX_HTML = path.join(DIST, 'index.html');
if (!fs.existsSync(INDEX_HTML)) {
  process.stderr.write(`[serve-static] dist/index.html not found at ${INDEX_HTML} — was the bundle built?\n`);
  process.exit(1);
}

declare const Bun: { serve: (opts: {
  port: number; hostname: string;
  fetch: (req: Request) => Promise<Response> | Response;
}) => unknown };

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    let target = safeJoin(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!target) return new Response('Forbidden', { status: 403 });

    if (fs.existsSync(target)) {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) target = path.join(target, 'index.html');
    }
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      // SPA fallback so deep links resolve to the editor shell.
      target = INDEX_HTML;
    }
    const body = fs.readFileSync(target);
    const headers: Record<string, string> = { 'Content-Type': mime(target) };
    if (target === INDEX_HTML) headers['Cache-Control'] = 'no-cache';
    else if (target.includes('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    return new Response(body, { status: 200, headers });
  },
});

process.stderr.write(`[serve-static] serving ${DIST} on http://${HOST}:${PORT}\n`);
