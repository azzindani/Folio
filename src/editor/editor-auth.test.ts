import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isValidToken, sessionCookieHeader, mintSessionToken, slidingSessionCookie,
} from './editor-auth';
import { signJwt, verifyJwt, editorSessionTtlMs } from '../mcp/jwt';

const SECRET = 'test-secret-key-aaaaaaaaaaaaaaaa';

function payloadOf(jwt: string): Record<string, unknown> {
  const mid = jwt.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(mid, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('editor session — 30-min sliding window', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env['FOLIO_JWT_SECRET'] = SECRET;
    delete process.env['FOLIO_API_KEY'];
    delete process.env['FOLIO_TOKENS'];
    delete process.env['FOLIO_TOKENS_FILE'];
    delete process.env['FOLIO_EDITOR_TOKEN_TTL_MS'];
  });
  afterEach(() => { process.env = { ...saved }; });

  it('editorSessionTtlMs defaults to 30 min, honors the env override', () => {
    expect(editorSessionTtlMs()).toBe(30 * 60 * 1000);
    process.env['FOLIO_EDITOR_TOKEN_TTL_MS'] = String(10 * 60 * 1000);
    expect(editorSessionTtlMs()).toBe(10 * 60 * 1000);
  });

  it('mintSessionToken issues a verifiable editor JWT whose exp matches the TTL', () => {
    const tok = mintSessionToken();
    expect(verifyJwt(tok, SECRET).ok).toBe(true);
    const p = payloadOf(tok);
    expect(p['kind']).toBe('editor');
    expect((p['exp'] as number) - (p['iat'] as number)).toBe(30 * 60); // seconds
  });

  it('mintSessionToken is empty when no secret is configured (open mode)', () => {
    delete process.env['FOLIO_JWT_SECRET'];
    expect(mintSessionToken()).toBe('');
  });

  it('sessionCookieHeader is HttpOnly+Lax with Max-Age = TTL seconds', () => {
    const h = sessionCookieHeader('abc');
    expect(h).toContain('folio_session=abc');
    expect(h).toContain('HttpOnly');
    expect(h).toContain('SameSite=Lax');
    expect(h).toContain(`Max-Age=${30 * 60}`);
  });

  describe('slidingSessionCookie — renews an active session, refuses everything else', () => {
    it('renews a valid editor JWT (fresh token, fresh window)', () => {
      const original = signJwt({ sub: 'default', kind: 'editor' }, SECRET, 5); // ~expiring soon
      const cookie = slidingSessionCookie(original);
      expect(cookie).not.toBeNull();
      const fresh = decodeURIComponent(cookie!.split('folio_session=')[1]!.split(';')[0]!);
      expect(verifyJwt(fresh, SECRET).ok).toBe(true);
      // The renewed token carries a full 30-min window again.
      const p = payloadOf(fresh);
      expect((p['exp'] as number) - (p['iat'] as number)).toBe(30 * 60);
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
      const expired = signJwt({ sub: 'default', kind: 'editor', exp: 1 }, SECRET, 0); // exp in the past
      expect(slidingSessionCookie(expired)).toBeNull();
    });
  });

  it('isValidToken accepts a fresh editor JWT + the raw secret, rejects junk', () => {
    expect(isValidToken(mintSessionToken())).toBe(true);
    expect(isValidToken(SECRET)).toBe(true);
    expect(isValidToken('garbage')).toBe(false);
    expect(isValidToken('')).toBe(false);
  });
});
