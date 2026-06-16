import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { browseLibrary, collectLibrary, readDesignHeader } from './library';

function writeDesign(root: string, project: string, file: string, meta: { name: string; type: string; w: number; h: number }, extra = ''): string {
  const dir = path.join(root, project, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, project), { recursive: true });
  fs.writeFileSync(path.join(root, project, 'project.yaml'), `_protocol: project/v1\nmeta:\n  name: ${project}\n`);
  const yaml = `_protocol: design/v1\nmeta:\n  id: ${file}\n  name: ${meta.name}\n  type: ${meta.type}\n  created: '2026-06-01'\n  modified: '2026-06-10'\ndocument:\n  width: ${meta.w}\n  height: ${meta.h}\n  unit: px\n  dpi: 96\n${extra}layers:\n  - id: rect_1\n    type: rect\n    x: 0\n    'y': 0\n    width: ${meta.w}\n    height: ${meta.h}\n`;
  const fp = path.join(dir, file);
  fs.writeFileSync(fp, yaml);
  return fp;
}

describe('design library', () => {
  let tmp: string;
  let prev: string | undefined;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-lib-'));
    prev = process.env['FOLIO_PROJECTS_DIR'];
    process.env['FOLIO_PROJECTS_DIR'] = tmp;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env['FOLIO_PROJECTS_DIR']; else process.env['FOLIO_PROJECTS_DIR'] = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('readDesignHeader parses meta+document from the header even with a huge layer tree', () => {
    const big = 'x'.repeat(50_000);
    const fp = writeDesign(tmp, 'alpha', 'a.design.yaml', { name: 'Alpha Poster', type: 'poster', w: 1080, h: 1350 }, `comment: ${big}\n`);
    const h = readDesignHeader(fp);
    expect(h.name).toBe('Alpha Poster');
    expect(h.type).toBe('poster');
    expect(h.width).toBe(1080);
    expect(h.height).toBe(1350);
  });

  it('catalogues every project and design across the whole collection', () => {
    writeDesign(tmp, 'alpha', 'a1.design.yaml', { name: 'Cover', type: 'poster', w: 1080, h: 1080 });
    writeDesign(tmp, 'alpha', 'a2.design.yaml', { name: 'Deck', type: 'carousel', w: 1080, h: 1080 });
    writeDesign(tmp, 'beta', 'b1.design.yaml', { name: 'Q4 Report', type: 'report', w: 1280, h: 720 });
    const { projects, totalProjects, totalDesigns } = collectLibrary();
    expect(totalProjects).toBe(2);
    expect(totalDesigns).toBe(3);
    const names = projects.flatMap(p => p.designs.map(d => d.name)).sort();
    expect(names).toEqual(['Cover', 'Deck', 'Q4 Report']);
  });

  it('browseLibrary filters by search (project OR design name) and by type', () => {
    writeDesign(tmp, 'alpha', 'a1.design.yaml', { name: 'Cover', type: 'poster', w: 1080, h: 1080 });
    writeDesign(tmp, 'alpha', 'a2.design.yaml', { name: 'Pricing Deck', type: 'carousel', w: 1080, h: 1080 });
    writeDesign(tmp, 'beta', 'b1.design.yaml', { name: 'Report', type: 'report', w: 1280, h: 720 });

    const bySearch = browseLibrary({ search: 'pricing' }) as unknown as { matched_designs: number; library: { designs: { name: string }[] }[] };
    expect(bySearch.matched_designs).toBe(1);
    expect(bySearch.library[0].designs[0].name).toBe('Pricing Deck');

    const byType = browseLibrary({ type: 'report' }) as unknown as { matched_designs: number };
    expect(byType.matched_designs).toBe(1);

    const all = browseLibrary({}) as unknown as { total_projects: number; total_designs: number; success: boolean };
    expect(all.success).toBe(true);
    expect(all.total_projects).toBe(2);
    expect(all.total_designs).toBe(3);
  });

  it('include_links adds an editor URL per design only when asked', () => {
    writeDesign(tmp, 'alpha', 'a1.design.yaml', { name: 'Cover', type: 'poster', w: 1080, h: 1080 });
    const without = browseLibrary({}) as unknown as { library: { designs: { open_url?: string }[] }[] };
    expect(without.library[0].designs[0].open_url).toBeUndefined();
    const withLinks = browseLibrary({ include_links: true }) as unknown as { library: { designs: { open_url?: string }[] }[] };
    expect(typeof withLinks.library[0].designs[0].open_url).toBe('string');
  });

  it('errors cleanly when no projects directory is configured', () => {
    delete process.env['FOLIO_PROJECTS_DIR'];
    const r = browseLibrary({}) as unknown as { success: boolean; error: string };
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/projects directory/i);
  });
});
