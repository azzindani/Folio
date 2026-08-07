import { describe, it, expect, vi, beforeEach } from 'vitest';

// The providers are HTTP shapes we do not control, so the parsers are tested
// against recorded response bodies rather than the live APIs — a test suite
// that needs the internet is a test suite that fails on a plane.
const jsonMock = vi.fn();
vi.mock('./asset-net', async (orig) => {
  const actual = await orig<typeof import('./asset-net')>();
  return { ...actual, httpJSON: (url: string) => jsonMock(url) };
});

const {
  searchOpenverse, searchWikimedia, searchIconify, searchFonts,
  runSearch, assetSearch, ovLicenseLabel, wmText, resetFontCache,
} = await import('./asset-search');

const OV = {
  results: [{
    id: 'abc-123', title: 'Morning Desk', url: 'https://live.staticflickr.com/1/2_b.jpg',
    thumbnail: 'https://api.openverse.org/v1/images/abc-123/thumb/',
    creator: 'jo', license: 'by-sa', license_version: '2.0',
    attribution: '"Morning Desk" by jo is licensed under CC BY-SA 2.0.',
    foreign_landing_url: 'https://www.flickr.com/photos/jo/2',
    width: 1600, height: 1067, filetype: 'jpg',
  }],
};
const WM = {
  query: { pages: { '99': {
    title: 'File:Water cycle.svg',
    imageinfo: [{
      url: 'https://upload.wikimedia.org/wikipedia/commons/1/12/Water_cycle.svg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Water_cycle.svg',
      width: 800, height: 600, mime: 'image/svg+xml', size: 12345,
      thumburl: 'https://upload.wikimedia.org/thumb/400px-Water_cycle.svg.png',
      extmetadata: {
        LicenseShortName: { value: 'CC BY-SA 4.0' },
        Artist: { value: '<a href="/wiki/User:X">Ada L</a>' },
      },
    }],
  } } },
};
const ICONS = {
  icons: ['mdi:cloud', 'ph:cloud-bold'],
  collections: {
    mdi: { name: 'Material Design Icons', author: { name: 'Pictogrammers' }, license: { title: 'Apache 2.0', spdx: 'Apache-2.0' } },
    ph: { name: 'Phosphor', license: { title: 'MIT' } },
  },
};
const FONTS = [
  { id: 'manrope', family: 'Manrope', category: 'sans-serif', weights: [400, 700], license: 'OFL-1.1', variable: true, defSubset: 'latin' },
  { id: 'lora', family: 'Lora', category: 'serif', weights: [400], license: 'OFL-1.1', defSubset: 'latin' },
];

beforeEach(() => { jsonMock.mockReset(); resetFontCache(); });

describe('licence labelling', () => {
  it('turns Openverse codes into the label a designer would print', () => {
    expect(ovLicenseLabel('by-sa', '2.0')).toBe('CC BY-SA 2.0');
    expect(ovLicenseLabel('cc0')).toBe('CC0 (public domain)');
    expect(ovLicenseLabel('pdm')).toBe('Public Domain Mark');
    expect(ovLicenseLabel(undefined)).toBe('unknown');
  });

  it('flattens the HTML Commons stores its credits in', () => {
    expect(wmText('<a href="/wiki/User:X">Ada  L</a>')).toBe('Ada L');
    expect(wmText(undefined)).toBe('');
  });
});

