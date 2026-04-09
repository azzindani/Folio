import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createProject, listDesigns, createDesign,
  appendPage, patchDesign, sealDesign,
  addLayer, updateLayer, removeLayer,
  listThemes,
} from './tool-handlers';

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

    expect(result.isError).toBeUndefined();
    expect(fs.existsSync(path.join(projectPath, 'project.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'themes/dark-tech.theme.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'designs'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'components/index.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'templates/index.yaml'))).toBe(true);
  });

  it('returns error if directory exists', () => {
    fs.mkdirSync(path.join(tmpDir, 'existing'));
    const result = createProject({ name: 'Test', path: path.join(tmpDir, 'existing') });
    expect(result.isError).toBe(true);
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
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.design_id).toBeTruthy();
    expect(fs.existsSync(path.join(projectPath, 'designs/my-poster.design.yaml'))).toBe(true);
  });

  it('creates a carousel design file', () => {
    createDesign({ project_path: projectPath, name: 'My Carousel', type: 'carousel' });
    const designPath = path.join(projectPath, 'designs/my-carousel.design.yaml');
    expect(fs.existsSync(designPath)).toBe(true);
  });
});

describe('listDesigns', () => {
  it('lists designs from project', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Design A' });
    createDesign({ project_path: projectPath, name: 'Design B' });

    const result = listDesigns({ project_path: projectPath });
    const designs = JSON.parse(result.content[0].text);
    expect(designs).toHaveLength(2);
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

    const parsed = JSON.parse(result.content[0].text);
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

    const parsed = JSON.parse(result.content[0].text);
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

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.patched_paths).toContain('meta.name');
  });
});

describe('sealDesign', () => {
  it('sets design to complete', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Seal Target', type: 'carousel' });

    const designPath = path.join(projectPath, 'designs/seal-target.design.yaml');
    appendPage({ design_path: designPath, label: 'Page 1' });

    const result = sealDesign({ design_path: designPath });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('sealed');
  });
});

describe('addLayer / updateLayer / removeLayer', () => {
  let designPath: string;

  beforeEach(() => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Layer Test' });
    designPath = path.join(projectPath, 'designs/layer-test.design.yaml');
  });

  it('adds a layer', () => {
    const result = addLayer({
      design_path: designPath,
      layer: { id: 'new-rect', type: 'rect', z: 10, x: 0, y: 0, width: 100, height: 100 } as import('../schema/types').Layer,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.layer_id).toBe('new-rect');
  });

  it('updates a layer', () => {
    addLayer({
      design_path: designPath,
      layer: { id: 'rect1', type: 'rect', z: 10, x: 0, y: 0, width: 100, height: 100 } as import('../schema/types').Layer,
    });

    const result = updateLayer({
      design_path: designPath,
      layer_id: 'rect1',
      props: { x: 50, y: 50 },
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.updated).toBe('rect1');
  });

  it('removes a layer', () => {
    addLayer({
      design_path: designPath,
      layer: { id: 'to-remove', type: 'rect', z: 10, x: 0, y: 0, width: 50, height: 50 } as import('../schema/types').Layer,
    });

    const result = removeLayer({ design_path: designPath, layer_id: 'to-remove' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.removed).toBe('to-remove');
  });
});

describe('listThemes', () => {
  it('lists themes from project', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });

    const result = listThemes({ project_path: projectPath });
    const themes = JSON.parse(result.content[0].text);
    expect(themes).toHaveLength(1);
    expect(themes[0].id).toBe('dark-tech');
  });
});
