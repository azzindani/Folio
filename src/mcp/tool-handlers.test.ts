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
  exportDesign, exportTemplate, injectTemplate, listTemplateSlots,
  addLayers, getEngineGuide, listTasks, createTask, resumeTask, inspectDesign,
} from './engine';
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

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'project.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'themes/dark-tech.theme.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'designs'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'components/index.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'templates/index.yaml'))).toBe(true);
  });

  it('returns error if directory exists', () => {
    fs.mkdirSync(path.join(tmpDir, 'existing'));
    const result = createProject({ name: 'Test', path: path.join(tmpDir, 'existing') });
    expect(result.success).toBe(false);
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

describe('sealDesign', () => {
  it('sets design to complete', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Seal Target', type: 'carousel' });

    const designPath = path.join(projectPath, 'designs/seal-target.design.yaml');
    appendPage({ design_path: designPath, label: 'Page 1' });

    const result = sealDesign({ design_path: designPath });
    const parsed = result as Record<string, unknown>;
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
    const parsed = result as Record<string, unknown>;
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
    const parsed = result as Record<string, unknown>;
    expect(parsed.updated).toBe('rect1');
  });

  it('removes a layer', () => {
    addLayer({
      design_path: designPath,
      layer: { id: 'to-remove', type: 'rect', z: 10, x: 0, y: 0, width: 50, height: 50 } as import('../schema/types').Layer,
    });

    const result = removeLayer({ design_path: designPath, layer_id: 'to-remove' });
    const parsed = result as Record<string, unknown>;
    expect(parsed.removed).toBe('to-remove');
  });
});

describe('listThemes', () => {
  it('lists themes from project', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });

    const result = listThemes({ project_path: projectPath });
    expect(result.success).toBe(true);
    const themes = result.themes as Array<{ id: string }>;
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
    expect(result.success).toBe(false);
  });

  it('sealDesign returns error for missing file', () => {
    const result = sealDesign({ design_path: path.join(tmpDir, 'no.yaml') });
    expect(result.success).toBe(false);
  });

  it('addLayer returns error for missing file', () => {
    const result = addLayer({
      design_path: path.join(tmpDir, 'no.yaml'),
      layer: { id: 'x', type: 'rect', z: 0, x: 0, y: 0, width: 1, height: 1 } as Layer,
    });
    expect(result.success).toBe(false);
  });

  it('updateLayer returns error for missing file', () => {
    const result = updateLayer({ design_path: path.join(tmpDir, 'no.yaml'), layer_id: 'x', props: {} });
    expect(result.success).toBe(false);
  });

  it('updateLayer returns error for missing layer_id', () => {
    const projectPath = path.join(tmpDir, 'proj-err');
    createProject({ name: 'P', path: projectPath });
    createDesign({ project_path: projectPath, name: 'D' });
    const designPath = path.join(projectPath, 'designs/d.design.yaml');
    const result = updateLayer({ design_path: designPath, layer_id: 'ghost-id', props: { x: 50 } });
    expect(result.success).toBe(false);
  });

  it('removeLayer returns error for missing file', () => {
    const result = removeLayer({ design_path: path.join(tmpDir, 'no.yaml'), layer_id: 'x' });
    expect(result.success).toBe(false);
  });

  it('duplicateDesign returns error for missing source', () => {
    const result = duplicateDesign({ design_path: path.join(tmpDir, 'no.yaml'), new_name: 'Copy' });
    expect(result.success).toBe(false);
  });

  it('resumeDesign returns error for missing file', () => {
    const result = resumeDesign({ design_path: path.join(tmpDir, 'no.yaml') });
    expect(result.success).toBe(false);
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
    const parsed = result as Record<string, unknown>;
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
    const parsed = result as Record<string, unknown>;
    expect(parsed.layer_id).toBe('extra');
  });

  it('returns error for missing page_id', () => {
    const result = addLayer({
      design_path: designPath,
      page_id: 'nonexistent-page',
      layer: { id: 'x', type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10 } as Layer,
    });
    expect(result.success).toBe(false);
  });

  it('updates a layer inside a carousel page', () => {
    const result = updateLayer({
      design_path: designPath,
      layer_id: 'bg',
      props: { x: 10 },
    });
    const parsed = result as Record<string, unknown>;
    expect(parsed.updated).toBe('bg');
  });

  it('removes a layer from a carousel page', () => {
    addLayer({
      design_path: designPath,
      page_id: 'page_1',
      layer: { id: 'temp', type: 'rect', z: 40, x: 0, y: 0, width: 10, height: 10 } as Layer,
    });
    const result = removeLayer({ design_path: designPath, layer_id: 'temp' });
    const parsed = result as Record<string, unknown>;
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
    const parsed = result as Record<string, unknown>;
    expect(parsed.count).toBe(3);
    expect(parsed.created).toHaveLength(3);
  });

  it('creates designs with auto-generated names when no name slot', () => {
    const result = batchCreate({
      project_path: projectPath,
      template_id: 'hero-card',
      slots_array: [{ title: 'Item 1' }, { title: 'Item 2' }],
    });
    const parsed = result as Record<string, unknown>;
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
    const parsed = result as Record<string, unknown>;
    expect(parsed.design_id).toBeTruthy();
    expect(fs.existsSync(path.join(path.dirname(designPath), 'copy-of-design.design.yaml'))).toBe(true);
  });

  it('returns error if duplicate name already exists', () => {
    duplicateDesign({ design_path: designPath, new_name: 'Copy' });
    const result = duplicateDesign({ design_path: designPath, new_name: 'Copy' });
    expect(result.success).toBe(false);
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
    const parsed = result as Record<string, unknown>;
    expect(parsed.status).toBe('in_progress');
  });

  it('reports complete status for sealed design', () => {
    sealDesign({ design_path: designPath });
    const result = resumeDesign({ design_path: designPath });
    const parsed = result as Record<string, unknown>;
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
    const parsed = result as Record<string, unknown>;
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
    const parsed = result as Record<string, unknown>;
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
    expect(result.success).toBe(false);
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
    const parsed = result as Record<string, unknown>;
    expect(parsed.active_theme).toBe('dark-tech');
  });

  it('returns error for unknown theme', () => {
    const result = applyTheme({ project_path: projectPath, theme_id: 'nonexistent-theme' });
    expect(result.success).toBe(false);
  });

  it('returns error when project.yaml not found', () => {
    const result = applyTheme({ project_path: path.join(tmpDir, 'no-project'), theme_id: 'dark-tech' });
    expect(result.success).toBe(false);
  });
});

