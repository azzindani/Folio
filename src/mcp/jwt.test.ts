import { describe, it, expect, afterEach } from 'vitest';
import { signJwt, verifyJwt, isValidJwt, jwtSecret } from './jwt';

const SECRET = 'test-secret-long-enough-12345';

/** Extract the failure reason (or null on success) for terse assertions. */
function reasonOf(tok: string, secret: string, now?: number): string | null {
  const r = verifyJwt(tok, secret, now);
  return r.ok ? null : r.reason;
}

describe('signJwt / verifyJwt', () => {
  it('round-trips a payload and exposes claims', () => {
    const tok = signJwt({ sub: 'alice', kind: 'editor' }, SECRET, 3600, 1000);
    const res = verifyJwt(tok, SECRET, 1000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payload.sub).toBe('alice');
      expect(res.payload.kind).toBe('editor');
      expect(res.payload.iat).toBe(1000);
      expect(res.payload.exp).toBe(1000 + 3600);
    }
  });

  it('produces a 3-part dot-delimited token', () => {
    const tok = signJwt({ sub: 'x' }, SECRET, 60, 0);
    expect(tok.split('.')).toHaveLength(3);
  });

  it('rejects an expired token', () => {
    const tok = signJwt({ sub: 'x' }, SECRET, 100, 1000);
    const res = verifyJwt(tok, SECRET, 1000 + 101);
    expect(res).toEqual({ ok: false, reason: 'expired' });
  });

  it('accepts a token exactly before expiry and rejects at expiry', () => {
    const tok = signJwt({ sub: 'x' }, SECRET, 100, 1000);
    expect(verifyJwt(tok, SECRET, 1099).ok).toBe(true);
    expect(verifyJwt(tok, SECRET, 1100).ok).toBe(false); // now >= exp
  });

  it('rejects a token signed with a different secret', () => {
    const tok = signJwt({ sub: 'x' }, SECRET, 3600, 0);
    const res = verifyJwt(tok, 'other-secret', 0);
    expect(res).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a tampered payload', () => {
    const tok = signJwt({ sub: 'alice' }, SECRET, 3600, 0);
    const [h, , s] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = verifyJwt(`${h}.${forged}.${s}`, SECRET, 0);
    expect(res.ok).toBe(false);
  });

  it('rejects a malformed token', () => {
    expect(reasonOf('not-a-jwt', SECRET)).toBe('malformed');
    expect(reasonOf('a.b', SECRET)).toBe('malformed');
  });

  it('rejects a non-HS256 algorithm', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const body = Buffer.from(JSON.stringify({ sub: 'x' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(reasonOf(`${header}.${body}.`, SECRET)).toBe('bad_alg');
  });

  it('treats a token with no exp as never-expiring (master convenience)', () => {
    const tok = signJwt({ sub: 'master' }, SECRET, 0, 0);
    expect(verifyJwt(tok, SECRET, 9_999_999_999).ok).toBe(true);
  });

  it('isValidJwt is a boolean shorthand', () => {
    const tok = signJwt({ sub: 'x' }, SECRET, 3600, 0);
    expect(isValidJwt(tok, SECRET, 0)).toBe(true);
    expect(isValidJwt('garbage', SECRET, 0)).toBe(false);
  });
});

describe('jwtSecret', () => {
  const saved = { jwt: process.env['FOLIO_JWT_SECRET'], api: process.env['FOLIO_API_KEY'] };
  afterEach(() => {
    if (saved.jwt === undefined) delete process.env['FOLIO_JWT_SECRET']; else process.env['FOLIO_JWT_SECRET'] = saved.jwt;
    if (saved.api === undefined) delete process.env['FOLIO_API_KEY']; else process.env['FOLIO_API_KEY'] = saved.api;
  });

  it('prefers FOLIO_JWT_SECRET', () => {
    process.env['FOLIO_JWT_SECRET'] = 'dedicated';
    process.env['FOLIO_API_KEY'] = 'apikey';
    expect(jwtSecret()).toBe('dedicated');
  });

  it('falls back to FOLIO_API_KEY', () => {
    delete process.env['FOLIO_JWT_SECRET'];
    process.env['FOLIO_API_KEY'] = 'apikey';
    expect(jwtSecret()).toBe('apikey');
  });

  it('returns null when neither is set', () => {
    delete process.env['FOLIO_JWT_SECRET'];
    delete process.env['FOLIO_API_KEY'];
    expect(jwtSecret()).toBeNull();
  });
});
