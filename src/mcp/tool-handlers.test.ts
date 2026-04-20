import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createProject, listDesigns, createDesign,
  appendPage, patchDesign, sealDesign,
  addLayer, updateLayer, removeLayer,
  listThemes, batchCreate, duplicateDesign,
  resumeDesign, saveAsComponent, applyTheme,
  exportDesignTool, exportTemplateTool, injectTemplateTool, listTemplateSlots,
} from './tool-handlers';
import type { Layer } from '../schema/types';

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

// ── Error path tests ─────────────────────────────────────────

describe('error paths — missing files', () => {
  it('patchDesign returns error for missing file', () => {
    const result = patchDesign({
      design_path: path.join(tmpDir, 'nonexistent.design.yaml'),
      selectors: [{ path: 'meta.name', value: 'New Name' }],
    });
    expect(result.isError).toBe(true);
  });

  it('sealDesign returns error for missing file', () => {
    const result = sealDesign({ design_path: path.join(tmpDir, 'no.yaml') });
    expect(result.isError).toBe(true);
  });

  it('addLayer returns error for missing file', () => {
    const result = addLayer({
      design_path: path.join(tmpDir, 'no.yaml'),
      layer: { id: 'x', type: 'rect', z: 0, x: 0, y: 0, width: 1, height: 1 } as Layer,
    });
    expect(result.isError).toBe(true);
  });

  it('updateLayer returns error for missing file', () => {
    const result = updateLayer({ design_path: path.join(tmpDir, 'no.yaml'), layer_id: 'x', props: {} });
    expect(result.isError).toBe(true);
  });

  it('updateLayer returns error for missing layer_id', () => {
    const projectPath = path.join(tmpDir, 'proj-err');
    createProject({ name: 'P', path: projectPath });
    createDesign({ project_path: projectPath, name: 'D' });
    const designPath = path.join(projectPath, 'designs/d.design.yaml');
    const result = updateLayer({ design_path: designPath, layer_id: 'ghost-id', props: { x: 50 } });
    expect(result.isError).toBe(true);
  });

  it('removeLayer returns error for missing file', () => {
    const result = removeLayer({ design_path: path.join(tmpDir, 'no.yaml'), layer_id: 'x' });
    expect(result.isError).toBe(true);
  });

  it('duplicateDesign returns error for missing source', () => {
    const result = duplicateDesign({ design_path: path.join(tmpDir, 'no.yaml'), new_name: 'Copy' });
    expect(result.isError).toBe(true);
  });

  it('resumeDesign returns error for missing file', () => {
    const result = resumeDesign({ design_path: path.join(tmpDir, 'no.yaml') });
    expect(result.isError).toBe(true);
  });
});

// ── patchDesign — multiple selectors ────────────────────────

describe('patchDesign — advanced', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'patch-proj');
    createProject({ name: 'Patch Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Patch Me', type: 'poster' });
    designPath = path.join(projectPath, 'designs/patch-me.design.yaml');
  });

  it('patches multiple selectors in one call', () => {
    const result = patchDesign({
      design_path: designPath,
      selectors: [
        { path: 'meta.name', value: 'Patched Name' },
        { path: 'document.width', value: 1920 },
      ],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.patched_paths).toContain('meta.name');
    expect(parsed.patched_paths).toContain('document.width');

    // Verify the file was actually updated
    const content = fs.readFileSync(designPath, 'utf-8');
    expect(content).toContain('Patched Name');
  });
});

// ── addLayer in carousel page ────────────────────────────────