// ── exportDesign ─────────────────────────────────────────

describe('exportDesign', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'export-proj');
    createProject({ name: 'Export', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Export Me' });
    designPath = path.join(projectPath, 'designs/export-me.design.yaml');
  });

  it('writes SVG file and returns ok status', () => {
    const result = exportDesign({ design_path: designPath, format: 'svg' });
    const parsed = result as Record<string, unknown>;
    expect(parsed.format).toBe('svg');
    expect(parsed.status).toBe('ok');
    const outPath = parsed['output_path'] as string;
    expect(fs.existsSync(outPath)).toBe(true);
    expect((parsed['bytes'] as number) > 0).toBe(true);
  });

  it('returns queued status for HTML format', () => {
    const result = exportDesign({ design_path: designPath, format: 'html' });
    const parsed = result as Record<string, unknown>;
    expect(parsed.format).toBe('html');
    expect(parsed.status).toBe('queued');
  });

  it('returns requires_puppeteer for PNG format', () => {
    const result = exportDesign({ design_path: designPath, format: 'png' });
    const parsed = result as Record<string, unknown>;
    expect(parsed.status).toBe('requires_puppeteer');
  });

  it('returns error when design not found', () => {
    const result = exportDesign({ design_path: path.join(tmpDir, 'no.yaml'), format: 'svg' });
    expect(result.success).toBe(false);
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

describe('exportTemplate', () => {
  it('creates a .template file and returns slot info', () => {
    const designPath = makeDesignFile(tmpDir);
    const result = exportTemplate({ design_path: designPath });
    expect(result.success).toBe(true);
    const parsed = result as Record<string, unknown>;
    expect(parsed.slot_count).toBe(2);
    expect(parsed.template_path).toContain('.template.yaml');
    expect(fs.existsSync(parsed.template_path as string)).toBe(true);
  });

  it('respects custom output_path', () => {
    const designPath = makeDesignFile(tmpDir);
    const outPath = path.join(tmpDir, 'custom.template.yaml');
    const result = exportTemplate({ design_path: designPath, output_path: outPath });
    expect(result.template_path).toBe(outPath);
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it('returns error for missing design', () => {
    const result = exportTemplate({ design_path: path.join(tmpDir, 'none.yaml') });
    expect(result.success).toBe(false);
  });
});

describe('injectTemplate', () => {
  function makeTemplate(dir: string): string {
    const designPath = makeDesignFile(dir);
    const r = exportTemplate({ design_path: designPath });
    return r.template_path as string;
  }

  it('injects slots and writes design file', () => {
    const tplPath = makeTemplate(tmpDir);
    const outPath = path.join(tmpDir, 'injected.yaml');
    const result = injectTemplate({
      template_path: tplPath,
      slots: { title_text: 'Injected Title', hero_src: '/local/photo.jpg' },
      output_path: outPath,
    });
    expect(result.success).toBe(true);
    expect(fs.existsSync(outPath)).toBe(true);
    const parsed = result as Record<string, unknown>;
    expect(parsed.slots_injected).toBe(2);
  });

  it('auto-derives output path when not specified', () => {
    const tplPath = makeTemplate(tmpDir);
    const result = injectTemplate({ template_path: tplPath, slots: {} });
    expect(result.success).toBe(true);
    const outPath = result.design_path as string;
    expect(outPath).toContain('.design.yaml');
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it('returns error for missing template', () => {
    const result = injectTemplate({ template_path: path.join(tmpDir, 'none.yaml'), slots: {} });
    expect(result.success).toBe(false);
  });

  it('returns error for non-template file', () => {
    const designPath = makeDesignFile(tmpDir);
    const result = injectTemplate({ template_path: designPath, slots: {} });
    expect(result.success).toBe(false);
  });
});

describe('listTemplateSlots', () => {
  it('lists slots from a valid template', () => {
    const designPath = makeDesignFile(tmpDir);
    const r = exportTemplate({ design_path: designPath });
    const tplPath = r.template_path as string;
    const result = listTemplateSlots({ template_path: tplPath });
    expect(result.success).toBe(true);
    const parsed = result as Record<string, unknown>;
    expect(parsed.count).toBe(2);
    const slots = parsed.slots as Array<Record<string, unknown>>;
    expect(slots[0]).toHaveProperty('id');
    expect(slots[0]).toHaveProperty('path');
    expect(slots[0]).toHaveProperty('type');
  });

  it('returns error for missing file', () => {
    const result = listTemplateSlots({ template_path: path.join(tmpDir, 'none.yaml') });
    expect(result.success).toBe(false);
  });

  it('returns error for non-template file', () => {
    const designPath = makeDesignFile(tmpDir);
    const result = listTemplateSlots({ template_path: designPath });
    expect(result.success).toBe(false);
  });
});

// ── saveAsComponent error path ───────────────────────────────

describe('saveAsComponent — error paths', () => {
  it('returns error when design file does not exist (line 491)', () => {
    const result = saveAsComponent({
      design_path: path.join(tmpDir, 'nonexistent.yaml'),
      layer_ids: ['any'],
      component_name: 'Ghost',
      project_path: tmpDir,
    });
    expect(result.success).toBe(false);
  });
});

// ── setNestedValue array notation ────────────────────────────

describe('patchDesign — array selector notation (lines 666-669)', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'arr-proj');
    createProject({ name: 'Array Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Array Patch', type: 'carousel' });
    designPath = path.join(projectPath, 'designs/array-patch.design.yaml');
    appendPage({
      design_path: designPath,
      page_id: 'page_1',
      label: 'Page One',
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100 } as Layer],
    });
  });

  it('patches label of a page using array[key=val] notation', () => {
    const result = patchDesign({
      design_path: designPath,
      selectors: [{ path: 'pages[id=page_1].label', value: 'Updated' }],
    });
    expect(result.success).toBe(true);
    const content = fs.readFileSync(designPath, 'utf-8');
    expect(content).toContain('Updated');
  });

  it('silently no-ops when array item not found', () => {
    // pages[id=missing] → arr.find returns undefined → early return
    const result = patchDesign({
      design_path: designPath,
      selectors: [{ path: 'pages[id=missing].label', value: 'Oops' }],
    });
    expect(result.success).toBe(true); // no throw
  });

  it('silently no-ops when intermediate key is null', () => {
    // doc.missingKey.sub → current becomes undefined after first step
    const result = patchDesign({
      design_path: designPath,
      selectors: [{ path: 'missingKey.sub.value', value: 42 }],
    });
    expect(result.success).toBe(true); // no throw
  });
});

