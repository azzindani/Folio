import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  compareSemver, isNewer, fetchLatestRelease, checkNow, getUpdateStatus,
  updateCheckEnabled, updateIntervalMs, currentVersion, __resetUpdateState,
} from './update-check';

/** A fetch stub returning one canned GitHub /releases/latest payload. */
const ghOk = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

const ghFails = (): typeof fetch => (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;

describe('compareSemver', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareSemver('0.1.1', '0.2.0')).toBe(-1);
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1);
    expect(compareSemver('0.1.2', '0.1.10')).toBe(-1);   // numeric, not lexical
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('tolerates a leading v and short versions', () => {
    expect(compareSemver('v0.2.0', '0.2.0')).toBe(0);
    expect(compareSemver('1.1', '1.0.5')).toBe(1);       // 1.1 → 1.1.0
  });

  it('ranks a prerelease BELOW its release', () => {
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBe(1);
  });

  it('isNewer only fires on a genuine upgrade', () => {
    expect(isNewer('0.2.0', '0.1.1')).toBe(true);
    expect(isNewer('0.1.1', '0.1.1')).toBe(false);
    expect(isNewer('0.1.0', '0.1.1')).toBe(false);       // never "update" to an older tag
  });
});

describe('fetchLatestRelease', () => {
  it('parses a release and strips the v prefix', async () => {
    const rel = await fetchLatestRelease('a/b', ghOk({
      tag_name: 'v0.2.0', html_url: 'https://github.com/a/b/releases/tag/v0.2.0', published_at: '2026-07-11T00:00:00Z',
    }));
    expect(rel).toEqual({
      version: '0.2.0', tag: 'v0.2.0',
      url: 'https://github.com/a/b/releases/tag/v0.2.0', published_at: '2026-07-11T00:00:00Z',
    });
  });

  it('returns null for drafts and prereleases', async () => {
    expect(await fetchLatestRelease('a/b', ghOk({ tag_name: 'v9.0.0', draft: true }))).toBeNull();
    expect(await fetchLatestRelease('a/b', ghOk({ tag_name: 'v9.0.0', prerelease: true }))).toBeNull();
  });

  it('returns null on a non-OK response (rate limit / no releases yet)', async () => {
    expect(await fetchLatestRelease('a/b', ghOk({}, false))).toBeNull();
  });

  it('never throws when the network is down', async () => {
    await expect(fetchLatestRelease('a/b', ghFails())).resolves.toBeNull();
  });
});

describe('update status', () => {
  beforeEach(() => {
    __resetUpdateState();
    process.env['FOLIO_VERSION'] = '0.1.1';
  });
  afterEach(() => {
    delete process.env['FOLIO_VERSION'];
    delete process.env['FOLIO_UPDATE_CHECK'];
    delete process.env['FOLIO_UPDATE_INTERVAL_MS'];
    __resetUpdateState();
  });

  it('reports an available update after a check', async () => {
    const status = await checkNow(ghOk({ tag_name: 'v0.2.0', html_url: 'https://x/rel' }));
    expect(status.current).toBe('0.1.1');
    expect(status.latest).toBe('0.2.0');
    expect(status.update_available).toBe(true);
    expect(status.release_url).toBe('https://x/rel');
    expect(status.checked_at).not.toBeNull();
  });

  it('reports no update when upstream matches the running version', async () => {
    const status = await checkNow(ghOk({ tag_name: 'v0.1.1', html_url: 'https://x/rel' }));
    expect(status.update_available).toBe(false);
    expect(status.release_url).toBeNull();
  });

  it('keeps the last good answer when a later check fails', async () => {
    await checkNow(ghOk({ tag_name: 'v0.2.0', html_url: 'https://x/rel' }));
    const status = await checkNow(ghFails());          // GitHub down
    expect(status.update_available).toBe(true);        // still knows 0.2.0 exists
    expect(status.latest).toBe('0.2.0');
  });

  it('starts with no knowledge and claims no update', () => {
    const status = getUpdateStatus();
    expect(status.latest).toBeNull();
    expect(status.update_available).toBe(false);
  });
});

describe('configuration', () => {
  afterEach(() => {
    delete process.env['FOLIO_UPDATE_CHECK'];
    delete process.env['FOLIO_UPDATE_INTERVAL_MS'];
    delete process.env['FOLIO_VERSION'];
  });

  it('is on by default and opt-out-able', () => {
    expect(updateCheckEnabled()).toBe(true);
    for (const off of ['0', 'false', 'off', 'no', 'OFF']) {
      process.env['FOLIO_UPDATE_CHECK'] = off;
      expect(updateCheckEnabled()).toBe(false);
    }
  });

  it('floors the interval at 1h so a misconfig cannot hammer the API', () => {
    process.env['FOLIO_UPDATE_INTERVAL_MS'] = '1000';
    expect(updateIntervalMs()).toBe(60 * 60 * 1000);
    process.env['FOLIO_UPDATE_INTERVAL_MS'] = String(6 * 60 * 60 * 1000);
    expect(updateIntervalMs()).toBe(6 * 60 * 60 * 1000);
  });

  it('reads the real package version by default', () => {
    expect(currentVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
