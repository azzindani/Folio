// Editor-server auth + session helpers. Split out of static-server.ts to keep it
// under the 700-line budget AND to centralise the token model the SLIDING session
// builds on. Pure (fs + the side-effect-free HS256 jwt module) — no server start.
//
// Session model: a link's token is a short-lived HS256 JWT (editorSessionTtlMs,
// default 30 min). It SLIDES — every active request re-mints the cookie via
// slidingSessionCookie(), so the editor's 30-second auto-save heartbeat keeps an
// open session alive indefinitely, while 30 min of inactivity lets it lapse.
// Reopening a design from the Library mints a brand-new window. No login, no IP.
import * as path from 'path';
import * as fs from 'fs';
import { verifyJwt, signJwt, jwtSecret, editorSessionTtlMs } from '../mcp/jwt';

// OAuth-issued / open_in_editor access tokens (access-tokens.json, expiring).
// Read live so a token minted by the MCP process in the same container is seen.
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

// Static "lab" bearer tokens — the SAME secrets the MCP + Harnesses lab use
// (FOLIO_TOKENS_FILE / FOLIO_TOKENS / FOLIO_API_KEY). One token opens both the
// MCP and the editor. These never expire (they're long-lived operator keys).
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

/** True when ANY auth is configured. False → the editor serves openly (same
 *  posture as the MCP's unauthenticated mode) so a local run isn't locked out. */
export function authConfigured(): boolean {
  return loadStaticTokens().size > 0 || !!jwtSecret();
}

/** Validate a presented token: OAuth access token, static lab bearer, or a
 *  stateless HS256 JWT / the raw secret as master bearer. */
export function isValidToken(token: string): boolean {
  if (!token) return false;
  const rec = loadValidTokens().get(token);
  if (rec && rec.expires_at > Date.now()) return true;
  if (loadStaticTokens().has(token)) return true;
  const secret = jwtSecret();
  if (secret && (token === secret || verifyJwt(token, secret).ok)) return true;
  return false;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [k, ...rest] = pair.trim().split('=');
    if (k) out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

/** The token presented on a request — Bearer header, ?token= query, or the
 *  folio_session cookie, in that precedence. (DRYs the ~6 routes that need it.) */
export function presentedToken(req: Request, url: URL): string {
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const qtoken = url.searchParams.get('token') ?? '';
  const cookie = parseCookies(req.headers.get('cookie') ?? undefined)['folio_session'] ?? '';
  return bearer || qtoken || cookie;
}

/** Set-Cookie value carrying `token` for one session window (Max-Age = TTL). */
export function sessionCookieHeader(token: string): string {
  const maxAge = Math.floor(editorSessionTtlMs() / 1000);
  return `folio_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

/** A fresh editor-session JWT (goes in ?token / the cookie). Empty when no
 *  secret is configured (open mode — no token needed). */
export function mintSessionToken(): string {
  const secret = jwtSecret();
  return secret ? signJwt({ sub: 'default', kind: 'editor' }, secret, Math.floor(editorSessionTtlMs() / 1000)) : '';
}

/** SLIDING refresh: given the token on an authenticated request, re-mint a fresh
 *  session JWT and return a Set-Cookie that resets the 30-min window — so active
 *  use never lapses. Returns null when there's nothing to slide: open mode, the
 *  raw master secret, a non-JWT (opaque) token, or an already-expired/invalid one. */
export function slidingSessionCookie(presented: string): string | null {
  if (!presented) return null;
  const secret = jwtSecret();
  if (!secret || presented === secret) return null;
  if (!verifyJwt(presented, secret).ok) return null;
  return sessionCookieHeader(signJwt({ sub: 'default', kind: 'editor' }, secret, Math.floor(editorSessionTtlMs() / 1000)));
}
