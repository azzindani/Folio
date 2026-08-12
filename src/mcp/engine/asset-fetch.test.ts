import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const jsonMock = vi.fn();
const bytesMock = vi.fn();
vi.mock('./asset-net', async (orig) => {
  const actual = await orig<typeof import('./asset-net')>();
  return {
    ...actual,
    httpJSON: (url: string) => jsonMock(url),
    httpBytes: (url: string, max: number, allow?: string[]) => bytesMock(url, max, allow),
  };
});

const { resolveRef, slugify, projectAllowHosts, assetFetch } = await import('./asset-fetch');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
// Distinct bytes per test: the library deduplicates on content, so reusing one
// buffer everywhere would make unrelated tests collapse onto the same file.
const PNG2 = Buffer.concat([PNG, Buffer.from([0, 1])]);
const PNG3 = Buffer.concat([PNG, Buffer.from([0, 2])]);

const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-fetch-'));
process.env['FOLIO_PROJECTS_DIR'] = projectsDir;

function makeProject(name: string, yaml = 'name: x\n'): string {
  const dir = path.join(projectsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.yaml'), yaml);
  return dir;
}

beforeEach(() => { jsonMock.mockReset(); bytesMock.mockReset(); });
afterAll(() => fs.rmSync(projectsDir, { recursive: true, force: true }));

describe('slugify', () => {
  it('produces a filename stem, never an empty one', () => {
    expect(slugify('Morning Desk — 2024!', 'x')).toBe('morning-desk-2024');
    expect(slugify('  ***  ', 'fallback')).toBe('fallback');
    expect(slugify('a'.repeat(90), 'x')).toHaveLength(48);
  });
});

describe('resolveRef', () => {
  const projectDir = makeProject('resolve-proj');

  it('asks Openverse where the file really is, and on what terms', async () => {
    jsonMock.mockResolvedValue({
      url: 'https://live.staticflickr.com/1/2_b.jpg', title: 'Morning Desk', creator: 'jo',
      license: 'by', license_version: '4.0', attribution: 'credit line', filetype: 'jpg',
      foreign_landing_url: 'https://flickr.com/2', width: 1600, height: 1067,
    });
    const { resolved } = await resolveRef('openverse:abc-123', { projectDir });
    expect(resolved.url).toContain('staticflickr');
    expect(resolved.suggestedName).toBe('morning-desk');
    expect(resolved.license).toBe('CC BY 4.0');
    expect(resolved.attribution).toBe('credit line');
  });

  it('takes the Commons 2000px render when the original is a huge scan', async () => {
    jsonMock.mockResolvedValue({ query: { pages: { 1: { imageinfo: [{
      url: 'https://upload.wikimedia.org/original.tif', size: 30 * 1024 * 1024,
      thumburl: 'https://upload.wikimedia.org/thumb/2000px-Scan.tif.jpg',
      thumbwidth: 2000, thumbheight: 1400, width: 9000, height: 6300, mime: 'image/tiff',
      extmetadata: { LicenseShortName: { value: 'CC0' } },
    }] } } } });
    const { resolved } = await resolveRef('wikimedia:Scan.tif', { projectDir });
    expect(resolved.url).toContain('2000px');
    expect(resolved.ext).toBe('jpg');       // the render, not the TIFF
    expect(resolved.width).toBe(2000);
  });

  it('keeps the Commons original when it is a reasonable size', async () => {
    jsonMock.mockResolvedValue({ query: { pages: { 1: { imageinfo: [{
      url: 'https://upload.wikimedia.org/Photo.jpg', size: 400_000,
      thumburl: 'https://upload.wikimedia.org/thumb/2000px-Photo.jpg',
      width: 2400, height: 1600, mime: 'image/jpeg',
      extmetadata: { LicenseShortName: { value: 'CC BY 3.0' }, Artist: { value: 'Ada' } },
    }] } } } });
    const { resolved } = await resolveRef('wikimedia:File:Photo.jpg', { projectDir });
    expect(resolved.url).toBe('https://upload.wikimedia.org/Photo.jpg');
    expect(resolved.width).toBe(2400);
    expect(resolved.attribution).toContain('Ada');
  });

  it('resolves an icon to an SVG at the asked-for box, with its set\'s licence', async () => {
    jsonMock.mockResolvedValue({ mdi: { name: 'MDI', author: { name: 'Pictogrammers' }, license: { spdx: 'Apache-2.0' } } });
    const { resolved } = await resolveRef('iconify:mdi:cloud', { projectDir, icon_px: 256 });
    expect(resolved.url).toBe('https://api.iconify.design/mdi/cloud.svg?height=256');
    expect(resolved.kind).toBe('icons');
    expect(resolved.license).toBe('Apache-2.0');
  });

  it('bakes an accent colour into the icon, because a fetched SVG defaults to black', async () => {
    jsonMock.mockResolvedValue({ mdi: { license: { spdx: 'Apache-2.0' } } });
    const { resolved } = await resolveRef('iconify:mdi:cloud', { projectDir, icon_color: '#F0A63C' });
    expect(resolved.url).toContain('color=%23F0A63C');
    // The colour is part of the file, so it is part of the filename too —
    // otherwise two tints of one icon would overwrite each other.
    expect(resolved.suggestedName).toBe('mdi-cloud-f0a63c');
  });

  it('ignores a colour that is not a hex, rather than passing junk to the API', async () => {
    jsonMock.mockResolvedValue({ mdi: {} });
    const { resolved } = await resolveRef('iconify:mdi:cloud', { projectDir, icon_color: 'red; drop table' });
    expect(resolved.url).not.toContain('color=');
  });

  it('still resolves an icon when the licence lookup itself fails', async () => {
    jsonMock.mockRejectedValue(new Error('503'));
    const { resolved } = await resolveRef('iconify:mdi:cloud', { projectDir });
    expect(resolved.url).toContain('/mdi/cloud.svg');
    expect(resolved.license).toBe('open source');
  });

  it('downloads the requested font weight, or the nearest the family ships', async () => {
    jsonMock.mockResolvedValue({ id: 'manrope', family: 'Manrope', weights: [200, 400, 800], license: 'OFL-1.1', defSubset: 'latin' });
    const asked = await resolveRef('font:manrope', { projectDir, weight: 800 });
    expect(asked.resolved.url).toContain('latin-800-normal.ttf');
    jsonMock.mockResolvedValue({ id: 'manrope', family: 'Manrope', weights: [200, 400, 800], license: 'OFL-1.1', defSubset: 'latin' });
    const missing = await resolveRef('font:manrope', { projectDir, weight: 950 });
    expect(missing.resolved.url).toContain('latin-400-normal.ttf');
  });

  it('takes the DEFAULT subset, never latin-ext — subset files are disjoint', async () => {
    // latin-ext contains only the extended block. Fetching it renders every
    // ordinary ASCII word in a fallback face, which is how this was found.
    jsonMock.mockResolvedValue({ id: 'manrope', family: 'Manrope', weights: [400], subsets: ['latin', 'latin-ext', 'greek'], defSubset: 'latin' });
    const { resolved } = await resolveRef('font:manrope', { projectDir });
    expect(resolved.url).toContain('/latin-400-normal.ttf');
  });

  it('holds a hand-written https URL to the allowlist, and marks its licence unverified', async () => {
    const { resolved, allow } = await resolveRef('https://learn.microsoft.com/img/a.png', { projectDir });
    expect(resolved.url).toContain('learn.microsoft.com');
    expect(resolved.license).toContain('unverified');
    expect(allow).toBeDefined();
  });

  it('refuses http and unknown schemes with an actionable message', async () => {
    await expect(resolveRef('http://example.com/a.png', { projectDir })).rejects.toThrow(/Plain http:\/\/ is refused/);
    await expect(resolveRef('unsplash:123', { projectDir })).rejects.toThrow(/Unknown ref scheme/);
    await expect(resolveRef('openverse:', { projectDir })).rejects.toThrow(/Malformed ref/);
  });
});

describe('projectAllowHosts', () => {
  it('is null when the project sets no policy — the global default applies', () => {
    expect(projectAllowHosts(makeProject('nopolicy'))).toBeNull();
  });

  it('narrows a project to named hosts, which is how "this vendor only" is enforced', async () => {
    const dir = makeProject('msonly', 'name: x\nasset_sources:\n  allow_hosts:\n    - learn.microsoft.com\n    - microsoft.com\n');
    expect(projectAllowHosts(dir)).toEqual(['learn.microsoft.com', 'microsoft.com']);
    const { allow } = await resolveRef('https://cdn.evil.example/x.png', { projectDir: dir });
    expect(allow).toEqual(['learn.microsoft.com', 'microsoft.com']);
    // The refusal itself happens in httpBytes, which is handed exactly this list.
  });
});

describe('assetFetch', () => {
  it('stores the file, its dimensions and its provenance in one step', async () => {
    const dir = makeProject('fetch-ok');
    jsonMock.mockResolvedValue({
      url: 'https://live.staticflickr.com/1/2_b.png', title: 'Morning Desk', creator: 'jo',
      license: 'by-sa', license_version: '2.0', attribution: '"Morning Desk" by jo (CC BY-SA 2.0)',
      foreign_landing_url: 'https://flickr.com/2', filetype: 'png',
    });
    bytesMock.mockResolvedValue({ buffer: PNG, contentType: 'image/png', finalUrl: 'https://live.staticflickr.com/1/2_b.png' });

    const r = await assetFetch({ project_path: dir, ref: 'openverse:desk', alt: 'a tidy desk from above' }) as Record<string, unknown>;
    expect(r['success']).toBe(true);
    const asset = r['asset'] as Record<string, unknown>;
    // Fetched assets land in the SHARED library by default — that is what stops
    // the same file being downloaded again for the next project.
    expect(asset['path']).toBe('lib/images/morning-desk.png');
    expect(asset['alt']).toBe('a tidy desk from above');
    expect(r['scope']).toBe('library');
    expect(fs.existsSync(path.join(projectsDir, '.library/assets/images/morning-desk.png'))).toBe(true);
    const prov = r['provenance'] as Record<string, unknown>;
    expect(prov['source']).toBe('openverse');
    expect(prov['license']).toBe('CC BY-SA 2.0');
    expect(r['attribution_required']).toContain('CC BY-SA 2.0');
    // The manifest, not just the reply, must carry the licence — that is what
    // asset_list reads back when the credit line has to be typeset.
    const index = fs.readFileSync(path.join(projectsDir, '.library/assets/index.json'), 'utf8');
    expect(index).toContain('CC BY-SA 2.0');
  });

  it('believes the wire content-type over the provider\'s claimed extension', async () => {
    const dir = makeProject('fetch-mime');
    jsonMock.mockResolvedValue({ url: 'https://live.staticflickr.com/x.jpg', title: 'Mislabelled', license: 'cc0', filetype: 'jpg' });
    bytesMock.mockResolvedValue({ buffer: PNG2, contentType: 'image/png', finalUrl: 'https://live.staticflickr.com/x.jpg' });
    const r = await assetFetch({ project_path: dir, ref: 'openverse:mime', alt: 'x', scope: 'project' }) as Record<string, unknown>;
    expect((r['asset'] as Record<string, unknown>)['path']).toBe('assets/images/mislabelled.png');
  });

  it('files an icon under assets/icons without being told', async () => {
    const dir = makeProject('fetch-icon');
    jsonMock.mockResolvedValue({ mdi: { license: { spdx: 'Apache-2.0' } } });
    bytesMock.mockResolvedValue({
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M0 0h24v24H0z"/></svg>'),
      contentType: 'image/svg+xml', finalUrl: 'https://api.iconify.design/mdi/cloud.svg',
    });
    const r = await assetFetch({ project_path: dir, ref: 'iconify:mdi:cloud', alt: 'cloud icon', scope: 'project' }) as Record<string, unknown>;
    expect((r['asset'] as Record<string, unknown>)['path']).toBe('assets/icons/mdi-cloud.svg');
  });

  it('warns when no alt was given, because the stored one describes the file not the picture', async () => {
    const dir = makeProject('fetch-noalt');
    jsonMock.mockResolvedValue({ url: 'https://live.staticflickr.com/1.png', title: 'DSC_0042', license: 'cc0' });
    bytesMock.mockResolvedValue({ buffer: PNG3, contentType: 'image/png', finalUrl: 'https://live.staticflickr.com/1.png' });
    const r = await assetFetch({ project_path: dir, ref: 'openverse:noalt' }) as Record<string, unknown>;
    const progress = r['progress'] as { status?: string; message?: string }[];
    expect(progress.some(p => String(p.message).includes('No alt'))).toBe(true);
  });

  it('reports an unrecognisable payload instead of writing a mystery file', async () => {
    const dir = makeProject('fetch-unknown');
    jsonMock.mockResolvedValue({ url: 'https://live.staticflickr.com/thing', title: 'Thing', license: 'cc0' });
    bytesMock.mockResolvedValue({ buffer: PNG, contentType: 'application/octet-stream', finalUrl: 'https://live.staticflickr.com/thing' });
    const r = await assetFetch({ project_path: dir, ref: 'openverse:mystery' });
    expect(r.success).toBe(false);
    expect(r.hint).toContain('name:');
  });

  it('requires a project and a ref before it does anything', async () => {
    expect((await assetFetch({ ref: 'openverse:abc' })).success).toBe(false);
    const dir = makeProject('fetch-noref');
    const r = await assetFetch({ project_path: dir });
    expect(r.success).toBe(false);
    expect(r.error).toContain('ref is required');
  });
});

describe('assetFetch — shared-library reuse', () => {
  it('serves a repeat fetch from the library without touching the network', async () => {
    const dir = makeProject('fetch-again');
    jsonMock.mockResolvedValue({ url: 'https://live.staticflickr.com/reuse.png', title: 'Reused', license: 'cc0' });
    bytesMock.mockResolvedValue({ buffer: Buffer.concat([PNG, Buffer.from([9])]), contentType: 'image/png', finalUrl: 'https://live.staticflickr.com/reuse.png' });
    const first = await assetFetch({ project_path: dir, ref: 'openverse:reuse', alt: 'x' }) as Record<string, unknown>;
    expect(first['deduped']).toBeUndefined();
    expect(bytesMock).toHaveBeenCalledTimes(1);

    // A DIFFERENT project asking for the same ref must not download again.
    const other = makeProject('fetch-again-2');
    const second = await assetFetch({ project_path: other, ref: 'openverse:reuse', alt: 'x' }) as Record<string, unknown>;
    expect(second['deduped']).toBe(true);
    expect(bytesMock).toHaveBeenCalledTimes(1);                       // no second download
    expect((second['asset'] as Record<string, unknown>)['path'])
      .toBe((first['asset'] as Record<string, unknown>)['path']);
  });

  it('treats a different icon colour as a different asset, not a cache hit', async () => {
    const dir = makeProject('fetch-variant');
    jsonMock.mockResolvedValue({ mdi: { license: { spdx: 'Apache-2.0' } } });
    bytesMock.mockResolvedValue({
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M0 0h24v24H0z" fill="#fff"/></svg>'),
      contentType: 'image/svg+xml', finalUrl: 'https://api.iconify.design/mdi/star.svg',
    });
    await assetFetch({ project_path: dir, ref: 'iconify:mdi:star', icon_color: '#ffffff', alt: 'star' });
    const calls = bytesMock.mock.calls.length;
    bytesMock.mockResolvedValue({
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M0 0h24v24H0z" fill="#000"/></svg>'),
      contentType: 'image/svg+xml', finalUrl: 'https://api.iconify.design/mdi/star.svg',
    });
    const black = await assetFetch({ project_path: dir, ref: 'iconify:mdi:star', icon_color: '#000000', alt: 'star' }) as Record<string, unknown>;
    expect(black['deduped']).toBeUndefined();
    expect(bytesMock.mock.calls.length).toBe(calls + 1);
  });

  it('still files into the project when asked for scope:"project"', async () => {
    const dir = makeProject('fetch-scoped');
    jsonMock.mockResolvedValue({ url: 'https://live.staticflickr.com/scoped.png', title: 'Scoped', license: 'cc0' });
    bytesMock.mockResolvedValue({ buffer: Buffer.concat([PNG, Buffer.from([7])]), contentType: 'image/png', finalUrl: 'https://live.staticflickr.com/scoped.png' });
    const r = await assetFetch({ project_path: dir, ref: 'openverse:scoped', alt: 'x', scope: 'project' }) as Record<string, unknown>;
    expect(r['scope']).toBe('project');
    expect((r['asset'] as Record<string, unknown>)['path']).toBe('assets/images/scoped.png');
    expect(fs.existsSync(path.join(dir, 'assets/images/scoped.png'))).toBe(true);
  });
});
