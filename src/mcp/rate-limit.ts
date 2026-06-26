// §15 — Per-identity token-bucket rate limiter for the MCP HTTP transport.
//
// The server is ONE bun --smol process with SYNCHRONOUS tool handlers: a single
// heavy call (render_preview / export) blocks the event loop, so a burst from
// one client starves every other client. This caps each identity to a steady
// rate with a burst allowance, rejecting the overflow with HTTP 429 + Retry-After
// instead of letting the queue (and heap) grow unbounded.
//
// In-memory is correct here — state need not survive a restart, and there is
// only one process. Idle buckets are swept so the Map can't grow without bound.

export interface RateDecision {
  ok: boolean;
  /** ms until ~1 token is available again (only meaningful when ok=false). */
  retryAfterMs: number;
  /** tokens left in the bucket after this call (for X-RateLimit headers). */
  remaining: number;
}

export interface RateLimiter {
  /** Consume one token for `key` at time `now` (ms). */
  take(key: string, now: number): RateDecision;
  /** Drop buckets idle longer than the ttl so memory stays bounded. */
  sweep(now: number): void;
  /** Live bucket count — for tests/observability. */
  size(): number;
  readonly burst: number;
  readonly perSec: number;
}

interface Bucket { tokens: number; last: number }

export interface RateLimitOpts {
  /** Bucket capacity = max burst before throttling. */
  burst: number;
  /** Steady-state refill rate (tokens per second). */
  perSec: number;
  /** Evict a bucket after this many ms of inactivity (default 5 min). */
  ttlMs?: number;
}

/**
 * Build a token-bucket limiter, or `null` when disabled (burst<=0 or perSec<=0).
 * A null limiter means "no limiting" so callers can branch with `if (limiter)`.
 */
export function createRateLimiter(opts: RateLimitOpts): RateLimiter | null {
  const burst = Math.floor(opts.burst);
  const perSec = opts.perSec;
  if (!(burst > 0) || !(perSec > 0)) return null;
  const ttlMs = opts.ttlMs ?? 5 * 60_000;
  const buckets = new Map<string, Bucket>();

  return {
    burst,
    perSec,
    take(key: string, now: number): RateDecision {
      let b = buckets.get(key);
      if (!b) { b = { tokens: burst, last: now }; buckets.set(key, b); }
      // Refill for the elapsed time, capped at burst. Guard against clock skew
      // (now < last) by treating negative elapsed as zero.
      const elapsed = Math.max(0, now - b.last) / 1000;
      if (elapsed > 0) {
        b.tokens = Math.min(burst, b.tokens + elapsed * perSec);
        b.last = now;
      }
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { ok: true, retryAfterMs: 0, remaining: Math.floor(b.tokens) };
      }
      const deficit = 1 - b.tokens;
      return { ok: false, retryAfterMs: Math.ceil((deficit / perSec) * 1000), remaining: 0 };
    },
    sweep(now: number): void {
      for (const [k, b] of buckets) if (now - b.last > ttlMs) buckets.delete(k);
    },
    size(): number { return buckets.size; },
  };
}

/** Read limiter config from env. Defaults: 40 burst, 10/s — generous for one
 *  model (gated by its own token rate) yet stops a runaway flood. Set either
 *  FOLIO_RATE_BURST or FOLIO_RATE_PER_SEC to 0 to disable. */
export function rateLimiterFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimiter | null {
  const burst = Number(env['FOLIO_RATE_BURST'] ?? 40);
  const perSec = Number(env['FOLIO_RATE_PER_SEC'] ?? 10);
  if (!Number.isFinite(burst) || !Number.isFinite(perSec)) return null;
  return createRateLimiter({ burst, perSec });
}