describe('addLayer in carousel page', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'carousel-proj');
    createProject({ name: 'Carousel', path: projectPath });
    createDesign({ project_path: projectPath, name: 'My Carousel', type: 'carousel' });
    designPath = path.join(projectPath, 'designs/my-carousel.design.yaml');

    appendPage({
      design_path: designPath,
      page_id: 'page_1',
      label: 'Page One',
      layers: [{
        id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080,
        fill: { type: 'solid', color: '#000' },
      } as Layer],
    });
  });

  it('adds a layer to a specific page', () => {
    const result = addLayer({
      design_path: designPath,
      page_id: 'page_1',
      layer: { id: 'extra', type: 'rect', z: 30, x: 100, y: 100, width: 200, height: 200 } as Layer,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.layer_id).toBe('extra');
  });

  it('returns error for missing page_id', () => {
    const result = addLayer({
      design_path: designPath,
      page_id: 'nonexistent-page',
      layer: { id: 'x', type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10 } as Layer,
    });
    expect(result.isError).toBe(true);
  });

  it('updates a layer inside a carousel page', () => {
    const result = updateLayer({
      design_path: designPath,
      layer_id: 'bg',
      props: { x: 10 },
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.updated).toBe('bg');
  });

  it('removes a layer from a carousel page', () => {
    addLayer({
      design_path: designPath,
      page_id: 'page_1',
      layer: { id: 'temp', type: 'rect', z: 40, x: 0, y: 0, width: 10, height: 10 } as Layer,
    });
    const result = removeLayer({ design_path: designPath, layer_id: 'temp' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.removed).toBe('temp');
  });
});

// ── batchCreate ─────────────────────────────────────────────

describe('batchCreate', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'batch-proj');
    createProject({ name: 'Batch', path: projectPath });
  });

  it('creates N designs from N slot arrays', () => {
    const result = batchCreate({
      project_path: projectPath,
      template_id: 'my-template',
      slots_array: [
        { name: 'Design Alpha', title: 'Alpha Title' },
        { name: 'Design Beta', title: 'Beta Title' },
        { name: 'Design Gamma', title: 'Gamma Title' },
      ],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(3);
    expect(parsed.created).toHaveLength(3);
  });

  it('creates designs with auto-generated names when no name slot', () => {
    const result = batchCreate({
      project_path: projectPath,
      template_id: 'hero-card',
      slots_array: [{ title: 'Item 1' }, { title: 'Item 2' }],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
  });
});

// ── duplicateDesign ─────────────────────────────────────────

describe('duplicateDesign', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'dup-proj');
    createProject({ name: 'Dup Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Original Design' });
    designPath = path.join(projectPath, 'designs/original-design.design.yaml');
  });

  it('creates a copy with a new name', () => {
    const result = duplicateDesign({ design_path: designPath, new_name: 'Copy Of Design' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.design_id).toBeTruthy();
    expect(fs.existsSync(path.join(path.dirname(designPath), 'copy-of-design.design.yaml'))).toBe(true);
  });

  it('returns error if duplicate name already exists', () => {
    duplicateDesign({ design_path: designPath, new_name: 'Copy' });
    const result = duplicateDesign({ design_path: designPath, new_name: 'Copy' });
    expect(result.isError).toBe(true);
  });

  it('registers in project.yaml when project_path provided', () => {
    duplicateDesign({ design_path: designPath, new_name: 'Registered Copy', project_path: projectPath });
    const projectYaml = fs.readFileSync(path.join(projectPath, 'project.yaml'), 'utf-8');
    expect(projectYaml).toContain('registered-copy');
  });
});

// ── resumeDesign ─────────────────────────────────────────────

describe('resumeDesign', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'resume-proj');
    createProject({ name: 'Resume Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'In Progress', type: 'carousel' });
    designPath = path.join(projectPath, 'designs/in-progress.design.yaml');
  });

  it('reports in_progress status for unsealed design', () => {
    const result = resumeDesign({ design_path: designPath });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('in_progress');
  });

  it('reports complete status for sealed design', () => {
    sealDesign({ design_path: designPath });
    const result = resumeDesign({ design_path: designPath });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('complete');
  });

  it('reports completed pages count', () => {
    for (let i = 1; i <= 3; i++) {
      appendPage({
        design_path: designPath,
        page_id: `page_${i}`, label: `Page ${i}`,
        layers: [{ id: `bg-${i}`, type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080 } as Layer],
      });
    }
    const result = resumeDesign({ design_path: designPath });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.completed_pages).toBe(3);
  });
});

// ── saveAsComponent ──────────────────────────────────────────

describe('saveAsComponent', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'comp-proj');
    createProject({ name: 'Component Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Source Design' });
    designPath = path.join(projectPath, 'designs/source-design.design.yaml');

    addLayer({ design_path: designPath, layer: { id: 'hero', type: 'rect', z: 10, x: 0, y: 0, width: 400, height: 200 } as Layer });
    addLayer({ design_path: designPath, layer: { id: 'title', type: 'text', z: 20, x: 10, y: 10, width: 380, content: { type: 'plain', value: 'Hero Title' }, style: {} } as Layer });
  });

  it('extracts layers to a component file', () => {
    const result = saveAsComponent({
      design_path: designPath,
      layer_ids: ['hero', 'title'],
      component_name: 'Hero Card',
      project_path: projectPath,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.component_id).toBe('hero-card');
    expect(parsed.layers_extracted).toBe(2);
    expect(fs.existsSync(path.join(projectPath, 'components/hero-card.component.yaml'))).toBe(true);
  });

  it('returns error when no matching layers found', () => {
    const result = saveAsComponent({
      design_path: designPath,
      layer_ids: ['nonexistent-layer'],
      component_name: 'Ghost Component',
      project_path: projectPath,
    });
    expect(result.isError).toBe(true);
  });
});

// ── applyTheme ───────────────────────────────────────────────

describe('applyTheme', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'theme-proj');
    createProject({ name: 'Theme Test', path: projectPath });
  });

  it('applies an existing theme', () => {
    const result = applyTheme({ project_path: projectPath, theme_id: 'dark-tech' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.active_theme).toBe('dark-tech');
  });

  it('returns error for unknown theme', () => {
    const result = applyTheme({ project_path: projectPath, theme_id: 'nonexistent-theme' });
    expect(result.isError).toBe(true);
  });

  it('returns error when project.yaml not found', () => {
    const result = applyTheme({ project_path: path.join(tmpDir, 'no-project'), theme_id: 'dark-tech' });
    expect(result.isError).toBe(true);
  });
});

