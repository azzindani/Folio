// Folio — upstream release detection.
//
// A deployed Folio has no idea a new version exists: the image is built once
// and runs forever. This module POLLS the GitHub Releases API on an interval
// (default daily) and exposes the result on /health + /version so an operator
// — or their monitoring — can see "you are on 0.1.1, 0.2.0 is out".
//
// WHY POLL, NOT A WEBHOOK: a GitHub `release` webhook needs a publicly
// reachable URL and a shared secret per deployment. Most self-hosted installs
// sit behind NAT with no inbound port. An outbound poll works everywhere,
// needs no configuration, and sends NOTHING about the user (an anonymous,
// unauthenticated GET; no install id, no telemetry).
//
// WHY IT ONLY NOTIFIES: applying the update is the orchestrator's job (see
// docker-compose's `autoupdate` profile / Watchtower). A server that pulls and
// restarts ITSELF can die mid-render, and it turns any upstream repo
// compromise into instant code execution on every deployment. Detection and
// application are deliberately separate.
//
// Fail-silent by design: GitHub being down, rate-limited, or unreachable must
// never affect serving. Opt out entirely with FOLIO_UPDATE_CHECK=0.
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_REPO = 'azzindani/Folio';
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;   // daily
const MIN_INTERVAL_MS = 60 * 60 * 1000;            // never hammer the API
const REQUEST_TIMEOUT_MS = 5000;

export interface ReleaseInfo {
  version: string;        // "0.2.0" (tag with any leading v stripped)
  tag: string;            // "v0.2.0"
  url: string;            // human-facing release page
  published_at: string;
}

export interface UpdateStatus {
  current: string;
  latest: string | null;
  update_available: boolean;
  release_url: string | null;
  checked_at: string | null;
  enabled: boolean;
}

/** Running version, from package.json (FOLIO_VERSION overrides for tests/dev). */
export function currentVersion(): string {
  const env = process.env['FOLIO_VERSION'];
  if (env) return env.replace(/^v/, '');
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8');
    const v = (JSON.parse(raw) as { version?: string }).version;
    if (typeof v === 'string' && v) return v.replace(/^v/, '');
  } catch { /* not fatal — an unknown version just never reports an update */ }
  return '0.0.0';
}

/**
 * Semver compare: -1 if a < b, 0 if equal, 1 if a > b. Handles a leading `v`
 * and prerelease suffixes (1.0.0-rc.1 < 1.0.0, per semver §11).
 */
export function compareSemver(a: string, b: string): number {
  const parse = (s: string): { nums: number[]; pre: string } => {
    const clean = s.trim().replace(/^v/, '');
    const [core = '', pre = ''] = clean.split('-', 2);
    const nums = core.split('.').map(n => {
      const v = parseInt(n, 10);
      return Number.isFinite(v) ? v : 0;
    });
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  }
  // Equal cores: a prerelease is LOWER than the release it precedes.
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre === pb.pre) return 0;
  return pa.pre < pb.pre ? -1 : 1;
}

/** True when `latest` is a newer version than `current`. */
export function isNewer(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

interface GhRelease {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
}

/**
 * Fetch the newest published release. Returns null on ANY failure (offline,
 * rate-limited, malformed, draft/prerelease) — the caller keeps its last known
 * state. `fetchImpl` is injectable so tests never touch the network.
 */
export async function fetchLatestRelease(
  repo = process.env['FOLIO_UPDATE_REPO'] ?? DEFAULT_REPO,
  fetchImpl: typeof fetch = fetch,
): Promise<ReleaseInfo | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      signal: ctl.signal,
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'folio-update-check' },
    });
    if (!res.ok) return null;                       // 404 (no releases yet), 403 (rate limit), 5xx
    const rel = await res.json() as GhRelease;
    if (rel.draft || rel.prerelease) return null;   // /latest excludes these, but be explicit
    const tag = rel.tag_name;
    if (!tag) return null;
    return {
      version: tag.replace(/^v/, ''),
      tag,
      url: rel.html_url ?? `https://github.com/${repo}/releases/tag/${tag}`,
      published_at: rel.published_at ?? '',
    };
  } catch {
    return null;                                    // offline / DNS / abort — never throw
  } finally {
    clearTimeout(timer);
  }
}

// ── Scheduler + cached state ────────────────────────────────────────────────

let latest: ReleaseInfo | null = null;
let checkedAt: string | null = null;

/** Update checking is ON unless FOLIO_UPDATE_CHECK is 0/false/off/no. */
export function updateCheckEnabled(): boolean {
  const v = (process.env['FOLIO_UPDATE_CHECK'] ?? '1').toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

/** Poll interval, floored at 1h so a misconfig can't hammer api.github.com. */
export function updateIntervalMs(): number {
  const raw = Number(process.env['FOLIO_UPDATE_INTERVAL_MS'] ?? DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, raw);
}

/** Current view of the world — served on /health and /version. */
export function getUpdateStatus(): UpdateStatus {
  const current = currentVersion();
  const enabled = updateCheckEnabled();
  const available = !!latest && isNewer(latest.version, current);
  return {
    current,
    latest: latest?.version ?? null,
    update_available: available,
    release_url: available ? (latest?.url ?? null) : null,
    checked_at: checkedAt,
    enabled,
  };
}

/** One check: refresh the cache and log when a newer release appears. */
export async function checkNow(fetchImpl: typeof fetch = fetch): Promise<UpdateStatus> {
  const rel = await fetchLatestRelease(undefined, fetchImpl);
  checkedAt = new Date().toISOString();
  if (rel) latest = rel;                            // a failed check keeps the last good answer
  const status = getUpdateStatus();
  if (status.update_available) {
    process.stderr.write(
      `[update] Folio ${status.latest} is available (running ${status.current}) — ${status.release_url}\n`,
    );
  }
  return status;
}

/**
 * Start the background poller. First check runs after a short random delay
 * (jitter) so a fleet of containers restarted together doesn't stampede the
 * API on the same second. Timers are unref'd — they never hold the process
 * open. No-op when disabled.
 */
export function startUpdateChecks(fetchImpl: typeof fetch = fetch): void {
  if (!updateCheckEnabled()) {
    process.stderr.write('[update] check: disabled (FOLIO_UPDATE_CHECK=0)\n');
    return;
  }
  const interval = updateIntervalMs();
  const jitter = Math.floor(Math.random() * 60_000);   // 0–60s, startup only (not a render path)
  process.stderr.write(`[update] check: every ${Math.round(interval / 3600_000)}h (running ${currentVersion()})\n`);
  setTimeout(() => {
    void checkNow(fetchImpl);
    setInterval(() => void checkNow(fetchImpl), interval).unref();
  }, 30_000 + jitter).unref();
}

/** Test hook — clear cached state between cases. */
export function __resetUpdateState(): void {
  latest = null;
  checkedAt = null;
}
