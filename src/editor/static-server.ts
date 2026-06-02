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

// Static "lab" bearer tokens — the SAME secrets the MCP and the Harnesses lab
// use (FOLIO_TOKENS_FILE / FOLIO_TOKENS / FOLIO_API_KEY). Mirrors the parsing in
// src/mcp/auth.ts so one token opens both the MCP and the editor. Read inline
// (not imported) to keep the editor process free of MCP/OAuth module side-effects.
function loadStaticTokens(): Set<string> {
  const out = new Set<string>();
  const file = process.env['FOLIO_TOKENS_FILE'];
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
      for (const v of Object.values(parsed)) if (typeof v === 'string' && v.length > 0) out.add(v);
    } catch { /* missing/invalid file → no static tokens from here */ }
  }
  const inline = process.env['FOLIO_TOKENS'];
  if (inline) {
    for (const pair of inline.split(',')) {
      const value = pair.split(':').slice(1).join(':').trim();
      if (value.length > 0) out.add(value);
    }
  }
  const single = process.env['FOLIO_API_KEY'];
  if (single && single.length > 0) out.add(single);
  return out;
}

// True when ANY auth is configured. When false (no tokens anywhere) the editor
// serves openly — same posture as the MCP's unauthenticated mode — so a local
// run isn't locked out of its own UI.
function authConfigured(): boolean {
  return loadStaticTokens().size > 0;
}

function isValidToken(token: string): boolean {
  if (!token) return false;
  // 1. OAuth-issued / open_in_editor access token (access-tokens.json, expiring).
  const rec = loadValidTokens().get(token);
  if (rec && rec.expires_at > Date.now()) return true;
  // 2. Static lab/MCP bearer — never expires; one token for MCP + editor.
  return loadStaticTokens().has(token);
}

// Cookie lifetime for the editor session. 30 days so the lab token, pasted once
// via ?token=, keeps the editor open without re-prompting (was 1h).
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

// Shown when the editor is opened without a valid token (no Bearer / ?token= /
// cookie). Replaces the reverse-proxy's HTTP Basic Auth prompt with a plain
// token model — no username/password.
const UNAUTHORIZED_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Folio — access token required</title>
<style>body{font:16px/1.55 system-ui,-apple-system,sans-serif;background:#0A0E27;color:#E8F0FF;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:440px;padding:36px;background:#141A3A;border-radius:18px}h2{margin:0 0 12px}code{background:#0A0E27;padding:2px 7px;border-radius:6px;color:#22D3EE}p{color:#B8C0D9}</style></head>
<body><div class="card"><h2>Folio editor</h2><p>This editor is protected by an access token. Open it with your token appended to the URL:</p><p><code>?token=YOUR_TOKEN</code></p><p>The link returned by <code>open_in_editor</code> already includes one. After the first load your session is remembered for 30 days — no username or password.</p></div></body></html>`;

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
        headers['Set-Cookie'] = `folio_session=${encodeURIComponent(qtoken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
      }
      return new Response(body, { status: 200, headers });
    }

    // ── Editor auth gate ────────────────────────────────────────────────
    // The shared reverse-proxy no longer challenges Folio with HTTP Basic Auth,
    // so this server is the SOLE gate for the editor bundle. Require a valid
    // token via Bearer header, ?token= query, or folio_session cookie. When no
    // tokens are configured at all, serve openly (matches the MCP's open mode).
    {
      const authHeader = req.headers.get('authorization') ?? '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const qtoken = url.searchParams.get('token') ?? '';
      const cookieTok = parseCookies(req.headers.get('cookie') ?? undefined)['folio_session'] ?? '';
      const presented = bearer || qtoken || cookieTok;
      if (authConfigured() && !isValidToken(presented)) {
        return new Response(UNAUTHORIZED_HTML, {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    }

    // Side-effect: when a ?token= is present on the initial editor load,
    // promote it to a folio_session cookie so subsequent navigation works
    // without the token in the URL.
    const initialToken = url.searchParams.get('token');
    const hasSessionCookie = !!parseCookies(req.headers.get('cookie') ?? undefined)['folio_session'];
    const setSessionCookie = initialToken && isValidToken(initialToken) && !hasSessionCookie
      ? `folio_session=${encodeURIComponent(initialToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`
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
