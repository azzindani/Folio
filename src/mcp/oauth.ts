// §14c — OAuth 2.0 Authorization Code + PKCE flow for claude.ai's Custom
// Connector. Bridges a public OAuth surface to Folio's internal TokenRegistry:
// the access token issued by /oauth/token IS a fresh random string, but every
// MCP call presenting it is treated as if the underlying principal (the
// FOLIO_API_KEY / tokens.json entry the user typed at /authorize) signed it.
//
// Endpoints:
//   GET  /.well-known/oauth-authorization-server  — RFC 8414 metadata
//   GET  /.well-known/oauth-protected-resource    — RFC 9728 metadata
//   GET  /oauth/authorize                         — login form
//   POST /oauth/authorize                         — form submit → 302
//   POST /oauth/token                             — code → access_token
//   POST /oauth/register                          — RFC 7591 DCR (optional)
//
// State is in-memory only. Auth codes live 10 min, access tokens 24 h.
// Restart the process and connector users must reauthorize. For most
// single-tenant deployments that's fine.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type * as http from 'http';
import { loadTokens } from './auth';

// Disk-backed access-token store. In-memory only meant every container
// rebuild forced claude.ai to re-OAuth from scratch — annoying when the
// server bounces frequently. Auth codes stay in-memory (10 min TTL is
// shorter than any reasonable restart window, so the loss is invisible).
const STATE_DIR = process.env['FOLIO_OAUTH_STATE_DIR'] ?? path.join(process.env['FOLIO_PROJECTS_DIR'] ?? '/tmp', '.oauth-state');
const TOKENS_FILE = path.join(STATE_DIR, 'access-tokens.json');

function loadPersistedTokens(): Map<string, { principal: string; expires_at: number }> {
  try {
    if (!fs.existsSync(TOKENS_FILE)) return new Map();
    const raw = fs.readFileSync(TOKENS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, { principal: string; expires_at: number }>;
    const now = Date.now();
    const m = new Map<string, { principal: string; expires_at: number }>();
    for (const [k, v] of Object.entries(parsed)) {
      if (v.expires_at > now) m.set(k, v);
    }
    return m;
  } catch (err) {
    process.stderr.write(`[oauth] failed to load persisted tokens: ${(err as Error).message}\n`);
    return new Map();
  }
}

function persistTokens(tokens: Map<string, { principal: string; expires_at: number }>): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const obj: Record<string, { principal: string; expires_at: number }> = {};
    for (const [k, v] of tokens) obj[k] = v;
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(obj), 'utf-8');
  } catch (err) {
    process.stderr.write(`[oauth] failed to persist tokens: ${(err as Error).message}\n`);
  }
}

interface AuthCode {
  principal: string;
  redirect_uri: string;
  client_id: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  expires_at: number;
}

interface RegisteredClient {
  redirect_uris: string[];
  client_secret?: string;
  created_at: number;
}

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const authCodes = new Map<string, AuthCode>();
const accessTokens = loadPersistedTokens();
const registeredClients = new Map<string, RegisteredClient>();

