import { describe, it, expect, afterEach } from 'vitest';
import {
  isPrivateAddress, hostAllowed, checkUrl, netEnabled, defaultFetchHosts,
  SEARCH_HOSTS, NetError,
} from './asset-net';

// These are the guards standing between "the model may fetch a URL" and a
// request to the host's own metadata service. They are pure, so they are
// tested exhaustively and without touching the network.
describe('asset-net address guards', () => {
  afterEach(() => {
    delete process.env['FOLIO_ASSET_NET'];
    delete process.env['FOLIO_ASSET_FETCH_HOSTS'];
  });

  it('rejects loopback, link-local, and every private IPv4 block', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '10.0.0.5', '192.168.1.1', '172.16.0.1',
      '172.31.255.255', '169.254.169.254', '0.0.0.0', '100.64.0.1']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });

  it('rejects loopback + ULA + link-local IPv6, including v4-mapped forms', () => {
    for (const a of ['::1', '::', 'fe80::1', 'fd00::1', 'fc00::abcd', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });

  it('rejects internal-sounding names that never leave the box', () => {
    for (const h of ['localhost', 'db.localhost', 'redis.local', 'vault.internal']) {
      expect(isPrivateAddress(h), h).toBe(true);
    }
  });

  it('lets ordinary public addresses through', () => {
    for (const a of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '99.99.99.99',
      'upload.wikimedia.org', 'api.openverse.org', '2606:4700::1111']) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
  });

  it('matches allowlist entries by domain suffix, not by substring', () => {
    const allow = ['microsoft.com', '*.example.org'];
    expect(hostAllowed('learn.microsoft.com', allow)).toBe(true);
    expect(hostAllowed('microsoft.com', allow)).toBe(true);
    expect(hostAllowed('cdn.example.org', allow)).toBe(true);
    // The attacks a naive `includes()` would wave through:
    expect(hostAllowed('evilmicrosoft.com', allow)).toBe(false);
    expect(hostAllowed('microsoft.com.evil.net', allow)).toBe(false);
    expect(hostAllowed('notexample.org', allow)).toBe(false);
  });
});

describe('checkUrl', () => {
  it('accepts a plain https URL', () => {
    expect(checkUrl('https://upload.wikimedia.org/a/b.jpg').hostname).toBe('upload.wikimedia.org');
  });

  it('refuses anything that is not https', () => {
    for (const u of ['http://example.com/a.png', 'file:///etc/passwd', 'ftp://x/y']) {
      expect(() => checkUrl(u), u).toThrow(NetError);
    }
  });

  it('refuses a private host even when the allowlist would permit it', () => {
    expect(() => checkUrl('https://127.0.0.1/x', ['127.0.0.1'])).toThrow(/private\/loopback/);
  });

  it('enforces the allowlist when one is given, and skips it when not', () => {
    expect(() => checkUrl('https://example.com/x.png', ['microsoft.com'])).toThrow(/Host not allowed/);
    expect(checkUrl('https://example.com/x.png').hostname).toBe('example.com');
  });

  it('reports a malformed URL rather than throwing a raw TypeError', () => {
    expect(() => checkUrl('not a url')).toThrow(/Not a valid URL/);
  });
});

describe('deployment switches', () => {
  afterEach(() => {
    delete process.env['FOLIO_ASSET_NET'];
    delete process.env['FOLIO_ASSET_FETCH_HOSTS'];
  });

  it('FOLIO_ASSET_NET=off disables the whole finder', () => {
    expect(netEnabled()).toBe(true);
    process.env['FOLIO_ASSET_NET'] = 'off';
    expect(netEnabled()).toBe(false);
    process.env['FOLIO_ASSET_NET'] = 'on';
    expect(netEnabled()).toBe(true);
  });

  it('FOLIO_ASSET_FETCH_HOSTS extends the download allowlist', () => {
    expect(defaultFetchHosts()).not.toContain('learn.microsoft.com');
    process.env['FOLIO_ASSET_FETCH_HOSTS'] = 'learn.microsoft.com, download.microsoft.com';
    const hosts = defaultFetchHosts();
    expect(hosts).toContain('learn.microsoft.com');
    expect(hosts).toContain('download.microsoft.com');
    // The provider APIs stay reachable regardless of what the operator adds.
    for (const h of SEARCH_HOSTS) expect(hosts).toContain(h);
  });
});
