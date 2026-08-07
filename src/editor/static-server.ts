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
// Auth + session helpers (token validation, cookie parsing, and the SLIDING
// 30-min session: short-lived link tokens that active use / reopening renews).
// Pure (fs + side-effect-free HS256 jwt) — no server start, no IO at import.
import {
  authConfigured, isValidToken, parseCookies, presentedToken,
  sessionCookieHeader, mintSessionToken, mintOutputToken, slidingSessionCookie,
} from './editor-auth';
// Pure, side-effect-free resolver (fs + a hash only) — maps a short /o/<code>
// back to the design path so we can 302 to the full tokenized editor URL.
import { resolveShortLink } from '../mcp/engine/short-link';
// Pure fs overlay (no engine.ts side effects) — lets the gallery persist a
// design's collection from the browser/phone via POST /__library/assign.
import { assignDesign } from '../mcp/engine/library-collections';
// Filesystem ops (pure fs + YAML, no rendering) — rename / delete(→trash) /
// move, surfaced to the gallery via POST /__library/manage.
import { renameDesign, deleteDesign, moveDesign } from '../mcp/engine/library-manage';
// Folder (project-directory) ops — create / rename / delete(→trash), surfaced
// to the gallery via POST /__library/folder.
import { createFolder, renameFolder, deleteFolder, type FolderResult } from '../mcp/engine/library-folders';
// Live Design Library — scan the whole collection on every request (always
// current) + render/cache thumbnails on demand. The page builder is shared with
// the export_library_gallery snapshot; here we serve it live at /library.
import { collectLibrary } from '../mcp/engine/library';
import { buildLibraryPage, renderThumb, thumbFileName, renderCardForDesign } from '../mcp/engine/library-gallery';
import { loadCollections, allCollections } from '../mcp/engine/library-collections';
// Front-door guards: IP allow-list ("only me, even if the link leaks, no login"),
// per-IP rate limit (flood shield), and a concurrency cap on expensive ops
// (thumbnail render / library scan) so the single-core container can't collapse.
import { clientIp, ipAllowed, loadEditorGuards } from '../mcp/access-guard';
// Asset ingest — same path the MCP manage_design {op:"asset_add"} uses.
import { listAssets, manageAssets, uploadAsset } from './server-assets';
// Shared inline favicon so server-rendered pages get the same tab icon as the editor.
import { FAVICON_LINK } from '../utils/favicon';

const GUARDS = loadEditorGuards();

