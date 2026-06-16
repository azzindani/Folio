import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exportLibraryGallery } from './library-gallery';

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
