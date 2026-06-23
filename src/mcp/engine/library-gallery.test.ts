import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exportLibraryGallery, buildLibraryPage } from './library-gallery';
import { loadCollections, allCollections } from './library-collections';
import type { LibraryProject } from './library';

function writeDesign(root: string, project: string, file: string, name: string, type: string): void {
  const dir = path.join(root, project, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, project, 'project.yaml'), `_protocol: project/v1\nmeta:\n  name: ${project}\n`);
  fs.writeFileSync(path.join(dir, file),
    `_protocol: design/v1\nmeta:\n  id: ${file}\n  name: ${name}\n  type: ${type}\n  created: '2026-06-01'\n  modified: '2026-06-10'\ndocument:\n  width: 400\n  height: 400\n  unit: px\n  dpi: 96\nlayers:\n  - id: bg\n    type: rect\n    x: 0\n    'y': 0\n    width: 400\n    height: 400\n    fill:\n      type: solid\n      color: '#FAF5EC'\n`);
}

describe('library gallery', () => {
  let tmp: string;
  let prev: string | undefined;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-gal-'));
    prev = process.env['FOLIO_PROJECTS_DIR'];
    process.env['FOLIO_PROJECTS_DIR'] = tmp;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env['FOLIO_PROJECTS_DIR']; else process.env['FOLIO_PROJECTS_DIR'] = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes a self-contained gallery HTML cataloguing every design', () => {
    writeDesign(tmp, 'alpha', 'a1.design.yaml', 'Cover', 'poster');
    writeDesign(tmp, 'beta', 'b1.design.yaml', 'Q4 Report', 'report');
    const r = exportLibraryGallery({ max_thumbnails: 0 }) as unknown as { success: boolean; gallery_path: string; total_designs: number };
    expect(r.success).toBe(true);
    expect(r.total_designs).toBe(2);
    const html = fs.readFileSync(r.gallery_path, 'utf8');
    expect(html).toContain('Design Library');
    expect(html).toContain('Cover');
    expect(html).toContain('Q4 Report');
    expect(html).toContain('id="q"');          // live search box
    expect(html).toContain('data-name');        // searchable cards
    expect(html).toContain('class="proj"');     // project shown per card (flat grid)
    expect(html).toContain('data-type="poster"'); // type on card for chip filtering
    expect(html).toContain('class="chip"');     // type filter chips
    // search index includes the project name, so you can filter by project too
    expect(html).toMatch(/data-name="[^"]*alpha[^"]*"/);
  });

  it('renders thumbnails and caches them by mtime (second run is free)', () => {
    writeDesign(tmp, 'alpha', 'a1.design.yaml', 'Cover', 'poster');
    const r1 = exportLibraryGallery({ max_thumbnails: 5 }) as unknown as { thumbnails_rendered: number; gallery_path: string };
    expect(r1.thumbnails_rendered).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(tmp, '.library', 'thumbs'))).toBe(true);
    const r2 = exportLibraryGallery({ max_thumbnails: 5 }) as unknown as { thumbnails_rendered: number };
    expect(r2.thumbnails_rendered).toBe(0);     // cache hit, nothing re-rendered
  });

  it('escapes HTML in design names (no injection)', () => {
    writeDesign(tmp, 'alpha', 'a1.design.yaml', 'Cover <script>x</script>', 'poster');
    const r = exportLibraryGallery({ max_thumbnails: 0 }) as unknown as { gallery_path: string };
    const html = fs.readFileSync(r.gallery_path, 'utf8');
    expect(html).toContain('Cover &lt;script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });
});

describe('buildLibraryPage (shared live + snapshot renderer)', () => {
  const collState = loadCollections(os.tmpdir());
  const projects: LibraryProject[] = [{
    name: 'noise-band', project_path: '/p/noise-band', modified: '2026-06-22T10:00:00.000Z', design_count: 2,
    designs: [
      { name: 'Concrete Lung Flyer', type: 'poster', design_path: '/p/noise-band/designs/a.design.yaml', width: 1080, height: 1080, modified: '2026-06-22T10:00:00.000Z' },
      { name: 'Tour Carousel', type: 'carousel', design_path: '/p/noise-band/designs/b.design.yaml', width: 1080, height: 1350, pages: 3, modified: '2026-06-21T09:00:00.000Z' },
    ],
  }];
  const build = (live: boolean): string => buildLibraryPage({
    projects, totalProjects: 1, totalDesigns: 2, root: '/p',
    cols: allCollections(collState), collState,
    thumbHref: (_d, key) => `/__library/thumb?d=${encodeURIComponent(key)}`, live,
  });

  it('renders a card per design with a live thumbnail src + sortable data attrs', () => {
    const html = build(true);
    expect(html).toContain('<title>Folio — Design Library</title>');
    expect(html).toContain('Concrete Lung Flyer');
    expect(html).toContain('Tour Carousel');
    expect(html).toContain('/__library/thumb?d=');
    expect(html).toContain('data-mod="2026-06-22T10:00:00.000Z"');
    expect(html).toContain('data-proj="noise-band"');
  });

  it('includes sort controls, a grid/list view toggle, and type chips', () => {
    const html = build(true);
    for (const s of ['newest', 'name', 'type', 'project']) expect(html).toContain(`data-s="${s}"`);
    expect(html).toContain('data-v="grid"');
    expect(html).toContain('data-v="list"');
    expect(html).toContain('data-t="carousel"');
  });

  it('wires the auto-refresh signature + poll only when served live', () => {
    const live = build(true);
    expect(live).toContain('window.__libSig=');
    expect(live).toContain('/__library/stat');
    expect(live).toContain('"count":2');
    expect(build(false)).not.toContain('window.__libSig=');
  });
});