// Shown when the editor is opened without a valid token (no Bearer / ?token= /
// cookie). Replaces the reverse-proxy's HTTP Basic Auth prompt with a plain
// token model — no username/password.
const UNAUTHORIZED_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Folio — access token required</title>${FAVICON_LINK}
<style>body{font:16px/1.55 system-ui,-apple-system,sans-serif;background:#0A0E27;color:#E8F0FF;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:440px;padding:36px;background:#141A3A;border-radius:18px}h2{margin:0 0 12px}code{background:#0A0E27;padding:2px 7px;border-radius:6px;color:#22D3EE}p{color:#B8C0D9}</style></head>
<body><div class="card"><h2>Folio editor</h2><p>This editor is protected by an access token. Open it with your token appended to the URL:</p><p><code>?token=YOUR_TOKEN</code></p><p>The link returned by <code>open_in_editor</code> already includes one. After the first load your session is remembered for 30 days — no username or password.</p></div></body></html>`;

// No drop-shadows in the editor chrome (a design preference). Rather than
// rebuild the bundle, inject an override that strips box-shadow from every HTML
// element EXCEPT inside an <svg> — so a rendered design's own shadow effects
// (SVG filters aside, any foreignObject HTML) are preserved.
const EDITOR_NO_SHADOW = `<style>*:not(svg):not(svg *){box-shadow:none!important}</style>`;

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
var lib=cat.cloneNode(true);lib.id=ID;lib.removeAttribute('data-action');
lib.setAttribute('title','Open the cross-project Design Library');lib.setAttribute('aria-label','Open the Design Library');
/* Keep the cloned button's icon+label structure (don't nuke it via textContent),
   so Library matches its toolbar siblings and collapses to icon-only on mobile.
   Swap the catalog grid glyph for a distinct stacked-shelves icon. */
var svg=lib.querySelector('svg');if(svg){svg.innerHTML='<rect x="1.5" y="2" width="11" height="3" rx="0.5" stroke="currentColor" stroke-width="1.2"/><rect x="1.5" y="5.5" width="11" height="3" rx="0.5" stroke="currentColor" stroke-width="1.2"/><rect x="1.5" y="9" width="11" height="3" rx="0.5" stroke="currentColor" stroke-width="1.2"/>';}
var span=lib.querySelector('span');if(span){span.textContent='Library';}else{lib.appendChild(document.createTextNode('Library'));}
lib.addEventListener('click',go);cat.parentNode.insertBefore(lib,cat.nextSibling);return true;}
function fallback(){if(document.getElementById(ID))return;var a=document.createElement('a');a.id=ID;a.href='/library';a.target='_blank';a.rel='noopener';a.textContent='▦ Library';
a.style.cssText='position:fixed;left:12px;bottom:12px;z-index:2147483000;padding:8px 12px;border-radius:10px;background:#161B22;color:#C9D2E3;border:1px solid #2A323F;font:600 12px system-ui,sans-serif;text-decoration:none';document.body.appendChild(a);}
var n=0,iv=setInterval(function(){n++;if(inject()||n>40){clearInterval(iv);if(!document.getElementById(ID))fallback();
try{new MutationObserver(function(){if(!document.getElementById(ID))inject();}).observe(document.body,{childList:true,subtree:true});}catch(e){}}},250);})();</script>`;

const PORT = parseInt(process.env['PORT'] ?? '4173', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const DIST = path.resolve(process.env['FOLIO_DIST_DIR'] ?? 'dist');
// Mount FOLIO_PROJECTS_DIR at /__project_files/* so the editor can fetch a
// design YAML by relative path. Going through this route (rather than Caddy's
// /files/*) guarantees the request inherits whatever auth the editor itself
// has, since both share the catch-all editor handler.
const PROJECTS_DIR = path.resolve(process.env['FOLIO_PROJECTS_DIR'] ?? './folio-projects');
// Cap a PUT /__project_files write — a design can embed base64 images, so this
// is generous, but bounds a single write so a runaway body can't exhaust the heap.
const MAX_DESIGN_BYTES = Number(process.env['FOLIO_MAX_DESIGN_BYTES'] ?? 20 * 1024 * 1024);

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

interface BunServer { requestIP?: (req: Request) => { address: string } | null }
declare const Bun: { serve: (opts: {
  port: number; hostname: string;
  fetch: (req: Request, server: BunServer) => Promise<Response> | Response;
}) => unknown };

function safeJoinProject(rel: string): string | null {
  const clean = rel.replace(/\?.*$/, '').replace(/#.*$/, '');
  const decoded = decodeURIComponent(clean);
  const joined = path.normalize(path.join(PROJECTS_DIR, decoded));
  if (!joined.startsWith(PROJECTS_DIR)) return null;
  return joined;
}

// ── Live Design Library SSE hub ────────────────────────────────────────────
// ONE shared poller (lazy: runs only while ≥1 /library tab is connected) walks
// the projects dir every few seconds, diffs against the previous snapshot, and
// PUSHES add / update / remove card events to every connected tab — so a newly
// sealed design slides into the grid with no page reload (the old poll+reload
// flashed the whole page). fs-only scan; the per-design header read happens only
// for the handful that actually changed.
interface LibClient { ctrl: ReadableStreamDefaultController<Uint8Array>; }
const libClients = new Set<LibClient>();
const LIB_MAX_CLIENTS = 64;
const LIB_ENC = new TextEncoder();
let libPrev: Map<string, number> | null = null;        // relKey → mtimeMs
let libTimer: ReturnType<typeof setInterval> | null = null;

function libScan(): Map<string, number> {
  const m = new Map<string, number>();
  let ents: import('fs').Dirent[] = [];
  try { ents = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }); } catch { return m; }
  for (const ent of ents) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const dd = path.join(PROJECTS_DIR, ent.name, 'designs');
    let files: string[] = [];
    try { files = fs.readdirSync(dd).filter(f => f.endsWith('.design.yaml')); } catch { continue; }
    for (const f of files) {
      try { m.set(`${ent.name}/designs/${f}`, fs.statSync(path.join(dd, f)).mtimeMs); } catch { /* gone mid-scan */ }
    }
  }
  return m;
}

