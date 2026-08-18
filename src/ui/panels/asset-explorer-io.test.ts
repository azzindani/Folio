import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AssetIO } from './asset-explorer-io';

/**
 * The explorer's HTTP layer, checked from the LIBRARY's point of view.
 *
 * The same explorer is mounted in two places that authenticate differently: the
 * editor carries a token in the URL, the Design Library at /library is
 * authenticated by cookie. Every request therefore has to opt in to sending
 * credentials — drop that and the Library gets 401s across the board while the
 * editor keeps working perfectly, which is the kind of asymmetry that used to
 * be invisible when the two had separate code.
 */
const calls: Array<{ url: string; init: RequestInit }> = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response(JSON.stringify({ ok: true, projects: [], assets: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
  });
});
afterEach(() => vi.unstubAllGlobals());

function io(): AssetIO {
  const x = new AssetIO();
  x.setContext('demo', null);
  return x;
}

describe('AssetIO credentials', () => {
  it('sends cookies when listing projects', async () => {
    await io().projects();
    expect(calls[0]?.init.credentials, 'the Library authenticates by cookie').toBe('include');
  });

  it('sends cookies when listing a project\'s assets', async () => {
    await io().list();
    expect(calls[0]?.init.credentials).toBe('include');
  });

  it('sends cookies on every mutation, not only on reads', async () => {
    const x = io();
    await x.manage({ op: 'mkdir', folder: 'shots' });
    await x.upload(new Blob(['x']), 'a.png', '', 'project');
    await x.createProject('fresh');
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.init.credentials, `no cookies on ${c.url}`).toBe('include');
    }
  });

  it('adds a bearer token when it has one, and omits the header when it does not', async () => {
    const withTok = new AssetIO();
    withTok.setContext('demo', 'sekrit');
    await withTok.list();
    expect((calls[0]?.init.headers as Record<string, string>)['Authorization']).toBe('Bearer sekrit');

    calls.length = 0;
    await io().list();
    // No token is the Library's normal case — the cookie carries it, and an
    // empty Authorization header would be a lie the server has to parse.
    expect((calls[0]?.init.headers as Record<string, string>)?.['Authorization']).toBeUndefined();
  });

  it('addresses a manage call to the project it names, not the one in context', async () => {
    // Cut-and-paste across projects depends on this: the delete half has to
    // reach the SOURCE project or it removes the copy just made.
    await io().manageIn('other', { op: 'delete', asset_path: 'assets/images/a.png' });
    expect(calls[0]?.url).toContain('/__project_files/other/__assets/manage');
  });
});