// Seed a static client from env so deployments can pin a known
// client_id/secret pair without going through DCR. Both are optional:
// claude.ai's connector form accepts blank fields when DCR is supported.
const STATIC_CLIENT_ID = process.env['FOLIO_OAUTH_CLIENT_ID'] ?? 'claude-ai';
const STATIC_CLIENT_SECRET = process.env['FOLIO_OAUTH_CLIENT_SECRET'] ?? '';
registeredClients.set(STATIC_CLIENT_ID, {
  redirect_uris: ['*'],
  client_secret: STATIC_CLIENT_SECRET || undefined,
  created_at: Date.now(),
});

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256B64Url(input: string): string {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

function baseUrl(req: http.IncomingMessage): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim()
    ?? (req.socket && 'encrypted' in req.socket && (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers['host'] ?? 'localhost';
  return `${proto}://${host}`;
}

function reapExpired(): void {
  const now = Date.now();
  for (const [k, v] of authCodes) if (v.expires_at < now) authCodes.delete(k);
  let mutated = false;
  for (const [k, v] of accessTokens) if (v.expires_at < now) { accessTokens.delete(k); mutated = true; }
  if (mutated) persistTokens(accessTokens);
}

/**
 * Verify a bearer token came from /oauth/token. Returns the principal name
 * (matching auth.ts conventions) or null. Called from auth.ts as a second
 * pass when the direct TokenRegistry lookup misses.
 */
export function resolveOAuthToken(token: string): string | null {
  reapExpired();
  const rec = accessTokens.get(token);
  if (!rec) return null;
  if (rec.expires_at < Date.now()) { accessTokens.delete(token); return null; }
  return rec.principal;
}

/**
 * Mint a short-lived editor token. Used by open_in_editor so the URL it
 * returns is self-contained — opening it skips basic-auth, the editor
 * static-server validates the token, sets a session cookie, and the
 * subsequent /__project_files + /editor/events calls inherit access.
 * Default TTL 1h, override with FOLIO_EDITOR_TOKEN_TTL_MS.
 */
export function mintEditorToken(principal: string = 'default', ttlMs?: number): string {
  const envTtl = parseInt(process.env['FOLIO_EDITOR_TOKEN_TTL_MS'] ?? '', 10);
  const ttl = ttlMs ?? (Number.isFinite(envTtl) && envTtl > 0 ? envTtl : 60 * 60 * 1000);
  const tok = randomToken(24);
  accessTokens.set(tok, { principal, expires_at: Date.now() + ttl });
  persistTokens(accessTokens);
  return tok;
}

// ── Wire helpers ─────────────────────────────────────────────────────────

function setCORS(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => { data += c.toString('utf8'); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  setCORS(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function redirect(res: http.ServerResponse, location: string): void {
  setCORS(res);
  res.writeHead(302, { Location: location });
  res.end();
}

function html(res: http.ServerResponse, status: number, body: string): void {
  setCORS(res);
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

// Parse application/x-www-form-urlencoded body OR a query string.
function parseForm(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of s.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair).replace(/\+/g, ' ');
    const v = decodeURIComponent(eq >= 0 ? pair.slice(eq + 1) : '').replace(/\+/g, ' ');
    out[k] = v;
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// Look up a presented Folio API key. Reuses the existing TokenRegistry so
// either FOLIO_API_KEY or any tokens.json entry works at /oauth/authorize.
function lookupPrincipal(presented: string): string | null {
  const r = loadTokens();
  if (r.mode === 'open') return '__open__';
  return r.tokens.get(presented) ?? null;
}

// ── Endpoint: well-known metadata ────────────────────────────────────────

function handleMetadata(req: http.IncomingMessage, res: http.ServerResponse): void {
  const base = baseUrl(req);
  json(res, 200, {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['mcp'],
  });
}

function handleProtectedResource(req: http.IncomingMessage, res: http.ServerResponse): void {
  const base = baseUrl(req);
  json(res, 200, {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  });
}

// ── Endpoint: dynamic client registration (RFC 7591) ─────────────────────

async function handleRegister(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(await readBody(req)) as Record<string, unknown>; } catch { /* allow empty */ }
  const redirectUris = Array.isArray(body['redirect_uris']) ? body['redirect_uris'] as string[] : ['*'];
  const clientId = `folio-${randomToken(8)}`;
  // Public client (PKCE-only) by default — no secret unless the registration
  // explicitly asks for token_endpoint_auth_method !== "none".
  const wantsSecret = body['token_endpoint_auth_method'] && body['token_endpoint_auth_method'] !== 'none';
  const clientSecret = wantsSecret ? randomToken(32) : undefined;
  registeredClients.set(clientId, { redirect_uris: redirectUris, client_secret: clientSecret, created_at: Date.now() });
  json(res, 201, {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: clientSecret ? 'client_secret_post' : 'none',
  });
}

// ── Endpoint: GET /oauth/authorize → login form ──────────────────────────

function handleAuthorizeGet(req: http.IncomingMessage, res: http.ServerResponse, query: Record<string, string>): void {
  // Validate required params per RFC 6749. Missing/bad ones short-circuit
  // with a human-readable page so the connector setup is debuggable.
  const required = ['client_id', 'redirect_uri', 'response_type'];
  for (const k of required) {
    if (!query[k]) { html(res, 400, `<h1>Bad request</h1><p>Missing <code>${escapeHtml(k)}</code>.</p>`); return; }
  }
  if (query['response_type'] !== 'code') {
    html(res, 400, `<h1>Bad request</h1><p>Only <code>response_type=code</code> is supported.</p>`); return;
  }

  // PKCE is required for public clients; recommend it for all. We accept
  // requests without a code_challenge (e.g. an OAuth client using a secret)
  // but log a warning. Anthropic's connector always sends PKCE.
  const hidden = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method']
    .filter(k => query[k] !== undefined)
    .map(k => `<input type="hidden" name="${k}" value="${escapeHtml(query[k]!)}">`)
    .join('\n');

  html(res, 200, `<!doctype html>
<html><head><meta charset="utf-8"><title>Folio · Authorize</title>
<style>
  body{font-family:Inter,system-ui,sans-serif;background:#0e0e16;color:#e8e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#16182a;padding:32px;border-radius:12px;border:1px solid #2a2a4a;max-width:420px;width:100%}
  h1{margin:0 0 8px;font-size:20px;letter-spacing:-0.01em}
  p{color:#8892A4;font-size:14px;line-height:1.5;margin:0 0 16px}
  label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#8892A4;margin-bottom:6px}
  input{width:100%;padding:10px 12px;background:#0e0e16;border:1px solid #2a2a4a;border-radius:6px;color:#e8e8f0;font:14px Inter,sans-serif;box-sizing:border-box}
  button{margin-top:16px;width:100%;padding:10px;background:#E94560;color:white;border:0;border-radius:6px;font-weight:600;cursor:pointer}
  code{background:#0e0e16;padding:2px 6px;border-radius:4px;font-size:12px}
</style></head>
<body><div class="card">
<h1>Authorize Folio access</h1>
<p>Client <code>${escapeHtml(query['client_id']!)}</code> wants to use Folio MCP. Paste your Folio API key (the one set as <code>FOLIO_API_KEY</code> or a value from <code>tokens.json</code>).</p>
<form method="POST" action="/oauth/authorize">
${hidden}
<label for="api_key">Folio API Key</label>
<input id="api_key" name="api_key" type="password" autocomplete="off" required>
<button type="submit">Authorize</button>
</form>
</div></body></html>`);
}

// ── Endpoint: POST /oauth/authorize → issue code + redirect ──────────────

async function handleAuthorizePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = parseForm(await readBody(req));
  const apiKey = body['api_key'] ?? '';
  const principal = lookupPrincipal(apiKey);
  if (!principal) {
    html(res, 401, `<h1>Invalid API key</h1><p><a href="javascript:history.back()">Go back</a></p>`);
    return;
  }
  const clientId = body['client_id'] ?? '';
  const redirectUri = body['redirect_uri'] ?? '';
  const client = registeredClients.get(clientId);
  if (!client) {
    html(res, 400, `<h1>Unknown client_id</h1><p>Register first via <code>/oauth/register</code> or set <code>FOLIO_OAUTH_CLIENT_ID</code>.</p>`);
    return;
  }
  // Wildcard or exact-match redirect_uri check. claude.ai's redirect URI is
  // documented but we allow custom deployments via wildcard.
  if (!client.redirect_uris.includes('*') && !client.redirect_uris.includes(redirectUri)) {
    html(res, 400, `<h1>Invalid redirect_uri</h1>`);
    return;
  }

  const code = randomToken(32);
  authCodes.set(code, {
    principal,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_challenge: body['code_challenge'] || undefined,
    code_challenge_method: body['code_challenge_method'] || undefined,
    scope: body['scope'] || undefined,
    expires_at: Date.now() + AUTH_CODE_TTL_MS,
  });

  const u = new URL(redirectUri);
  u.searchParams.set('code', code);
  if (body['state']) u.searchParams.set('state', body['state']);
  redirect(res, u.toString());
}

// ── Endpoint: POST /oauth/token → exchange code for access_token ─────────

async function handleToken(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = parseForm(await readBody(req));
  if (body['grant_type'] !== 'authorization_code') {
    json(res, 400, { error: 'unsupported_grant_type', error_description: 'Only authorization_code is supported.' });
    return;
  }
  const code = body['code'] ?? '';
  const record = authCodes.get(code);
  if (!record || record.expires_at < Date.now()) {
    authCodes.delete(code);
    json(res, 400, { error: 'invalid_grant', error_description: 'Auth code is missing, expired, or already used.' });
    return;
  }
  // One-shot: delete on first read regardless of whether validation passes.
  authCodes.delete(code);

  if (body['redirect_uri'] !== record.redirect_uri) {
    json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch.' });
    return;
  }

  const client = registeredClients.get(record.client_id);
  // Confidential clients must present their secret. Public (PKCE-only)
  // clients prove possession via code_verifier instead.
  if (client?.client_secret) {
    if (body['client_secret'] !== client.client_secret) {
      json(res, 401, { error: 'invalid_client', error_description: 'client_secret mismatch.' });
      return;
    }
  }
  if (record.code_challenge) {
    const verifier = body['code_verifier'] ?? '';
    const method = record.code_challenge_method ?? 'plain';
    const computed = method === 'S256' ? sha256B64Url(verifier) : verifier;
    if (computed !== record.code_challenge) {
      json(res, 400, { error: 'invalid_grant', error_description: 'PKCE code_verifier mismatch.' });
      return;
    }
  }

  const accessToken = randomToken(32);
  accessTokens.set(accessToken, {
    principal: record.principal,
    expires_at: Date.now() + ACCESS_TOKEN_TTL_MS,
  });
  // Persist so a container rebuild doesn't force claude.ai to re-OAuth.
  persistTokens(accessTokens);
  json(res, 200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: record.scope ?? 'mcp',
  });
}

// ── Dispatch ─────────────────────────────────────────────────────────────

/**
 * Try to handle an OAuth or well-known endpoint. Returns true if the URL
 * matched and a response was written; false to fall through to the next
 * router stage.
 */
export async function handleOAuth(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';
  const path = url.split('?')[0] ?? url;
  const query = parseForm((url.split('?')[1] ?? ''));

  if (method === 'OPTIONS' && (path.startsWith('/oauth/') || path.startsWith('/.well-known/oauth-'))) {
    setCORS(res); res.writeHead(204); res.end(); return true;
  }

  if (method === 'GET' && path === '/.well-known/oauth-authorization-server') { handleMetadata(req, res); return true; }
  if (method === 'GET' && path === '/.well-known/oauth-protected-resource')   { handleProtectedResource(req, res); return true; }
  if (method === 'POST' && path === '/oauth/register')   { await handleRegister(req, res); return true; }
  if (method === 'GET'  && path === '/oauth/authorize')  { handleAuthorizeGet(req, res, query); return true; }
  if (method === 'POST' && path === '/oauth/authorize')  { await handleAuthorizePost(req, res); return true; }
  if (method === 'POST' && path === '/oauth/token')      { await handleToken(req, res); return true; }
  return false;
}