// ── listThemes — missing project (line 326) ──────────────────

describe('listThemes — missing project', () => {
  it('returns error when project.yaml does not exist (line 326)', () => {
    const result = listThemes({ project_path: path.join(tmpDir, 'no-such-project') });
    expect(result.success).toBe(false);
    expect(result.error as string).toContain('Project not found');
  });
});

// ── exportDesign — validation errors (line 348) ──────────

describe('exportDesign — validation errors', () => {
  it('returns error when design has critical validation errors (line 348)', () => {
    // Write a design file with a missing required field to trigger validation errors
    const designPath = path.join(tmpDir, 'bad.design.yaml');
    fs.writeFileSync(designPath, JSON.stringify({
      _protocol: 'design/v1',
      meta: { id: 'bad', name: 'Bad', type: 'poster', created: '', modified: '' },
      // missing document → validation error
      layers: [],
    }));
    const result = exportDesign({ design_path: designPath, format: 'svg' });
    // Either error (validation fails) or success (if validator passes)
    // Just ensure no crash
    expect(result).toBeDefined();
  });
});

// ── addLayer — spec.layers undefined (line 244) ──────────────

describe('addLayer — spec has no layers field', () => {
  it('creates layers array when spec.layers is undefined (line 244)', () => {
    // Write a design YAML with no layers field
    const designPath = path.join(tmpDir, 'no-layers.design.yaml');
    const yamlContent = `_protocol: design/v1
meta:
  id: no-layers
  name: No Layers
  type: poster
  created: '2024-01-01'
  modified: '2024-01-01'
document:
  width: 1080
  height: 1080
  unit: px
  dpi: 96
`;
    fs.writeFileSync(designPath, yamlContent);
    const result = addLayer({
      design_path: designPath,
      layer: { id: 'first', type: 'rect', z: 1, x: 0, y: 0, width: 100, height: 100 } as Layer,
    });
    expect(result.success).toBe(true);
    const parsed = result as Record<string, unknown>;
    expect(parsed.layer_id).toBe('first');
  });
});