// ── exportDesignTool ─────────────────────────────────────────

describe('exportDesignTool', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'export-proj');
    createProject({ name: 'Export', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Export Me' });
    designPath = path.join(projectPath, 'designs/export-me.design.yaml');
  });

  it('returns queued status for SVG format', () => {
    const result = exportDesignTool({ design_path: designPath, format: 'svg' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.format).toBe('svg');
    expect(parsed.status).toBe('queued');
  });

  it('returns queued status for HTML format', () => {
    const result = exportDesignTool({ design_path: designPath, format: 'html' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.format).toBe('html');
    expect(parsed.status).toBe('queued');
  });

  it('returns requires_puppeteer for PNG format', () => {
    const result = exportDesignTool({ design_path: designPath, format: 'png' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('requires_puppeteer');
  });

  it('returns error when design not found', () => {
    const result = exportDesignTool({ design_path: path.join(tmpDir, 'no.yaml'), format: 'svg' });
    expect(result.isError).toBe(true);
  });
});

// ── Template tools ─────────────────────────────────────────
function makeDesignFile(dir: string): string {
  const p = path.join(dir, 'test.design.yaml');
  const spec = {
    _protocol: 'design/v1',
    meta: { id: 't1', name: 'Test', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers: [
      { id: 'title', type: 'text', z: 10, x: 0, y: 0, width: 500, height: 80,
        content: { type: 'plain', value: 'Hello World' }, style: { font_size: 48 } },
      { id: 'hero', type: 'image', z: 5, x: 0, y: 100, width: 400, height: 300, src: 'https://example.com/img.jpg' },
    ],
  };
  fs.writeFileSync(p, JSON.stringify(spec));
  return p;
}

describe('exportTemplateTool', () => {
  it('creates a .template file and returns slot info', () => {
    const designPath = makeDesignFile(tmpDir);
    const result = exportTemplateTool({ design_path: designPath });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.slot_count).toBe(2);
    expect(parsed.template_path).toContain('.template.yaml');
    expect(fs.existsSync(parsed.template_path)).toBe(true);
  });

  it('respects custom output_path', () => {
    const designPath = makeDesignFile(tmpDir);
    const outPath = path.join(tmpDir, 'custom.template.yaml');
    const result = exportTemplateTool({ design_path: designPath, output_path: outPath });
    expect(JSON.parse(result.content[0].text).template_path).toBe(outPath);
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it('returns error for missing design', () => {
    const result = exportTemplateTool({ design_path: path.join(tmpDir, 'none.yaml') });
    expect(result.isError).toBe(true);
  });
});

describe('injectTemplateTool', () => {
  function makeTemplate(dir: string): string {
    const designPath = makeDesignFile(dir);
    const r = exportTemplateTool({ design_path: designPath });
    return JSON.parse(r.content[0].text).template_path as string;
  }

  it('injects slots and writes design file', () => {
    const tplPath = makeTemplate(tmpDir);
    const outPath = path.join(tmpDir, 'injected.yaml');
    const result = injectTemplateTool({
      template_path: tplPath,
      slots: { title_text: 'Injected Title', hero_src: '/local/photo.jpg' },
      output_path: outPath,
    });
    expect(result.isError).toBeUndefined();
    expect(fs.existsSync(outPath)).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.slots_injected).toBe(2);
  });

  it('auto-derives output path when not specified', () => {
    const tplPath = makeTemplate(tmpDir);
    const result = injectTemplateTool({ template_path: tplPath, slots: {} });
    expect(result.isError).toBeUndefined();
    const outPath = JSON.parse(result.content[0].text).design_path as string;
    expect(outPath).toContain('.design.yaml');
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it('returns error for missing template', () => {
    const result = injectTemplateTool({ template_path: path.join(tmpDir, 'none.yaml'), slots: {} });
    expect(result.isError).toBe(true);
  });

  it('returns error for non-template file', () => {
    const designPath = makeDesignFile(tmpDir);
    const result = injectTemplateTool({ template_path: designPath, slots: {} });
    expect(result.isError).toBe(true);
  });
});

describe('listTemplateSlots', () => {
  it('lists slots from a valid template', () => {
    const designPath = makeDesignFile(tmpDir);
    const r = exportTemplateTool({ design_path: designPath });
    const tplPath = JSON.parse(r.content[0].text).template_path as string;
    const result = listTemplateSlots({ template_path: tplPath });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
    expect(parsed.slots[0]).toHaveProperty('id');
    expect(parsed.slots[0]).toHaveProperty('path');
    expect(parsed.slots[0]).toHaveProperty('type');
  });

  it('returns error for missing file', () => {
    const result = listTemplateSlots({ template_path: path.join(tmpDir, 'none.yaml') });
    expect(result.isError).toBe(true);
  });

  it('returns error for non-template file', () => {
    const designPath = makeDesignFile(tmpDir);
    const result = listTemplateSlots({ template_path: designPath });
    expect(result.isError).toBe(true);
  });
});
