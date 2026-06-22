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
// Pure, side-effect-free HS256 verify — safe to import into the editor process
// without pulling in MCP/OAuth module side effects (no server start, no IO at
// import). Lets the editor validate the stateless JWTs mintEditorToken now issues.
import { verifyJwt, signJwt, jwtSecret } from '../mcp/jwt';
// Pure, side-effect-free resolver (fs + a hash only) — maps a short /o/<code>
// back to the design path so we can 302 to the full tokenized editor URL.
import { resolveShortLink } from '../mcp/engine/short-link';
// Pure fs overlay (no engine.ts side effects) — lets the gallery persist a
// design's collection from the browser/phone via POST /__library/assign.
import { assignDesign } from '../mcp/engine/library-collections';
// Filesystem ops (pure fs + YAML, no rendering) — rename / delete(→trash) /
// move, surfaced to the gallery via POST /__library/manage.
import { renameDesign, deleteDesign, moveDesign } from '../mcp/engine/library-manage';

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
// run isn't locked out of its own UI. A bare FOLIO_JWT_SECRET counts as
// configured even with no static tokens (matches loadTokens in src/mcp/auth.ts).
function authConfigured(): boolean {
  return loadStaticTokens().size > 0 || !!jwtSecret();
}

function isValidToken(token: string): boolean {
  if (!token) return false;
  // 1. OAuth-issued / open_in_editor access token (access-tokens.json, expiring).
  const rec = loadValidTokens().get(token);
  if (rec && rec.expires_at > Date.now()) return true;
  // 2. Static lab/MCP bearer — never expires; one token for MCP + editor.
  if (loadStaticTokens().has(token)) return true;
  // 3. Stateless HS256 JWT (the kind mintEditorToken now issues) + raw secret
  //    as master bearer. Verified by signature + exp — no store to consult.
  const secret = jwtSecret();
  if (secret && (token === secret || verifyJwt(token, secret).ok)) return true;
  return false;
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

// A "Library" entry point injected into the editor shell so the cross-project
// Design Library is reachable from the editor itself. The editor bundle is
// prebuilt and the build is memory-capped on this host, so rather than rebuild
// dist we inject a tiny script that clones the existing top-bar "Catalog" button
// into a matching "Library" button beside it (opens /library in a new tab).
// Falls back to a fixed-position pill if the toolbar can't be located, and a
// MutationObserver re-adds it if the toolbar re-renders. Purely additive — it
// adds one element and can't alter the SPA's own behaviour.
const EDITOR_LIBRARY_BTN = `<script>(function(){var ID='folio-library-btn';
function findCatalog(){var els=document.querySelectorAll('button,a,[role=button]');
for(var i=0;i<els.length;i++){var t=(els[i].textContent||'').trim().toLowerCase();if(t==='catalog'||t.indexOf('catalog')>=0)return els[i];}return null;}
function go(e){if(e){e.preventDefault();e.stopPropagation();}window.open('/library','_blank','noopener');}
function inject(){if(document.getElementById(ID))return true;var cat=findCatalog();if(!cat||!cat.parentNode)return false;
var lib=cat.cloneNode(true);lib.id=ID;lib.textContent='Library';lib.setAttribute('title','Open the cross-project Design Library');
lib.addEventListener('click',go);cat.parentNode.insertBefore(lib,cat.nextSibling);return true;}
function fallback(){if(document.getElementById(ID))return;var a=document.createElement('a');a.id=ID;a.href='/library';a.target='_blank';a.rel='noopener';a.textContent='▦ Library';
a.style.cssText='position:fixed;left:12px;bottom:12px;z-index:2147483000;padding:8px 12px;border-radius:10px;background:#161B22;color:#C9D2E3;border:1px solid #2A323F;font:600 12px system-ui,sans-serif;text-decoration:none;box-shadow:0 2px 10px rgba(0,0,0,.35)';document.body.appendChild(a);}
var n=0,iv=setInterval(function(){n++;if(inject()||n>40){clearInterval(iv);if(!document.getElementById(ID))fallback();
try{new MutationObserver(function(){if(!document.getElementById(ID))inject();}).observe(document.body,{childList:true,subtree:true});}catch(e){}}},250);})();</script>`;

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

    // ── Short editor link: /o/<code> → 302 to the full tokenized editor URL ──
    // The whole point: a small model copies this ~40-char link faithfully, then
    // we mint the auth token HERE (server-side) so no long JWT ever rides in the
    // string the model handled. Runs before the auth gate — the code itself is
    // the capability (same trust posture as the token-bearing long link).
    // Capture everything after /o/ (even a trailing %5D / backtick a small model
    // may glue on) and let resolveShortLink sanitize it — don't reject at the
    // route, or such a link 401s at the auth gate instead of resolving.
    const shortCodeMatch = url.pathname.match(/^\/o\/([^/]+)$/);
    if (shortCodeMatch && req.method === 'GET') {
      // No decode (a lone % would throw); resolveShortLink strips from the first
      // non-[A-Za-z0-9_-] char, so a raw "%5D" / "`" tail is handled the same.
      const code = shortCodeMatch[1] ?? '';
      const target = resolveShortLink(code);
      if (!target) return new Response('Unknown or expired Folio link', { status: 404 });
      const p = new URLSearchParams();
      p.set('file', target.path);
      if (typeof target.page === 'number') p.set('page', String(target.page));
      p.set('mcp_url', process.env['FOLIO_MCP_PUBLIC_URL'] ?? `http://localhost:${process.env['FOLIO_PORT'] ?? '3333'}`);
      const secret = jwtSecret();
      if (secret) p.set('token', signJwt({ sub: 'default', kind: 'editor' }, secret, 60 * 60 * 24 * 30));
      return new Response(null, { status: 302, headers: { Location: `/?${p.toString()}`, 'Cache-Control': 'no-store' } });
    }

    // ── POST /__library/assign — persist a design's collection ──────────
    // Self-serve organising from the gallery (web + mobile): move a design
    // into a collection or clear it. Same token auth as /__project_files;
    // writes only the non-destructive collections manifest — files untouched.
    if (url.pathname === '/__library/assign' && req.method === 'POST') {
      const auth = req.headers.get('authorization') ?? '';
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const qtoken = url.searchParams.get('token') ?? '';
      const cookie = parseCookies(req.headers.get('cookie') ?? undefined)['folio_session'] ?? '';
      const presented = bearer || qtoken || cookie;
      if (!presented || !isValidToken(presented)) return new Response('Unauthorized', { status: 401 });
      if (parseInt(req.headers.get('content-length') ?? '0', 10) > 8192) return new Response('Payload too large', { status: 413 });
      let body: { design?: unknown; collection?: unknown };
      try { body = (await req.json()) as typeof body; } catch { return new Response('Bad JSON', { status: 400 }); }
      const design = typeof body.design === 'string' ? body.design : '';
      const collection = typeof body.collection === 'string' ? body.collection : '';
      // The design key must stay inside the projects root (no traversal).
      if (!design || design.includes('..') || path.isAbsolute(design)) return new Response('Bad design key', { status: 400 });
      try {
        assignDesign(PROJECTS_DIR, design, collection);
        return new Response(JSON.stringify({ ok: true, design, collection: collection.trim() || 'Unsorted' }), {
          status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      } catch { return new Response('Assign failed', { status: 500 }); }
    }

    // ── POST /__library/manage — rename / delete(→trash) / move a design ──
    // The filesystem half of the gallery's self-serve management. Same token
    // auth + body cap + traversal guard; reuses the library-manage ops. Delete
    // is recoverable (moves to <project>/.trash, never unlinks). Body:
    // {action:"rename"|"delete"|"move", design:<relKey>, name?, project?}.
    if (url.pathname === '/__library/manage' && req.method === 'POST') {
      const auth = req.headers.get('authorization') ?? '';
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const qtoken = url.searchParams.get('token') ?? '';
      const cookie = parseCookies(req.headers.get('cookie') ?? undefined)['folio_session'] ?? '';
      const presented = bearer || qtoken || cookie;
      if (!presented || !isValidToken(presented)) return new Response('Unauthorized', { status: 401 });
      if (parseInt(req.headers.get('content-length') ?? '0', 10) > 8192) return new Response('Payload too large', { status: 413 });
      let body: { action?: unknown; design?: unknown; name?: unknown; project?: unknown };
      try { body = (await req.json()) as typeof body; } catch { return new Response('Bad JSON', { status: 400 }); }
      const action = typeof body.action === 'string' ? body.action : '';
      const design = typeof body.design === 'string' ? body.design : '';
      if (!design || design.includes('..') || path.isAbsolute(design)) return new Response('Bad design key', { status: 400 });
      const abs = path.join(PROJECTS_DIR, design);
      let result: { success?: boolean } & Record<string, unknown>;
      if (action === 'rename') result = renameDesign({ design_path: abs, new_name: typeof body.name === 'string' ? body.name : '' });
      else if (action === 'delete') result = deleteDesign({ design_path: abs });
      else if (action === 'move') result = moveDesign({ design_path: abs, target_project: typeof body.project === 'string' ? body.project : '' });
      else return new Response('Unknown action', { status: 400 });
      const ok = !!result.success;
      return new Response(JSON.stringify({ ok, ...result }), {
        status: ok ? 200 : 400, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

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

      // /issue-style strip: when a valid token rides in on ?token= and there's no
      // cookie yet, set the session cookie and 302 to the same path minus `token`,
      // so the secret leaves the address bar / history. No loop: the redirect
      // target has no token param (cookie carries auth on the follow-up request).
      if (qtoken && !cookie) {
        url.searchParams.delete('token');
        const dest = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '');
        return new Response(null, {
          status: 302,
          headers: {
            Location: dest,
            'Set-Cookie': `folio_session=${encodeURIComponent(qtoken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`,
          },
        });
      }

      const rel = url.pathname.slice('/__project_files/'.length);
      const target = safeJoinProject(rel);
      if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        return new Response('Not found', { status: 404 });
      }
      const body = fs.readFileSync(target);
      const headers: Record<string, string> = { 'Content-Type': mime(target), 'Cache-Control': 'no-store' };
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

      // ── /issue-style redirect (ported from the Harnesses auth service) ──
      // When a valid token rides in on ?token=, set the 30-day session cookie
      // and 302 to the SAME url with `token` stripped, so the secret leaves the
      // address bar (and browser history / referrer headers). The cookie carries
      // the session from here on. Looping is impossible: the redirect target has
      // no `token` param, so this branch can't fire on the follow-up request.
      if (qtoken && isValidToken(qtoken)) {
        url.searchParams.delete('token');
        const dest = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '');
        return new Response(null, {
          status: 302,
          headers: {
            Location: dest,
            'Set-Cookie': `folio_session=${encodeURIComponent(qtoken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`,
          },
        });
      }
    }

    // ── /library → the Design Library gallery ──────────────────────────
    // Friendly alias for the generated <projects>/library.html (a thumbnail
    // file-manager over every design). We redirect to the auth'd
    // /__project_files route rather than serve here, so the gallery's relative
    // thumbnail paths (.library/thumbs/*) resolve under the same prefix. Auth
    // has already passed above (cookie / bearer / token-strip), so a plain 302
    // carries the session cookie onto the follow-up request.
    if (url.pathname === '/library' || url.pathname === '/library.html') {
      return new Response(null, {
        status: 302,
        headers: { Location: '/__project_files/library.html', 'Cache-Control': 'no-store' },
      });
    }

    // Side-effect: when a ?token= is present on the initial editor load,
    // promote it to a folio_session cookie so subsequent navigation works
    // without the token in the URL. (Belt-and-suspenders: the redirect above
    // normally handles this; this still covers any path that reaches here with
    // a token but no cookie.)
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
    if (setSessionCookie) headers['Set-Cookie'] = setSessionCookie;
    if (target === INDEX_HTML) {
      // Inject the Library entry point into the editor shell (no dist rebuild).
      headers['Cache-Control'] = 'no-cache';
      const html = body.toString('utf8').replace('</body>', `${EDITOR_LIBRARY_BTN}</body>`);
      return new Response(html, { status: 200, headers });
    }
    if (target.includes('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    return new Response(body, { status: 200, headers });
  },
});

process.stderr.write(`[serve-static] serving ${DIST} on http://${HOST}:${PORT}\n`);