function libEmit(ev: string, data: string): void {
  const frame = LIB_ENC.encode(`event: ${ev}\ndata: ${data}\n\n`);
  for (const c of [...libClients]) { try { c.ctrl.enqueue(frame); } catch { libClients.delete(c); } }
}

function libTick(): void {
  const cur = libScan();
  if (libPrev) {
    const collState = loadCollections(PROJECTS_DIR);
    const cols = allCollections(collState);
    const thumbHref = (key: string): string => `/__library/thumb?d=${encodeURIComponent(key)}`;
    for (const [key, mt] of cur) {
      const prev = libPrev.get(key);
      if (prev === mt) continue;
      if (prev === undefined) {
        const c = renderCardForDesign({ root: PROJECTS_DIR, designPath: path.join(PROJECTS_DIR, key), collState, cols, thumbHref });
        if (c) libEmit('add', JSON.stringify({ key, html: c.html }));
      } else {
        libEmit('update', JSON.stringify({ key, t: Math.floor(mt) }));     // thumbnail changed → bust src
      }
    }
    for (const key of libPrev.keys()) if (!cur.has(key)) libEmit('remove', JSON.stringify({ key }));
  }
  libPrev = cur;
  // Heartbeat: a comment keeps the stream alive through proxies when idle.
  const ping = LIB_ENC.encode(`: ping\n\n`);
  for (const c of [...libClients]) { try { c.ctrl.enqueue(ping); } catch { libClients.delete(c); } }
}

