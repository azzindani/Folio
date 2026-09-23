import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isPrivateAddress, hostAllowed, checkUrl, netEnabled, defaultFetchHosts,
  SEARCH_HOSTS, NetError, httpBytes,
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

describe('httpBytes — a slow download is not a dead one', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['FOLIO_ASSET_NET_TIMEOUT'];
    delete process.env['FOLIO_ASSET_NET_MAX_MS'];
  });

  /** A response whose body sends `n` chunks, `gap` ms apart, then (optionally) stalls. */
  function trickle(n: number, gap: number, stall = false): void {
    vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => {
      let i = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(ctl): Promise<void> {
          if (i === n) {
            if (!stall) { ctl.close(); return; }
            await new Promise<void>((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
          }
          await new Promise(r => setTimeout(r, gap));
          i++;
          ctl.enqueue(new Uint8Array(10));
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    });
  }

  // The margin is 20×: at 10× (1 s idle timeout, 100 ms chunks) CI failed it —
  // coverage under a parallel suite stalled the event loop past a second.
  // Fake timers do not drive the stream's own reads, so the clock stays real.
  it('keeps going past the timeout while bytes keep arriving', async () => {
    process.env['FOLIO_ASSET_NET_TIMEOUT'] = '2000';
    trickle(24, 100);                                 // 2.4 s in all, never 2 s without a chunk
    const got = await httpBytes('https://cdn.freesound.org/a.mp3', 1000);
    expect(got.buffer.length).toBe(240);
    expect(got.contentType).toBe('audio/mpeg');
  }, 15_000);

  it('gives up on a stream that goes quiet, and says which host', async () => {
    process.env['FOLIO_ASSET_NET_TIMEOUT'] = '300';
    trickle(2, 10, true);
    await expect(httpBytes('https://cdn.freesound.org/b.mp3', 1000)).rejects.toThrow(/cdn\.freesound\.org sent nothing/);
  });

  it('still caps the whole download', async () => {
    process.env['FOLIO_ASSET_NET_TIMEOUT'] = '1000';
    process.env['FOLIO_ASSET_NET_MAX_MS'] = '300';
    trickle(50, 20);
    await expect(httpBytes('https://cdn.freesound.org/c.mp3', 10000)).rejects.toBeInstanceOf(NetError);
  });
});
