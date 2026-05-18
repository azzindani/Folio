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

// Token validation — reuses the OAuth access-token store from the MCP
// server. Compose runs UI + MCP in the same container (FOLIO_MODE=both)
// so this in-process registry is the source of truth. When running UI-only
// we fall back to the persisted JSON file the MCP server writes.
function loadValidTokens(): Map<string, { principal: string; expires_at: number }> {
  const file = path.join(
    process.env['FOLIO_OAUTH_STATE_DIR']
      ?? path.join(process.env['FOLIO_PROJECTS_DIR'] ?? '/tmp', '.oauth-state'),
    'access-tokens.json',
  );
  try {
    if (!fs.existsSync(file)) return new Map();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, { principal: string; expires_at: number }>;
    const now = Date.now();
    const m = new Map<string, { principal: string; expires_at: number }>();
    for (const [k, v] of Object.entries(parsed)) if (v.expires_at > now) m.set(k, v);
    return m;
  } catch { return new Map(); }
}

function isValidToken(token: string): boolean {
  const tokens = loadValidTokens();
  const rec = tokens.get(token);
  return !!rec && rec.expires_at > Date.now();
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [k, ...rest] = pair.trim().split('=');
    if (k) out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

const PORT = parseInt(process.env['PORT'] ?? '4173', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const DIST = path.resolve(process.env['FOLIO_DIST_DIR'] ?? 'dist');
// Mount FOLIO_PROJECTS_DIR at /__project_files/* so the editor can fetch a
// design YAML by relative path. Going through this route (rather than Caddy's
// /files/*) guarantees the request inherits whatever auth the editor itself
// has, since both share the catch-all editor handler.
const PROJECTS_DIR = path.resolve(process.env['FOLIO_PROJECTS_DIR'] ?? './folio-projects');

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

function safeJoinProject(rel: string): string | null {
  const clean = rel.replace(/\?.*$/, '').replace(/#.*$/, '');
  const decoded = decodeURIComponent(clean);
  const joined = path.normalize(path.join(PROJECTS_DIR, decoded));
  if (!joined.startsWith(PROJECTS_DIR)) return null;
  return joined;
}

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);

    // Auth check for /__project_files/* — accept a Bearer token, a
    // ?token= query param (Jupyter-style — the link from open_in_editor
    // includes one), or a folio_session cookie set by a previous token-
    // bearing request.
    if (url.pathname.startsWith('/__project_files/')) {
      const auth = req.headers.get('authorization') ?? '';
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const qtoken = url.searchParams.get('token') ?? '';
      const cookie = parseCookies(req.headers.get('cookie') ?? undefined)['folio_session'] ?? '';
      const presented = bearer || qtoken || cookie;
      if (!presented || !isValidToken(presented)) {
        return new Response('Unauthorized', { status: 401 });
      }

      const rel = url.pathname.slice('/__project_files/'.length);
      const target = safeJoinProject(rel);
      if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        return new Response('Not found', { status: 404 });
      }
      const body = fs.readFileSync(target);
      const headers: Record<string, string> = { 'Content-Type': mime(target), 'Cache-Control': 'no-store' };
      // If the caller came via ?token= and has no cookie yet, set one so
      // navigation away from this URL keeps the session alive without
      // re-attaching ?token= on every fetch.
      if (qtoken && !cookie) {
        headers['Set-Cookie'] = `folio_session=${encodeURIComponent(qtoken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`;
      }
      return new Response(body, { status: 200, headers });
    }

    // Side-effect: when a ?token= is present on the initial editor load,
    // promote it to a folio_session cookie so subsequent navigation works
    // without the token in the URL.
    const initialToken = url.searchParams.get('token');
    const hasSessionCookie = !!parseCookies(req.headers.get('cookie') ?? undefined)['folio_session'];
    const setSessionCookie = initialToken && isValidToken(initialToken) && !hasSessionCookie
      ? `folio_session=${encodeURIComponent(initialToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`
      : null;

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
    if (setSessionCookie) headers['Set-Cookie'] = setSessionCookie;
    return new Response(body, { status: 200, headers });
  },
});

process.stderr.write(`[serve-static] serving ${DIST} on http://${HOST}:${PORT}\n`);