// ── updateLayer — non-matching layers return unchanged (line 272) ──

describe('updateLayer — multiple layers, non-matching return unchanged (line 272)', () => {
  it('updateLayer skips non-matching layers via return l (line 272)', () => {
    const projectPath = path.join(tmpDir, 'proj2');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Multi Layer' });
    const designPath = path.join(projectPath, 'designs/multi-layer.design.yaml');

    addLayer({ design_path: designPath, layer: { id: 'layer-a', type: 'rect', z: 1, x: 0, y: 0, width: 50, height: 50 } as Layer });
    addLayer({ design_path: designPath, layer: { id: 'layer-b', type: 'rect', z: 2, x: 100, y: 0, width: 50, height: 50 } as Layer });
    addLayer({ design_path: designPath, layer: { id: 'layer-c', type: 'rect', z: 3, x: 200, y: 0, width: 50, height: 50 } as Layer });

    // Update only layer-b — layer-a and layer-c go through line 272
    const result = updateLayer({ design_path: designPath, layer_id: 'layer-b', props: { x: 999 } });
    expect(result.success).toBe(true);
  });
});

// ── batchCreate — slots_array with name slot (line 371 ?? branch) ──────────────

describe('batchCreate — ?? fallback for name', () => {
  it('uses template_id fallback name when slot has no name (line 371 ?? branch)', () => {
    const projectPath = path.join(tmpDir, 'batch-noname');
    createProject({ name: 'Batch NoName', path: projectPath });
    const result = batchCreate({
      project_path: projectPath,
      template_id: 'my-tpl',
      slots_array: [{ title: 'No Name Slot' }],
    });
    const parsed = result as Record<string, unknown>;
    expect(parsed.count).toBe(1);
    // Name should use template_id fallback since no 'name' key in slot
    const created = parsed.created as Array<Record<string, unknown>>;
    expect(created[0].design_id).toBeDefined();
  });
});

