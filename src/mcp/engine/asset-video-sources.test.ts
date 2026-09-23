import { describe, it, expect, vi, beforeEach } from 'vitest';

// Recorded response shapes, not the live APIs — see asset-search.test.ts.
const jsonMock = vi.fn();
process.env['FOLIO_PACK_DIR'] = '/nonexistent-folio-pack';
vi.mock('./asset-net', async (orig) => {
  const actual = await orig<typeof import('./asset-net')>();
  return { ...actual, httpJSON: (url: string) => jsonMock(url) };
});

const { pickWebm, pickNasaMp4, searchWikimediaVideo, resolveWikimediaVideo, searchNasaVideo, resolveNasaVideo } = await import('./asset-video-sources');
const { assetSearch } = await import('./asset-search');

beforeEach(() => { jsonMock.mockReset(); });

const webm = (h: number, w = Math.round(h * 16 / 9)): { src: string; type: string; width: number; height: number } =>
  ({ src: `https://upload.wikimedia.org/transcoded/a/ab/Waves.webm/Waves.webm.${h}p.vp9.webm`, type: 'video/webm; codecs="vp9, opus"', width: w, height: h });

const WM_VIDEO = {
  query: { pages: {
    '1': { title: 'File:Long waves.webm', videoinfo: [{ duration: 95.2, width: 1920, height: 1080,
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Long_waves.webm',
      derivatives: [webm(1080), webm(720), webm(360)],
      extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="/wiki/User:Q">Quinn</a>' } } }] },
    '2': { title: 'File:Short waves.ogv', videoinfo: [{ duration: 6.5, width: 640, height: 360,
      derivatives: [{ src: 'https://upload.wikimedia.org/x.ogv', type: 'video/ogg', width: 640, height: 360 }, webm(360, 640)],
      extmetadata: { LicenseShortName: { value: 'CC0' } } }] },
    '3': { title: 'File:No rendition.ogv', videoinfo: [{ duration: 3, derivatives: [{ src: 'https://upload.wikimedia.org/y.ogv', type: 'video/ogg', height: 240 }] }] },
  } },
};

const NASA_SEARCH = { collection: { items: [
  { data: [{ nasa_id: 'KSC-20230101-Launch', title: 'Artemis <b>launch</b>', center: 'KSC' }] },
  { data: [{ title: 'no id' }] },
] } };

describe('picking a rendition', () => {
  it('takes the tallest VP9 WebM at or under 720 lines, never the 1080p one', () => {
    expect(pickWebm([webm(1080), webm(360), webm(720)])).toMatchObject({ height: 720, width: 1280 });
    expect(pickWebm([{ src: 'https://x/a.ogv', type: 'video/ogg', height: 480 }])).toBeNull();
    expect(pickWebm(undefined)).toBeNull();
  });

  it('takes NASA\'s smallest MP4, over https', () => {
    const base = 'http://images-assets.nasa.gov/video/X/X';
    expect(pickNasaMp4([`${base}~orig.mp4`, `${base}~medium.mp4`, `${base}~mobile.mp4`, `${base}~thumb.jpg`]))
      .toBe('https://images-assets.nasa.gov/video/X/X~mobile.mp4');
    expect(pickNasaMp4([`${base}~orig.mov`, `${base}~thumb.jpg`])).toBeNull();
  });
});

describe('Commons footage', () => {
  it('lists playable clips shortest first, skipping any with no WebM rendition', async () => {
    jsonMock.mockResolvedValue(WM_VIDEO);
    const rows = await searchWikimediaVideo('waves', 4);
    expect(String(jsonMock.mock.calls[0]?.[0])).toContain('filetype%3Avideo+waves');
    expect(rows.map(r => r.ref)).toEqual(['wikimedia-video:Short waves.ogv', 'wikimedia-video:Long waves.webm']);
    expect(rows[0]).toMatchObject({ kind: 'video', source: 'wikimedia', duration_ms: 6500, filetype: 'webm', license: 'CC0' });
    expect(rows[1]).toMatchObject({ creator: 'Quinn', attribution: 'Long waves by Quinn (CC BY-SA 4.0), via Wikimedia Commons' });
  });

  it('resolves a title to its 720p WebM, with the file page\'s licence', async () => {
    jsonMock.mockResolvedValue({ query: { pages: { '1': WM_VIDEO.query.pages['1'] } } });
    const r = await resolveWikimediaVideo('File:Long waves.webm');
    expect(r).toMatchObject({ kind: 'video', ext: 'webm', height: 720, suggestedName: 'long-waves', license: 'CC BY-SA 4.0' });
    expect(r.url).toContain('.720p.vp9.webm');
  });

  it('refuses a file Commons has no playable rendition of', async () => {
    jsonMock.mockResolvedValue({ query: { pages: { '3': WM_VIDEO.query.pages['3'] } } });
    await expect(resolveWikimediaVideo('No rendition.ogv')).rejects.toThrow('no playable rendition');
  });
});

describe('NASA footage', () => {
  it('lists items with a nasa_id as fetchable refs', async () => {
    jsonMock.mockResolvedValue(NASA_SEARCH);
    const rows = await searchNasaVideo('artemis', 4);
    expect(String(jsonMock.mock.calls[0]?.[0])).toContain('images-api.nasa.gov/search?q=artemis&media_type=video');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ref: 'nasa-video:KSC-20230101-Launch', source: 'nasa', kind: 'video', title: 'Artemis launch', creator: 'NASA KSC' });
  });

  it('resolves an id to its MP4, and says so when NASA lists none', async () => {
    jsonMock.mockResolvedValue({ collection: { items: [{ href: 'http://images-assets.nasa.gov/video/A/A~small.mp4' }] } });
    expect(await resolveNasaVideo('A')).toMatchObject({ url: 'https://images-assets.nasa.gov/video/A/A~small.mp4', kind: 'video', ext: 'mp4' });
    jsonMock.mockResolvedValue({ collection: { items: [{ href: 'http://images-assets.nasa.gov/video/A/A~orig.mov' }] } });
    await expect(resolveNasaVideo('A')).rejects.toThrow('no MP4');
  });
});

describe('asset_search what:"clip"', () => {
  it('hears "footage" as a clip search across Commons and NASA, and points at op:video', async () => {
    jsonMock.mockImplementation((u: string) => Promise.resolve(u.includes('nasa') ? NASA_SEARCH : WM_VIDEO));
    const r = await assetSearch({ query: 'waves', what: 'footage', project_path: '/p/x' }) as Record<string, unknown>;
    expect(r['what']).toBe('clip');
    const refs = (r['results'] as Array<{ ref: string }>).map(c => c.ref);
    expect(refs).toContain('nasa-video:KSC-20230101-Launch');
    expect(refs[0]).toBe('wikimedia-video:Short waves.ogv');
    expect(String(r['hint'])).toContain('op:video');
    const next = r['next_action'] as { params: Record<string, unknown>; hint: string };
    expect(next.params['ref']).toBe('wikimedia-video:Short waves.ogv');
    expect(next.hint).toContain('video layer');
  });
});