function libStart(): void { if (!libTimer) { libPrev = libScan(); libTimer = setInterval(libTick, 3000); } }
function libStop(): void { if (libTimer) { clearInterval(libTimer); libTimer = null; } libPrev = null; }

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req, server) {
    const url = new URL(req.url);
    const ip = clientIp(req.headers.get('x-forwarded-for'), server?.requestIP?.(req)?.address);

    // ── GET /__ip — report the IP we resolve the caller as, so the operator can
    // populate FOLIO_ALLOW_IPS. Deliberately exempt from the allow-list + auth:
    // it only ever reveals the caller's OWN address (which they already control).
    if (url.pathname === '/__ip') {
      return new Response(JSON.stringify({ ip, allow_list_active: GUARDS.allowListActive }), {
        status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    // ── IP allow-list — the "only me, even if the link leaks, no login" gate.
    // When FOLIO_ALLOW_IPS is set, a request from any other IP is refused BEFORE
    // the short-link / auth / static handlers, so a leaked URL is inert
    // off-network. Unset → open (unchanged default).
    if (!ipAllowed(ip, GUARDS.allow)) {
      process.stderr.write(`[serve-static] BLOCKED ip=${ip} ${req.method} ${url.pathname}\n`);
      return new Response('Forbidden — this Folio instance is restricted to allow-listed addresses.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }

    // ── Per-IP rate limit — shed a flood cheaply (429 + Retry-After) so one
    // client's burst can't monopolise the single-threaded server. Generous burst
    // (a page load is many small assets); an SSE stream costs one token to open,
    // then runs free.
    if (GUARDS.limiter) {
      const dec = GUARDS.limiter.take(ip, Date.now());
      if (!dec.ok) {
        const retryS = Math.max(1, Math.ceil(dec.retryAfterMs / 1000));
        return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': String(retryS), 'Cache-Control': 'no-store' } });
      }
    }

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
      // Ephemeral output token for the redirect; the strip step upgrades the
      // landing to a durable 30-day session cookie.
      const tok = mintOutputToken();
      if (tok) p.set('token', tok);
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

    // ── POST /__library/folder — create / rename / delete a folder (project) ──
    // The directory half of the file-manager. Same token auth + body cap as the
    // other /__library/* mutations; ops live in library-folders.ts (name-validated,
    // delete → recoverable root .trash). Designs inside a renamed/deleted folder
    // re-sync through the SSE hub automatically (their paths changed).
    if (url.pathname === '/__library/folder' && req.method === 'POST') {
      const auth = req.headers.get('authorization') ?? '';
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const qtoken = url.searchParams.get('token') ?? '';
      const cookie = parseCookies(req.headers.get('cookie') ?? undefined)['folio_session'] ?? '';
      const presented = bearer || qtoken || cookie;
      if (!presented || !isValidToken(presented)) return new Response('Unauthorized', { status: 401 });
      if (parseInt(req.headers.get('content-length') ?? '0', 10) > 8192) return new Response('Payload too large', { status: 413 });
      let body: { action?: unknown; name?: unknown; new_name?: unknown };
      try { body = (await req.json()) as typeof body; } catch { return new Response('Bad JSON', { status: 400 }); }
      const action = typeof body.action === 'string' ? body.action : '';
      const name = typeof body.name === 'string' ? body.name : '';
      const newName = typeof body.new_name === 'string' ? body.new_name : '';
      let result: FolderResult;
      if (action === 'create') result = createFolder(PROJECTS_DIR, name);
      else if (action === 'rename') result = renameFolder(PROJECTS_DIR, name, newName);
      else if (action === 'delete') result = deleteFolder(PROJECTS_DIR, name);
      else return new Response('Unknown action', { status: 400 });
      return new Response(JSON.stringify({ ok: result.success, ...result }), {
        status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    // ── GET /__library/thumb?d=<relKey> — render+cache a design thumbnail ──
    // Live preview for the /library gallery: rasterize the design's first page
    // to a small PNG on demand, cache under <projects>/.library/thumbs/ keyed by
    // the design's mtime, and 304 when the browser already holds the current
    // one. 404 when the design can't render (the card shows "no preview"). Same
    // cookie/bearer/token auth as the rest of /__library/*.
    if (url.pathname === '/__library/thumb' && req.method === 'GET') {
      const auth = req.headers.get('authorization') ?? '';
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const qtoken = url.searchParams.get('token') ?? '';
      const cookie = parseCookies(req.headers.get('cookie') ?? undefined)['folio_session'] ?? '';
      const presented = bearer || qtoken || cookie;
      if (authConfigured() && (!presented || !isValidToken(presented))) return new Response('Unauthorized', { status: 401 });
      const d = url.searchParams.get('d') ?? '';
      if (!d || d.includes('..') || path.isAbsolute(d)) return new Response('Bad design key', { status: 400 });
      const abs = safeJoinProject(d);
      if (!abs || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return new Response('Not found', { status: 404 });
      const mtime = Math.floor(fs.statSync(abs).mtimeMs);
      const etag = `"t${mtime}"`;
      if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-cache' } });
      const thumbsDir = path.join(PROJECTS_DIR, '.library', 'thumbs');
      const cachePath = path.join(thumbsDir, thumbFileName(abs));
      let png: Buffer | null = null;
      try { if (fs.existsSync(cachePath) && fs.statSync(cachePath).mtimeMs >= mtime) png = fs.readFileSync(cachePath); } catch { /* re-render below */ }
      if (!png) {
        // Rasterizing blocks the single event loop; cap concurrent renders so a
        // burst of cache-misses can't pile up. Cache hits above skip the gate.
        if (!GUARDS.heavy.tryAcquire()) return new Response('Server busy — retry shortly', { status: 503, headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' } });
        try { png = renderThumb(abs); }
        finally { GUARDS.heavy.release(); }
        if (png) { try { fs.mkdirSync(thumbsDir, { recursive: true }); fs.writeFileSync(cachePath, png); } catch { /* serve uncached */ } }
      }
      if (!png) return new Response('No preview', { status: 404 });
      // Wrap in a fresh ArrayBuffer-backed view: renderThumb's Buffer is typed
      // Buffer<ArrayBufferLike>, which a SharedArrayBuffer could back and so is
      // not a valid BodyInit; a copied Uint8Array always is.
      return new Response(new Uint8Array(png), { status: 200, headers: { 'Content-Type': 'image/png', ETag: etag, 'Cache-Control': 'no-cache' } });
    }

    // ── GET /__library/stat — cheap {count,newest} signature for live refresh ──
    // The /library page polls this every few seconds; when count or the newest
    // mtime changes (a design was just sealed), it auto-refreshes so new work
    // appears on its own. fs-only stat walk — no YAML parse — so it stays cheap
    // even when polled by several open tabs.
    if (url.pathname === '/__library/stat' && req.method === 'GET') {
      const auth = req.headers.get('authorization') ?? '';
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const qtoken = url.searchParams.get('token') ?? '';
      const cookie = parseCookies(req.headers.get('cookie') ?? undefined)['folio_session'] ?? '';
      const presented = bearer || qtoken || cookie;
      if (authConfigured() && (!presented || !isValidToken(presented))) return new Response('Unauthorized', { status: 401 });
      let count = 0, newest = 0;
      try {
        for (const ent of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
          if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
          const dd = path.join(PROJECTS_DIR, ent.name, 'designs');
          let files: string[] = [];
          try { files = fs.readdirSync(dd).filter(f => f.endsWith('.design.yaml')); } catch { continue; }
          for (const f of files) { count++; try { newest = Math.max(newest, fs.statSync(path.join(dd, f)).mtimeMs); } catch { /* gone mid-scan */ } }
        }
      } catch { /* no projects dir */ }
      return new Response(JSON.stringify({ count, newest: newest ? new Date(newest).toISOString() : '' }), {
        status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    // ── GET /__library/events — SSE stream of live design add/update/remove ──
    // The /library page subscribes here; the shared poller pushes a card's HTML
    // on create, a cache-bust on thumbnail change, and a key on delete, so open
    // tabs update IN PLACE with no reload (kills the old poll+reload blink).
    if (url.pathname === '/__library/events' && req.method === 'GET') {
      const auth = req.headers.get('authorization') ?? '';
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const qtoken = url.searchParams.get('token') ?? '';
      const cookie = parseCookies(req.headers.get('cookie') ?? undefined)['folio_session'] ?? '';
      const presented = bearer || qtoken || cookie;
      if (authConfigured() && (!presented || !isValidToken(presented))) return new Response('Unauthorized', { status: 401 });
      if (libClients.size >= LIB_MAX_CLIENTS) return new Response('Too many live clients', { status: 503 });
      let self: LibClient | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          self = { ctrl };
          libClients.add(self);
          libStart();
          try { ctrl.enqueue(LIB_ENC.encode(`retry: 5000\n: connected\n\n`)); } catch { /* client already gone */ }
        },
        cancel() {
          if (self) libClients.delete(self);
          if (libClients.size === 0) libStop();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
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
      // Sliding session: every authenticated hit renews the window. The editor
      // auto-saves here every ~30s, so an OPEN editor never lapses; once it's
      // closed, the last window runs out and the link self-expires.
      const refresh = slidingSessionCookie(presented);

      // ── GET /__project_files/<project>/__assets — asset listing for the
      // editor asset panel. Same manifest+disk merge the MCP asset_list op
      // uses (collectAssets), so panel and model always see the same set.
      if (req.method === 'GET') {
        const assetsListMatch = url.pathname.slice('/__project_files/'.length).match(/^([^/]+)\/__assets$/);
        if (assetsListMatch) {
          let projName = assetsListMatch[1];
          try { projName = decodeURIComponent(projName); } catch { /* keep raw */ }
          const projectDir = safeJoinProject(projName);
          if (!projectDir || !fs.existsSync(projectDir)) {
            return new Response(JSON.stringify({ ok: false, assets: [] }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
          }
          return listAssets(projectDir, refresh);
        }
      }

      // ── PUT/POST: write a design's YAML back to disk ────────────────────
      // The editor's server-backed auto-save + "Save to Library" land here.
      // Creates the parent project dir for a brand-new design. Only
      // *.design.yaml may ever be written — never an arbitrary file. The live
      // library SSE poller picks up the mtime change and refreshes open tabs.
      if (req.method === 'PUT' || req.method === 'POST') {
        const rawRel = url.pathname.slice('/__project_files/'.length);
        const target = safeJoinProject(rawRel);
        let relDecoded = rawRel;
        try { relDecoded = decodeURIComponent(rawRel); } catch { /* keep raw */ }

        // ── Asset upload: POST /__project_files/<project>/assets/<kind>/<file>
        // Raw bytes in, plain file + manifest entry out (same ingest the MCP
        // op uses: sanitize, type allowlist, per-file + per-project caps,
        // svg script strip, dims + dominant colors).
        // ── Asset manage: POST /__project_files/<project>/__assets/manage ──
        // {op:"delete"|"move", asset_path, folder?, new_name?} — the file-manager
        // verbs, sharing the exact engine functions the MCP ops use so the panel
        // and the model can never drift apart.
        const manageMatch = relDecoded.match(/^([^/]+)\/__assets\/manage$/);
        if (manageMatch) {
          const projectDir = safeJoinProject(manageMatch[1]);
          if (!projectDir || !fs.existsSync(projectDir)) {
            return new Response(JSON.stringify({ ok: false, error: `No such project: ${manageMatch[1]}` }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
          }
          return manageAssets(req, projectDir, refresh);
        }

        const assetMatch = relDecoded.match(/^([^/]+)\/assets\/(images|icons|fonts|docs)\/(?:([^/]+)\/)?([^/]+)$/);
        if (assetMatch && target && !relDecoded.includes('..')) {
          const projectDir = safeJoinProject(assetMatch[1]);
          if (!projectDir || !fs.existsSync(projectDir)) {
            return new Response(JSON.stringify({ ok: false, error: `No such project: ${assetMatch[1]}` }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
          }
          return uploadAsset(req, url, projectDir, assetMatch[2] ?? 'images', assetMatch[3], assetMatch[4] ?? '', refresh);
        }

        if (!target || relDecoded.includes('..') || !relDecoded.endsWith('.design.yaml')) {
          return new Response('Only *.design.yaml or assets/* may be written', { status: 400 });
        }
        if (parseInt(req.headers.get('content-length') ?? '0', 10) > MAX_DESIGN_BYTES) {
          return new Response('Payload too large', { status: 413 });
        }
        let yaml: string;
        try { yaml = await req.text(); } catch { return new Response('Bad body', { status: 400 }); }
        if (yaml.length === 0) return new Response('Empty body', { status: 400 });
        if (yaml.length > MAX_DESIGN_BYTES) return new Response('Payload too large', { status: 413 });
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, yaml, 'utf-8');
        } catch { return new Response('Write failed', { status: 500 }); }
        return new Response(JSON.stringify({ ok: true, path: relDecoded }), {
          status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(refresh ? { 'Set-Cookie': refresh } : {}) },
        });
      }

      // /issue-style strip: when a valid token rides in on ?token= and there's no
      // cookie yet, set the session cookie and 302 to the same path minus `token`,
      // so the secret leaves the address bar / history. The cookie is a FRESH
      // durable 30-day session token — NOT the (maybe 30-min output) token that
      // brought us here — so opening an output link grants the always-on session.
      if (qtoken && !cookie) {
        url.searchParams.delete('token');
        const dest = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '');
        return new Response(null, {
          status: 302,
          headers: { Location: dest, 'Set-Cookie': sessionCookieHeader(mintSessionToken()) },
        });
      }

      const rel = url.pathname.slice('/__project_files/'.length);
      const target = safeJoinProject(rel);
      if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        return new Response('Not found', { status: 404 });
      }
      const body = fs.readFileSync(target);
      const headers: Record<string, string> = { 'Content-Type': mime(target), 'Cache-Control': 'no-store' };
      if (refresh) headers['Set-Cookie'] = refresh;
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
          headers: { Location: dest, 'Set-Cookie': sessionCookieHeader(mintSessionToken()) },
        });
      }
    }

    // Sliding session for the authenticated navigation below (editor shell +
    // /library): renew the 30-min window on each load so browsing keeps it alive.
    const sessRefresh = slidingSessionCookie(presentedToken(req, url));

    // ── /library → the LIVE Design Library gallery ─────────────────────
    // Rendered fresh on every request: collectLibrary scans the whole projects
    // dir (cheap header parse), so a design sealed seconds ago is already here —
    // no re-export needed. Each card points at /__library/thumb (rendered +
    // cached on demand), and the page polls /__library/stat to auto-refresh
    // when new work lands. Auth already passed above (editor gate); the cookie
    // it set rides along on the thumb/stat fetches.
    if (url.pathname === '/library' || url.pathname === '/library.html') {
      // collectLibrary scans the whole projects tree — cap concurrent scans so a
      // burst of /library hits can't pile up and peg the container.
      if (!GUARDS.heavy.tryAcquire()) return new Response('Server busy — retry shortly', { status: 503, headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' } });
      try {
        const { projects, totalProjects, totalDesigns } = collectLibrary({ sort: 'modified', includeLinks: true });
        const collState = loadCollections(PROJECTS_DIR);
        // ?partial=grid → just the card markup, for the SSE client's reconnect resync.
        const gridOnly = url.searchParams.get('partial') === 'grid';
        const html = buildLibraryPage({
          projects, totalProjects, totalDesigns, root: PROJECTS_DIR,
          cols: allCollections(collState), collState,
          thumbHref: (_d, key) => `/__library/thumb?d=${encodeURIComponent(key)}`,
          live: true, gridOnly,
        });
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...(sessRefresh ? { 'Set-Cookie': sessRefresh } : {}) } });
      } finally { GUARDS.heavy.release(); }
    }

    // Side-effect: when a ?token= is present on the initial editor load,
    // promote it to a folio_session cookie so subsequent navigation works
    // without the token in the URL. (Belt-and-suspenders: the redirect above
    // normally handles this; this still covers any path that reaches here with
    // a token but no cookie.)
    const initialToken = url.searchParams.get('token');
    const hasSessionCookie = !!parseCookies(req.headers.get('cookie') ?? undefined)['folio_session'];
    const setSessionCookie = initialToken && isValidToken(initialToken) && !hasSessionCookie
      ? sessionCookieHeader(mintSessionToken())
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
      // Slide the session on each shell load (when not already setting one from a
      // ?token first-load), so an open/reopened editor keeps its 30-min window.
      if (!setSessionCookie && sessRefresh) headers['Set-Cookie'] = sessRefresh;
      const html = body.toString('utf8').replace('</body>', `${EDITOR_NO_SHADOW}${EDITOR_LIBRARY_BTN}</body>`);
      return new Response(html, { status: 200, headers });
    }
    if (target.includes('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    return new Response(body, { status: 200, headers });
  },
});

process.stderr.write(`[serve-static] serving ${DIST} on http://${HOST}:${PORT}\n`);
process.stderr.write(`[serve-static] access guards: ip-allow-list=${GUARDS.allowListActive ? 'ON' : 'off'} · rate-limit=${GUARDS.limiter ? `${GUARDS.limiter.burst} burst/${GUARDS.limiter.perSec}/s per IP` : 'off'} · heavy-concurrency=${GUARDS.heavy.max || 'unlimited'}\n`);
if (GUARDS.limiter) setInterval(() => GUARDS.limiter!.sweep(Date.now()), 60_000).unref();