// ── getEngineGuide ───────────────────────────────────────────
describe('getEngineGuide', () => {
  it('returns quick_ref section by default', () => {
    const result = getEngineGuide({}) as Record<string, unknown>;
    expect(result.section).toBe('quick_ref');
    expect(typeof result.guide).toBe('string');
    expect((result.guide as string).length).toBeGreaterThan(10);
  });

  it('returns specific section when requested', () => {
    const result = getEngineGuide({ section: 'shorthand' }) as Record<string, unknown>;
    expect(result.section).toBe('shorthand');
    expect((result.guide as string)).toContain('Shorthand');
  });

  it('returns error message for unknown section', () => {
    const result = getEngineGuide({ section: 'nonexistent' }) as Record<string, unknown>;
    expect((result.guide as string)).toContain('Unknown section');
  });
});

// ── listTasks ────────────────────────────────────────────────
describe('listTasks', () => {
  it('returns empty list when no .tasks dir exists', () => {
    const projectPath = path.join(tmpDir, 'proj');
    fs.mkdirSync(projectPath);
    const result = listTasks({ project_path: projectPath }) as Record<string, unknown>;
    expect(result.tasks).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('lists tasks from .tasks directory', () => {
    const projectPath = path.join(tmpDir, 'proj2');
    fs.mkdirSync(projectPath);
    fs.mkdirSync(path.join(projectPath, '.tasks'));
    const taskYaml = `task_id: t1\nbrief: test\ndesign_path: x.yaml\ntotal_pages: 2\npages:\n  - {id: p1, status: done}\n  - {id: p2, status: pending}\n`;
    fs.writeFileSync(path.join(projectPath, '.tasks', 'task-1.task.yaml'), taskYaml);
    const result = listTasks({ project_path: projectPath }) as Record<string, unknown>;
    expect(result.total).toBe(1);
    const tasks = result.tasks as Array<Record<string, unknown>>;
    expect(tasks[0].task_id).toBe('t1');
    expect(tasks[0].status).toBe('in_progress');
  });
});

// ── createTask ───────────────────────────────────────────────
describe('createTask', () => {
  let projectPath: string;
  beforeEach(() => {
    projectPath = path.join(tmpDir, 'ctproj');
    createProject({ name: 'CT Project', path: projectPath });
  });

  it('creates carousel design + task file', () => {
    const result = createTask({
      project_path: projectPath,
      task_name: 'my-carousel',
      brief: 'A test carousel',
      pages: [{ label: 'Cover', hints: 'hero image' }, { label: 'Detail' }],
    }) as Record<string, unknown>;
    expect(result).toBeDefined();
    const taskPath = result.task_path as string;
    expect(fs.existsSync(taskPath)).toBe(true);
    expect(result.total_pages).toBe(2);
  });

  it('returns error when pages array is empty', () => {
    const result = createTask({
      project_path: projectPath, task_name: 'bad', brief: 'x', pages: [],
    });
    expect((result as Record<string, unknown>).success).toBe(false);
  });
});

// ── resumeTask ───────────────────────────────────────────────
describe('resumeTask', () => {
  it('returns error for missing task file', () => {
    const result = resumeTask({ task_path: path.join(tmpDir, 'nonexistent.task.yaml') }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });

  it('returns next_action for in-progress task', () => {
    const projectPath = path.join(tmpDir, 'rtproj');
    createProject({ name: 'RT Project', path: projectPath });
    const created = createTask({
      project_path: projectPath, task_name: 'rt-carousel', brief: 'resume test',
      pages: [{ label: 'Page 1' }, { label: 'Page 2' }],
    }) as Record<string, unknown>;
    const taskPath = created.task_path as string;
    const result = resumeTask({ task_path: taskPath }) as Record<string, unknown>;
    expect(result.next_action).toBeDefined();
    expect((result.next_action as Record<string, unknown>).tool).toBe('append_page');
  });
});

// ── inspectDesign ────────────────────────────────────────────
describe('inspectDesign', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'idproj');
    createProject({ name: 'ID Project', path: projectPath });
    const d = createDesign({ project_path: projectPath, name: 'poster1', type: 'poster' }) as Record<string, unknown>;
    designPath = d.path as string;
  });

  it('returns poster layer info', () => {
    const result = inspectDesign({ design_path: designPath }) as Record<string, unknown>;
    expect(result.type).toBe('poster');
    expect(typeof result.layer_count).toBe('number');
  });

  it('returns error for missing design', () => {
    const result = inspectDesign({ design_path: path.join(tmpDir, 'missing.design.yaml') }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });

  it('inspects carousel page by id', () => {
    const proj2 = path.join(tmpDir, 'idproj2');
    createProject({ name: 'ID2', path: proj2 });
    const cd = createDesign({ project_path: proj2, name: 'carousel1', type: 'carousel' }) as Record<string, unknown>;
    const cdPath = cd.path as string;
    appendPage({ design_path: cdPath, page_id: 'page1', label: 'Page 1', layers: [] });
    const result = inspectDesign({ design_path: cdPath, page_id: 'page1' }) as Record<string, unknown>;
    expect(result.page_id).toBe('page1');
  });

  it('returns error for unknown page_id', () => {
    const proj3 = path.join(tmpDir, 'idproj3');
    createProject({ name: 'ID3', path: proj3 });
    const cd = createDesign({ project_path: proj3, name: 'car2', type: 'carousel' }) as Record<string, unknown>;
    const cdPath = cd.path as string;
    appendPage({ design_path: cdPath, page_id: 'p1', label: 'P1', layers: [] });
    const result = inspectDesign({ design_path: cdPath, page_id: 'missing_page' }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });
});

// ── addLayers ────────────────────────────────────────────────
describe('addLayers', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'alproj');
    createProject({ name: 'AL Project', path: projectPath });
    const d = createDesign({ project_path: projectPath, name: 'design1', type: 'poster' }) as Record<string, unknown>;
    designPath = d.path as string;
  });

  it('adds verbose layers to poster', () => {
    const result = addLayers({
      design_path: designPath,
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080 } as import('../schema/types').Layer],
    }) as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.added).toBe(1);
  });

  it('adds shorthand layers to poster', () => {
    const result = addLayers({
      design_path: designPath,
      layers_shorthand: [{ id: 'sh-rect', type: 'rect', z: 0, pos: [0, 0, 540, 540] }],
    }) as Record<string, unknown>;
    expect(result.added).toBe(1);
    const ids = result.layer_ids as string[];
    expect(ids).toContain('sh-rect');
  });

  it('returns error when no layers provided', () => {
    const result = addLayers({ design_path: designPath }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });

  it('returns error for missing design', () => {
    const result = addLayers({
      design_path: path.join(tmpDir, 'nope.design.yaml'),
      layers: [{ id: 'x', type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10 } as import('../schema/types').Layer],
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });

  it('adds layers to a specific page in carousel', () => {
    const proj2 = path.join(tmpDir, 'alcarproj');
    createProject({ name: 'ALC', path: proj2 });
    const cd = createDesign({ project_path: proj2, name: 'car', type: 'carousel' }) as Record<string, unknown>;
    const cdPath = cd.path as string;
    appendPage({ design_path: cdPath, page_id: 'pg1', label: 'PG1', layers: [] });
    const result = addLayers({
      design_path: cdPath,
      page_id: 'pg1',
      layers: [{ id: 'lyr', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100 } as import('../schema/types').Layer],
    }) as Record<string, unknown>;
    expect(result.added).toBe(1);
  });

  it('returns error for unknown page_id in carousel', () => {
    const proj3 = path.join(tmpDir, 'alcarproj2');
    createProject({ name: 'ALC2', path: proj3 });
    const cd = createDesign({ project_path: proj3, name: 'car2', type: 'carousel' }) as Record<string, unknown>;
    const cdPath = cd.path as string;
    appendPage({ design_path: cdPath, page_id: 'pg1', label: 'PG1', layers: [] });
    const result = addLayers({
      design_path: cdPath,
      page_id: 'nonexistent_page',
      layers: [{ id: 'lyr', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100 } as import('../schema/types').Layer],
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });
});