describe('providers', () => {
  it('maps an Openverse row to a candidate with a fetchable ref', async () => {
    jsonMock.mockResolvedValue(OV);
    const [c] = await searchOpenverse('desk', 5);
    expect(c?.ref).toBe('openverse:abc-123');
    expect(c?.kind).toBe('images');
    expect(c?.license).toBe('CC BY-SA 2.0');
    expect(c?.width).toBe(1600);
    expect(c?.attribution).toContain('CC BY-SA 2.0');
  });

  it('asks Openverse only for commercially reusable, modifiable work', async () => {
    jsonMock.mockResolvedValue(OV);
    await searchOpenverse('desk', 5);
    const url = String(jsonMock.mock.calls[0]?.[0]);
    expect(url).toContain('license_type=commercial%2Cmodification');
    expect(url).toContain('mature=false');
  });

  it('maps a Commons page, building a credit line from the HTML author field', async () => {
    jsonMock.mockResolvedValue(WM);
    const [c] = await searchWikimedia('water cycle', 5);
    expect(c?.ref).toBe('wikimedia:Water cycle.svg');
    expect(c?.title).toBe('Water cycle');
    expect(c?.license).toBe('CC BY-SA 4.0');
    expect(c?.attribution).toBe('Water cycle by Ada L (CC BY-SA 4.0), via Wikimedia Commons');
  });

  it('carries each icon set\'s own licence, not one blanket claim', async () => {
    jsonMock.mockResolvedValue(ICONS);
    const rows = await searchIconify('cloud', 5);
    expect(rows.map(r => r.ref)).toEqual(['iconify:mdi:cloud', 'iconify:ph:cloud-bold']);
    expect(rows[0]?.license).toBe('Apache-2.0');
    expect(rows[0]?.creator).toBe('Pictogrammers');
    expect(rows[1]?.license).toBe('MIT');
  });

  it('finds fonts by partial name AND by category word', async () => {
    jsonMock.mockResolvedValue(FONTS);
    expect((await searchFonts('manro', 5)).map(r => r.ref)).toEqual(['font:manrope']);
    resetFontCache();
    jsonMock.mockResolvedValue(FONTS);
    expect((await searchFonts('serif', 5)).map(r => r.title)).toContain('Lora');
  });

  it('fetches the font catalogue once, then serves from cache', async () => {
    jsonMock.mockResolvedValue(FONTS);
    await searchFonts('lora', 5);
    await searchFonts('manrope', 5);
    expect(jsonMock).toHaveBeenCalledTimes(1);
  });
});

describe('routing', () => {
  it('sends each `what` to the sources that can answer it', async () => {
    jsonMock.mockImplementation((u: string) =>
      u.includes('iconify') ? Promise.resolve(ICONS)
        : u.includes('fontsource') ? Promise.resolve(FONTS)
          : u.includes('wikimedia') ? Promise.resolve(WM)
            : Promise.resolve(OV));

    const icon = await runSearch('icon', 'cloud', 4);
    expect(icon.results.every(r => r.source === 'iconify')).toBe(true);

    const font = await runSearch('font', 'manrope', 4);
    expect(font.results.every(r => r.source === 'font')).toBe(true);

    const diagram = await runSearch('diagram', 'water', 4);
    expect(diagram.results.every(r => r.source === 'wikimedia')).toBe(true);

    const photo = await runSearch('photo', 'desk', 4);
    expect(new Set(photo.results.map(r => r.source))).toEqual(new Set(['openverse', 'wikimedia']));
  });

  it('one dead provider does not empty the result set', async () => {
    jsonMock.mockImplementation((u: string) =>
      u.includes('wikimedia') ? Promise.reject(new Error('HTTP 503')) : Promise.resolve(OV));
    const r = await runSearch('photo', 'desk', 4);
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.failures.join()).toContain('wikimedia');
  });
});

describe('assetSearch op', () => {
  it('refuses an empty query instead of searching for nothing', async () => {
    const r = await assetSearch({ query: '   ' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('query is required');
  });

  it('returns candidates plus a baton pointing at asset_fetch', async () => {
    jsonMock.mockResolvedValue(ICONS);
    const r = await assetSearch({ query: 'cloud', what: 'icon', project_path: '/p/x' }) as Record<string, unknown>;
    expect(r['success']).toBe(true);
    const next = r['next_action'] as { params: Record<string, unknown> };
    expect(next.params['op']).toBe('asset_fetch');
    expect(next.params['ref']).toBe('iconify:mdi:cloud');
    expect(String(r['licensing'])).toContain('CREDIT LINE');
  });

  it('falls back to photo for an unknown `what` rather than erroring', async () => {
    jsonMock.mockResolvedValue(OV);
    const r = await assetSearch({ query: 'desk', what: 'hologram' }) as Record<string, unknown>;
    expect(r['what']).toBe('photo');
  });

  it('is disabled outright by FOLIO_ASSET_NET=off', async () => {
    process.env['FOLIO_ASSET_NET'] = 'off';
    try {
      const r = await assetSearch({ query: 'desk' });
      expect(r.success).toBe(false);
      expect(r.hint).toContain('asset_add');
    } finally { delete process.env['FOLIO_ASSET_NET']; }
  });
});
