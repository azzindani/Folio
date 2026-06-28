// Reusable network-access guards for the editor / library HTTP surface (and any
// other front-door that wants them). Three independent, opt-in protections:
//
//   1. clientIp()        — proxy-aware, anti-spoof IP extraction (trust the LAST
//                          X-Forwarded-For hop: the value our edge proxy appended,
//                          which a client can't forge — its own XFF lands left of it).
//   2. IP allow-list     — FOLIO_ALLOW_IPS. When set, only listed IPs/CIDRs get in.
//                          This is the "a leaked link is still only usable by ME,
//                          with no login" guarantee: possession of the URL is not
//                          enough — the request must also originate on-network.
//   3. concurrency gate  — bound simultaneous expensive work (thumbnail rasterize,
//                          full-library scan) so a burst can't pile up and peg/OOM
//                          the single-core container.
//
// Pure + framework-agnostic (no Bun/Node http types) so the Bun editor server and
// the node MCP server can both use it. Per-second throttling lives in
// rate-limit.ts; loadEditorGuards() composes that limiter with the above.
import { createRateLimiter, type RateLimiter } from './rate-limit';

/** Normalize an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) to plain IPv4 and
 *  lowercase, so a v4 allow-list still matches a v4-mapped-v6 socket address. */
function normalizeIp(ip: string): string {
  const s = ip.trim().toLowerCase();
  const m = s.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  return m ? m[1]! : s;
}

/** Best client IP. `xff` is the raw X-Forwarded-For header (may be empty/null).
 *  Trust the LAST hop — what the trusted edge proxy (Caddy) appended, the real
 *  immediate peer. No XFF (direct/local run) → the socket peer. Always returns a
 *  non-empty string so it's safe as a map key. */
export function clientIp(xff: string | null | undefined, socketAddr?: string | null): string {
  const hops = (xff ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const raw = hops.length ? hops[hops.length - 1]! : (socketAddr || 'unknown');
  return normalizeIp(raw || 'unknown');
}

// ── IP allow-list ────────────────────────────────────────────────────────────
export type IpMatcher = (ip: string) => boolean;

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255 || !/^\d+$/.test(p)) return null;
    n = (n * 256) + o;
  }
  return n >>> 0;
}

function cidrMatcher(cidr: string): IpMatcher | null {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const baseInt = ipv4ToInt(base ?? '');
  if (baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const net = (baseInt & mask) >>> 0;
  return (ip) => { const i = ipv4ToInt(ip); return i !== null && ((i & mask) >>> 0) === net; };
}

/** Parse a comma/space-separated allow spec into matchers. Supports exact IPv4 /
 *  IPv6 and IPv4 CIDR (`a.b.c.d/n`). Unparseable entries are skipped. */
export function parseAllowList(spec: string | undefined | null): IpMatcher[] {
  const out: IpMatcher[] = [];
  for (const tok of (spec ?? '').split(/[\s,]+/)) {
    const t = tok.trim();
    if (!t) continue;
    if (t.includes('/')) { const m = cidrMatcher(t); if (m) out.push(m); continue; }
    const want = normalizeIp(t);
    out.push((ip) => ip === want);
  }
  return out;
}

/** True when `ip` is allowed. An EMPTY list = "no allow-list configured" → allow
 *  everything (keeps the open default; the gate is opt-in via FOLIO_ALLOW_IPS). */
export function ipAllowed(ip: string, list: IpMatcher[]): boolean {
  if (list.length === 0) return true;
  const norm = normalizeIp(ip);
  return list.some(m => m(norm));
}

// ── Concurrency gate ─────────────────────────────────────────────────────────
export interface ConcurrencyGate {
  /** Admit a holder if below cap. Returns false when full (caller should 503). */
  tryAcquire(): boolean;
  /** Release a previously-acquired slot. */
  release(): void;
  inFlight(): number;
  readonly max: number;
}

/** A counting gate: at most `max` concurrent holders. `max<=0` → unlimited. */
export function createConcurrencyGate(max: number): ConcurrencyGate {
  let inFlight = 0;
  const cap = Math.floor(max);
  return {
    max: cap,
    tryAcquire(): boolean { if (cap > 0 && inFlight >= cap) return false; inFlight++; return true; },
    release(): void { if (inFlight > 0) inFlight--; },
    inFlight(): number { return inFlight; },
  };
}

// ── Composed editor-server guards ────────────────────────────────────────────
export interface EditorGuards {
  /** IP allow-list matchers (empty = open). */
  allow: IpMatcher[];
  /** Per-IP request throttle (null = disabled). */
  limiter: RateLimiter | null;
  /** Concurrency cap for expensive synchronous work. */
  heavy: ConcurrencyGate;
  /** True when FOLIO_ALLOW_IPS restricts access (for log/health reporting). */
  readonly allowListActive: boolean;
}

/** Build the editor/library guards from env. Generous rate defaults: the editor
 *  fires many small asset requests per page load, so the bucket only stops a
 *  flood, not normal use. All knobs are opt-out/tunable:
 *    FOLIO_ALLOW_IPS            comma/space list of IPs + IPv4 CIDRs (unset = open)
 *    FOLIO_EDITOR_RATE_BURST    bucket size            (default 240; 0 disables)
 *    FOLIO_EDITOR_RATE_PER_SEC  steady refill /s       (default 80;  0 disables)
 *    FOLIO_EDITOR_MAX_HEAVY     concurrent heavy ops   (default 8;   0 = unlimited) */
export function loadEditorGuards(env: NodeJS.ProcessEnv = process.env): EditorGuards {
  const allow = parseAllowList(env['FOLIO_ALLOW_IPS']);
  return {
    allow,
    allowListActive: allow.length > 0,
    limiter: createRateLimiter({
      burst: Number(env['FOLIO_EDITOR_RATE_BURST'] ?? 240),
      perSec: Number(env['FOLIO_EDITOR_RATE_PER_SEC'] ?? 80),
    }),
    heavy: createConcurrencyGate(Number(env['FOLIO_EDITOR_MAX_HEAVY'] ?? 8)),
  };
}
