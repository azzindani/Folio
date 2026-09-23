import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const jsonMock = vi.fn();
vi.mock('./asset-net', async (orig) => {
  const actual = await orig<typeof import('./asset-net')>();
  return { ...actual, httpJSON: (url: string) => jsonMock(url) };
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-pack-search-'));
const pack = path.join(tmp, 'library');
process.env['FOLIO_PACK_DIR'] = pack;
process.env['FOLIO_LIBRARY_DIR'] = path.join(tmp, 'lib-root');
process.env['FOLIO_PROJECTS_DIR'] = path.join(tmp, 'projects');

const { searchPack, packScore } = await import('./pack-search');
const { assetSearch } = await import('./asset-search');
const { assetFetch } = await import('./asset-fetch');

const FILES = [
  { path: 'sfx/impact/punch-heavy.mp3', license: 'CC0', title: 'heavy punch impact', tags: ['sfx', 'impact', 'punch', 'hit'], duration_ms: 680 },
  { path: 'sfx/impact/punch.mp3', license: 'CC0', title: 'punch impact', tags: ['sfx', 'impact', 'punch', 'hit'], duration_ms: 470 },
  { path: 'sfx/ui/click-1.mp3', license: 'CC0', title: 'UI click, short and dry', tags: ['sfx', 'ui', 'click'], duration_ms: 90 },
  { path: 'svg/logos/github.svg', license: 'CC0', title: 'GitHub logo', tags: ['logo', 'brand', 'github'] },
  { path: 'svg/flags/jp.svg', license: 'MIT', title: 'flag of Japan', tags: ['flag', 'jp', 'japan', 'asia'] },
  { path: 'music/lofi/jazz-organ-loop-95.mp3', license: 'CC0', title: 'lo-fi jazz organ loop, 95 BPM', tags: ['music', 'lofi', 'chill', 'loop'], duration_ms: 40464, bpm: 95, page: 'https://freesound.org/people/h/sounds/1' },
];

beforeAll(() => {
  for (const f of FILES) {
    fs.mkdirSync(path.dirname(path.join(pack, f.path)), { recursive: true });
    fs.writeFileSync(path.join(pack, f.path), `bytes of ${f.path}`);
  }
  fs.writeFileSync(path.join(pack, 'manifest.json'), JSON.stringify({ version: 1, updated: '2026-09-23', files: FILES }));
  fs.mkdirSync(path.join(tmp, 'projects', 'p'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'projects', 'p', 'project.yaml'), 'name: p\n');
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => { jsonMock.mockReset(); });

describe('searchPack', () => {
  it('ranks a whole-word hit above a substring hit', () => {
    expect(packScore(FILES[0] as never, 'heavy punch')).toBe(4);     // each query word once
    expect(packScore(FILES[1] as never, 'heavy punch')).toBe(2);
    expect(packScore(FILES[2] as never, 'clicks')).toBe(0);
    expect(packScore(FILES[2] as never, 'clic')).toBeGreaterThan(0);
  });

  it('answers sound from sfx/ only, best match first, shorter first on a tie', () => {
    const hits = searchPack('sound', 'punch', 8);
    expect(hits.map(h => h.path)).toEqual(['lib/folio/sfx/impact/punch.mp3', 'lib/folio/sfx/impact/punch-heavy.mp3']);
    expect(hits[0]).toMatchObject({ ref: 'pack:sfx/impact/punch.mp3', source: 'folio-pack', kind: 'audio', license: 'CC0', duration_ms: 470 });
    expect(searchPack('music', 'punch', 8)).toEqual([]);
    // A bed says its tempo and whether it loops — what a cut is timed against.
    expect(searchPack('music', 'chill', 8)[0]?.note).toMatch(/95 BPM\. Loops seamlessly/);
    expect(searchPack('photo', 'punch', 8)).toEqual([]);
  });

  it('answers logo from svg/logos/ and icon from all of svg/', () => {
    expect(searchPack('logo', 'github', 8).map(h => h.path)).toEqual(['lib/folio/svg/logos/github.svg']);
    expect(searchPack('logo', 'japan', 8)).toEqual([]);
    expect(searchPack('icon', 'flag japan', 8)[0]).toMatchObject({ path: 'lib/folio/svg/flags/jp.svg', kind: 'images', license: 'MIT' });
  });
});

describe('asset_search with the pack', () => {
  it('still answers from the pack with internet search off, pointing straight at the timeline', async () => {
    process.env['FOLIO_ASSET_NET'] = 'off';
    try {
      const r = await assetSearch({ query: 'click', what: 'sfx' }) as Record<string, unknown>;
      expect(r['success']).toBe(true);
      expect((r['results'] as Array<{ path: string }>).map(c => c.path)).toEqual(['lib/folio/sfx/ui/click-1.mp3']);
      expect(r['next_action']).toMatchObject({ tool: 'animation', params: { op: 'audio', src: 'lib/folio/sfx/ui/click-1.mp3' } });
      expect(JSON.stringify(r['progress'])).toContain('Internet search is off');
    } finally { delete process.env['FOLIO_ASSET_NET']; }
  });

  it('does not list a track twice when the internet finds the file the pack already holds', async () => {
    jsonMock.mockResolvedValue({ results: [
      { id: 'same', title: 'Jazz organ', url: 'https://x/a.mp3', filetype: 'mp3', license: 'cc0', duration: 40000, foreign_landing_url: 'https://freesound.org/people/h/sounds/1/' },
      { id: 'other', title: 'Chill keys', url: 'https://x/b.mp3', filetype: 'mp3', license: 'cc0', duration: 30000, foreign_landing_url: 'https://freesound.org/people/h/sounds/2' },
    ] });
    const r = await assetSearch({ query: 'chill', what: 'music', limit: 6 }) as Record<string, unknown>;
    expect((r['results'] as Array<{ ref: string }>).map(c => c.ref)).toEqual(['pack:music/lofi/jazz-organ-loop-95.mp3', 'openverse-audio:other']);
  });

  it('lists pack hits first online, but never more than half the list', async () => {
    jsonMock.mockResolvedValue({ results: Array.from({ length: 4 }, (_, i) => ({ id: `ov-${i}`, title: `Punch ${i}`, url: 'https://x/a.mp3', filetype: 'mp3', license: 'cc0', duration: 500 })) });
    const r = await assetSearch({ query: 'punch', what: 'sound', limit: 2 }) as Record<string, unknown>;
    expect((r['results'] as Array<{ source: string }>).map(c => c.source)).toEqual(['folio-pack', 'openverse']);
  });
});

describe('asset_fetch pack:<path>', () => {
  it('serves a pack ref from disk, restoring the file if the library lost it', async () => {
    const r = await assetFetch({ project_path: path.join(tmp, 'projects', 'p'), ref: 'pack:sfx/impact/punch.mp3' }) as Record<string, unknown>;
    expect(r['success']).toBe(true);
    expect(r['asset']).toMatchObject({ path: 'lib/folio/sfx/impact/punch.mp3', duration_ms: 470, provenance: { source: 'folio-pack', license: 'CC0' } });
    expect(fs.existsSync(path.join(tmp, 'lib-root', 'folio', 'sfx', 'impact', 'punch.mp3'))).toBe(true);
    expect(jsonMock).not.toHaveBeenCalled();
    const bad = await assetFetch({ project_path: path.join(tmp, 'projects', 'p'), ref: 'pack:sfx/nope.mp3' });
    expect(bad.error).toContain('Not in Folio\'s bundled pack');
  });
});
