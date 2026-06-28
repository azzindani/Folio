import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isValidToken, sessionCookieHeader, mintSessionToken, mintOutputToken, slidingSessionCookie,
} from './editor-auth';
import { signJwt, verifyJwt, editorSessionTtlMs, outputLinkTtlMs } from '../mcp/jwt';

const SECRET = 'test-secret-key-aaaaaaaaaaaaaaaa';
const DAY30 = 30 * 24 * 60 * 60; // seconds — editor/library session window
const MIN30 = 30 * 60;            // seconds — output-link window

function payloadOf(jwt: string): Record<string, unknown> {
  const mid = jwt.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(mid, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('editor/library session (30-day) vs output link (30-min)', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env['FOLIO_JWT_SECRET'] = SECRET;
    delete process.env['FOLIO_API_KEY'];
    delete process.env['FOLIO_TOKENS'];
    delete process.env['FOLIO_TOKENS_FILE'];
    delete process.env['FOLIO_EDITOR_TOKEN_TTL_MS'];
    delete process.env['FOLIO_OUTPUT_LINK_TTL_MS'];
  });
  afterEach(() => { process.env = { ...saved }; });

  it('editorSessionTtlMs defaults to 30 DAYS (always-on); env overrides', () => {
    expect(editorSessionTtlMs()).toBe(DAY30 * 1000);
    process.env['FOLIO_EDITOR_TOKEN_TTL_MS'] = String(7 * 24 * 60 * 60 * 1000);
    expect(editorSessionTtlMs()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('outputLinkTtlMs defaults to 30 MIN (ephemeral); env overrides', () => {
    expect(outputLinkTtlMs()).toBe(MIN30 * 1000);
    process.env['FOLIO_OUTPUT_LINK_TTL_MS'] = String(10 * 60 * 1000);
    expect(outputLinkTtlMs()).toBe(10 * 60 * 1000);
  });

  it('mintSessionToken = durable 30-DAY editor JWT; mintOutputToken = 30-MIN', () => {
    const s = mintSessionToken();
    expect(verifyJwt(s, SECRET).ok).toBe(true);
    expect(payloadOf(s)['kind']).toBe('editor');
    expect((payloadOf(s)['exp'] as number) - (payloadOf(s)['iat'] as number)).toBe(DAY30);
    const o = mintOutputToken();
    expect(verifyJwt(o, SECRET).ok).toBe(true);
    expect(payloadOf(o)['kind']).toBe('output');
    expect((payloadOf(o)['exp'] as number) - (payloadOf(o)['iat'] as number)).toBe(MIN30);
  });

  it('both minters are empty when no secret is configured (open mode)', () => {
    delete process.env['FOLIO_JWT_SECRET'];
    expect(mintSessionToken()).toBe('');
    expect(mintOutputToken()).toBe('');
  });

  it('sessionCookieHeader is HttpOnly+Lax with Max-Age = the 30-DAY session window', () => {
    const h = sessionCookieHeader('abc');
    expect(h).toContain('folio_session=abc');
    expect(h).toContain('HttpOnly');
    expect(h).toContain('SameSite=Lax');
    expect(h).toContain(`Max-Age=${DAY30}`);
  });

  describe('slidingSessionCookie — renews the durable session, refuses everything else', () => {
    it('renews a valid editor JWT into a full 30-DAY window', () => {
      const original = signJwt({ sub: 'default', kind: 'editor' }, SECRET, 5);
      const cookie = slidingSessionCookie(original);
      expect(cookie).not.toBeNull();
      const fresh = decodeURIComponent(cookie!.split('folio_session=')[1]!.split(';')[0]!);
      expect(verifyJwt(fresh, SECRET).ok).toBe(true);
      const p = payloadOf(fresh);
      expect((p['exp'] as number) - (p['iat'] as number)).toBe(DAY30);
    });
    it('returns null for the raw master secret, a junk/opaque token, and the empty string', () => {
      expect(slidingSessionCookie(SECRET)).toBeNull();
      expect(slidingSessionCookie('not-a-jwt')).toBeNull();
      expect(slidingSessionCookie('')).toBeNull();
    });
    it('returns null in open mode (no secret → nothing to slide)', () => {
      delete process.env['FOLIO_JWT_SECRET'];
      expect(slidingSessionCookie('anything')).toBeNull();
    });
    it('does NOT renew an expired token (the session has lapsed)', () => {
      const expired = signJwt({ sub: 'default', kind: 'editor', exp: 1 }, SECRET, 0);
      expect(slidingSessionCookie(expired)).toBeNull();
    });
  });

  it('isValidToken accepts a session JWT, an OUTPUT JWT, + the raw secret; rejects junk', () => {
    expect(isValidToken(mintSessionToken())).toBe(true);
    expect(isValidToken(mintOutputToken())).toBe(true);
    expect(isValidToken(SECRET)).toBe(true);
    expect(isValidToken('garbage')).toBe(false);
    expect(isValidToken('')).toBe(false);
  });
});
