import { describe, it, expect } from 'vitest';
import { createRateLimiter, rateLimiterFromEnv } from './rate-limit';

describe('createRateLimiter', () => {
  it('allows up to `burst` immediate calls, then throttles', () => {
    const rl = createRateLimiter({ burst: 3, perSec: 1 })!;
    const now = 1_000_000;
    expect(rl.take('a', now).ok).toBe(true);
    expect(rl.take('a', now).ok).toBe(true);
    expect(rl.take('a', now).ok).toBe(true);
    const denied = rl.take('a', now);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0); // ~1s at 1/s refill
  });

  it('refills at perSec over elapsed time', () => {
    const rl = createRateLimiter({ burst: 2, perSec: 10 })!; // 1 token / 100ms
    const t0 = 5_000_000;
    rl.take('k', t0); rl.take('k', t0);            // drain
    expect(rl.take('k', t0).ok).toBe(false);
    expect(rl.take('k', t0 + 100).ok).toBe(true);  // 1 token refilled after 100ms
    expect(rl.take('k', t0 + 100).ok).toBe(false); // only one refilled
  });

  it('never refills beyond burst', () => {
    const rl = createRateLimiter({ burst: 2, perSec: 100 })!;
    const t0 = 9_000_000;
    rl.take('k', t0);                              // 1 left
    // idle a long time — would refill 100*60 tokens, but caps at burst=2
    expect(rl.take('k', t0 + 60_000).ok).toBe(true);
    expect(rl.take('k', t0 + 60_000).ok).toBe(true);
    expect(rl.take('k', t0 + 60_000).ok).toBe(false);
  });

  it('isolates keys (per-identity buckets)', () => {
    const rl = createRateLimiter({ burst: 1, perSec: 1 })!;
    const now = 2_000_000;
    expect(rl.take('alice', now).ok).toBe(true);
    expect(rl.take('alice', now).ok).toBe(false);
    expect(rl.take('bob', now).ok).toBe(true);     // bob unaffected
  });

  it('tolerates backwards clock skew (negative elapsed → no refill, no crash)', () => {
    const rl = createRateLimiter({ burst: 1, perSec: 1 })!;
    const now = 3_000_000;
    expect(rl.take('k', now).ok).toBe(true);
    expect(rl.take('k', now - 5_000).ok).toBe(false); // earlier time must not over-refill
  });

  it('sweep() evicts idle buckets past the ttl', () => {
    const rl = createRateLimiter({ burst: 1, perSec: 1, ttlMs: 1_000 })!;
    const t0 = 4_000_000;
    rl.take('k', t0);
    expect(rl.size()).toBe(1);
    rl.sweep(t0 + 500);   // within ttl → kept
    expect(rl.size()).toBe(1);
    rl.sweep(t0 + 2_000); // past ttl → evicted
    expect(rl.size()).toBe(0);
  });

  it('returns null (disabled) when burst<=0 or perSec<=0', () => {
    expect(createRateLimiter({ burst: 0, perSec: 10 })).toBeNull();
    expect(createRateLimiter({ burst: 10, perSec: 0 })).toBeNull();
    expect(createRateLimiter({ burst: -1, perSec: 5 })).toBeNull();
  });
});

describe('rateLimiterFromEnv', () => {
  it('defaults to an enabled limiter (40 burst, 10/s)', () => {
    const rl = rateLimiterFromEnv({})!;
    expect(rl).not.toBeNull();
    expect(rl.burst).toBe(40);
    expect(rl.perSec).toBe(10);
  });
  it('honors env overrides', () => {
    const rl = rateLimiterFromEnv({ FOLIO_RATE_BURST: '5', FOLIO_RATE_PER_SEC: '2' })!;
    expect(rl.burst).toBe(5);
    expect(rl.perSec).toBe(2);
  });
  it('disables when FOLIO_RATE_BURST=0', () => {
    expect(rateLimiterFromEnv({ FOLIO_RATE_BURST: '0' })).toBeNull();
  });
});
