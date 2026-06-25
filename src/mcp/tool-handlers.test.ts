import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createProject, listDesigns, createDesign, appendPage, patchDesign, sealDesign, addLayers } from './engine';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createProject', () => {
  it('creates project directory structure', () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const result = createProject({ name: 'My Project', path: projectPath });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'project.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'themes/editorial-cream.theme.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'designs'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'components/index.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'templates/index.yaml'))).toBe(true);
  });

  it('returns error if directory exists', () => {
    fs.mkdirSync(path.join(tmpDir, 'existing'));
    const result = createProject({ name: 'Test', path: path.join(tmpDir, 'existing') });
    expect(result.success).toBe(false);
  });

  it('defaults the path to the name (whitespace→hyphens, case kept) under FOLIO_PROJECTS_DIR', () => {
    const prev = process.env['FOLIO_PROJECTS_DIR'];
    process.env['FOLIO_PROJECTS_DIR'] = tmpDir;
    try {
      const result = createProject({ name: 'My Project' }); // no path
      expect(result.success).toBe(true);
      const dir = path.join(tmpDir, 'My-Project');
      expect(fs.existsSync(path.join(dir, 'project.yaml'))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env['FOLIO_PROJECTS_DIR'];
      else process.env['FOLIO_PROJECTS_DIR'] = prev;
    }
  });
});

describe('createDesign', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test Project', path: projectPath });
  });

  it('creates a poster design file', () => {
    const result = createDesign({ project_path: projectPath, name: 'My Poster', type: 'poster' });
    expect(result.success).toBe(true);
    const parsed = result as Record<string, unknown>;
    expect(parsed.design_id).toBeTruthy();
    expect(fs.existsSync(path.join(projectPath, 'designs/my-poster.design.yaml'))).toBe(true);
  });

  it('creates a carousel design file', () => {
    createDesign({ project_path: projectPath, name: 'My Carousel', type: 'carousel' });
    const designPath = path.join(projectPath, 'designs/my-carousel.design.yaml');
    expect(fs.existsSync(designPath)).toBe(true);
  });

  it('returns a clean error (no crash) when project_path is missing', () => {
    // Small model omitted project_path (or passed it as `path`).
    const result = createDesign({ name: 'Orphan' } as Parameters<typeof createDesign>[0]);
    expect(result.success).toBe(false);
    expect(String((result as Record<string, unknown>).error)).toContain('project_path');
  });
});

describe('listDesigns', () => {
  it('lists designs from project', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Design A' });
    createDesign({ project_path: projectPath, name: 'Design B' });

    const result = listDesigns({ project_path: projectPath });
    expect(result.success).toBe(true);
    expect(result.designs as unknown[]).toHaveLength(2);
  });
});

describe('seal_design prunes abandoned empty drafts', () => {
  it('removes a sibling empty in-progress draft when the real design is sealed (suite-021/034/...)', () => {
    const projectPath = path.join(tmpDir, 'prune-proj');
    createProject({ name: 'Prune', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Stub' });   // created, never filled
    createDesign({ project_path: projectPath, name: 'Real' });
    const realPath = path.join(projectPath, 'designs/real.design.yaml');
    addLayers({ design_path: realPath, layers: [{ id: 'h', type: 'text', x: 100, y: 100, width: 800, height: 120, content: { type: 'plain', value: 'Real Design' }, style: { font_size: 64, color: '#1A1A1A' } }] as unknown as Parameters<typeof addLayers>[0]['layers'] });
    const r = sealDesign({ design_path: realPath });
    expect(r.success).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'designs/stub.design.yaml'))).toBe(false); // pruned
    expect(fs.existsSync(realPath)).toBe(true);                  // kept
  });
  it('does NOT prune a sibling that has real content', () => {
    const projectPath = path.join(tmpDir, 'keep-proj');
    createProject({ name: 'Keep', path: projectPath });
    createDesign({ project_path: projectPath, name: 'One' });
    addLayers({ design_path: path.join(projectPath, 'designs/one.design.yaml'), layers: [{ id: 'a', type: 'text', x: 100, y: 100, width: 800, height: 120, content: { type: 'plain', value: 'One' }, style: { font_size: 64, color: '#1A1A1A' } }] as unknown as Parameters<typeof addLayers>[0]['layers'] });
    createDesign({ project_path: projectPath, name: 'Two' });
    const twoPath = path.join(projectPath, 'designs/two.design.yaml');
    addLayers({ design_path: twoPath, layers: [{ id: 'c', type: 'text', x: 100, y: 100, width: 800, height: 120, content: { type: 'plain', value: 'Two' }, style: { font_size: 64, color: '#1A1A1A' } }] as unknown as Parameters<typeof addLayers>[0]['layers'] });
    sealDesign({ design_path: twoPath });
    expect(fs.existsSync(path.join(projectPath, 'designs/one.design.yaml'))).toBe(true); // kept
  });
});

describe('appendPage', () => {
  it('appends a page to carousel', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Carousel', type: 'carousel' });

    const designPath = path.join(projectPath, 'designs/carousel.design.yaml');
    const result = appendPage({
      design_path: designPath,
      page_id: 'cover',
      label: 'Cover Page',
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080 } as import('../schema/types').Layer],
    });

    const parsed = result as Record<string, unknown>;
    expect(parsed.page_id).toBe('cover');
    expect(parsed.page_count).toBe(1);
  });

  it('increments page count on multiple appends', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Slides', type: 'carousel' });

    const designPath = path.join(projectPath, 'designs/slides.design.yaml');
    appendPage({ design_path: designPath, label: 'Page 1' });
    appendPage({ design_path: designPath, label: 'Page 2' });
    const result = appendPage({ design_path: designPath, label: 'Page 3' });

    const parsed = result as Record<string, unknown>;
    expect(parsed.page_count).toBe(3);
  });
});

describe('patchDesign', () => {
  it('patches a field by dot-path', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Patch Target' });

    const designPath = path.join(projectPath, 'designs/patch-target.design.yaml');
    const result = patchDesign({
      design_path: designPath,
      selectors: [{ path: 'meta.name', value: 'New Name' }],
    });

    const parsed = result as Record<string, unknown>;
    expect(parsed.patched_paths).toContain('meta.name');
  });
});
