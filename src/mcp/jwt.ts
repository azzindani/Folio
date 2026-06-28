// §14c — Dependency-free HS256 JWT, modelled on the Harnesses lab auth service.
//
// Folio used opaque random tokens validated by a server-side lookup (the
// OAuth access-token store + the static FOLIO_TOKENS set). The Harnesses lab
// instead signs short HS256 JWTs with a shared secret and validates them
// STATELESSLY — verify the signature + `exp`, no store to consult, no file to
// grow. This module ports that model so Folio's editor links can be
// self-describing 30-day tokens instead of 1h entries in access-tokens.json.
//
// Pure by design: every function takes the secret as an argument and performs
// no module-level side effects (no server start, no file IO at import), so the
// editor static-server can import it without pulling in MCP/OAuth side effects.
//
// HS256 only — symmetric, one shared secret, exactly what the lab uses. No RS256
// (no keypair to manage for a single-operator deployment).
import * as crypto from 'crypto';

export interface JwtPayload {
  /** Subject — the principal/token name (Folio's analogue of the lab `harness` claim). */
  sub?: string;
  /** Issued-at (epoch seconds). */
  iat?: number;
  /** Expiry (epoch seconds). Verification fails once `now >= exp`. */
  exp?: number;
  [claim: string]: unknown;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmac(input: string, secret: string): Buffer {
  return crypto.createHmac('sha256', secret).update(input).digest();
}

/**
 * Sign a payload as an HS256 JWT.
 * @param claims  payload claims; `iat`/`exp` are filled from ttlSeconds if absent.
 * @param secret  shared HMAC secret.
 * @param ttlSeconds  lifetime; sets `exp = now + ttlSeconds` (omit/<=0 → no exp).
 * @param nowSeconds  injectable clock (epoch seconds) for deterministic tests.
 */
export function signJwt(
  claims: JwtPayload,
  secret: string,
  ttlSeconds: number,
  nowSeconds?: number,
): string {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const payload: JwtPayload = { iat: now, ...claims };
  if (ttlSeconds > 0 && payload.exp === undefined) payload.exp = now + ttlSeconds;
  const header = b64urlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = b64urlEncode(hmac(`${header}.${body}`, secret));
  return `${header}.${body}.${sig}`;
}

export type JwtResult =
  | { ok: true; payload: JwtPayload }
  | { ok: false; reason: 'malformed' | 'bad_alg' | 'bad_signature' | 'expired' };

/**
 * Verify an HS256 JWT against the secret. Stateless: checks structure,
 * algorithm, signature (constant-time), and `exp`. Returns the decoded
 * payload on success. A token with no `exp` never expires (matches the lab's
 * master-secret convenience tokens).
 */
export function verifyJwt(token: string, secret: string, nowSeconds?: number): JwtResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [header, body, sig] = parts;

  let head: { alg?: string };
  try {
    head = JSON.parse(b64urlDecode(header).toString('utf-8')) as { alg?: string };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (head.alg !== 'HS256') return { ok: false, reason: 'bad_alg' };

  const expected = b64urlEncode(hmac(`${header}.${body}`, secret));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf-8')) as JwtPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && now >= payload.exp) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}

/** True when the token is a structurally-valid, unexpired HS256 JWT for `secret`. */
export function isValidJwt(token: string, secret: string, nowSeconds?: number): boolean {
  return verifyJwt(token, secret, nowSeconds).ok;
}

/**
 * Resolve the shared JWT secret from env. Prefers a dedicated FOLIO_JWT_SECRET;
 * falls back to FOLIO_API_KEY so an existing single-key deployment gains JWT
 * support with zero new configuration. Returns null when neither is set (the
 * server's unauthenticated mode — no signing/verification possible).
 */
export function jwtSecret(): string | null {
  const dedicated = process.env['FOLIO_JWT_SECRET'];
  if (dedicated && dedicated.length > 0) return dedicated;
  const apiKey = process.env['FOLIO_API_KEY'];
  if (apiKey && apiKey.length > 0) return apiKey;
  return null;
}

/** EDITOR + LIBRARY session lifetime in ms — the durable "logged-in" window for
 *  the folio_session cookie. The editor and library must stay ALWAYS-ON for the
 *  operator, so this is long (default 30 DAYS; override FOLIO_EDITOR_TOKEN_TTL_MS).
 *  It is NOT the lifetime of a shown/shared OUTPUT link — that's outputLinkTtlMs. */
export function editorSessionTtlMs(): number {
  const env = parseInt(process.env['FOLIO_EDITOR_TOKEN_TTL_MS'] ?? '', 10);
  return Number.isFinite(env) && env > 0 ? env : 30 * 24 * 60 * 60 * 1000;
}

/** OUTPUT-LINK lifetime in ms — the ephemeral window for a generated design link
 *  (the `?token=` in open_url/view_url and the /o/<code> short link). SHORT so a
 *  link shown on a recording self-expires; reopening the design from the (always-
 *  on) Library mints a fresh one. Default 30 MINUTES; override FOLIO_OUTPUT_LINK_TTL_MS. */
export function outputLinkTtlMs(): number {
  const env = parseInt(process.env['FOLIO_OUTPUT_LINK_TTL_MS'] ?? '', 10);
  return Number.isFinite(env) && env > 0 ? env : 30 * 60 * 1000;
}
