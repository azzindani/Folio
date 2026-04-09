/**
 * Integration tests: simulate real user workflows end-to-end.
 * Load YAML fixtures → parse → validate → render → verify SVG → export
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseDesign, parseTheme, serializeYAML } from '../../src/schema/parser';
import { validateDesignSpec } from '../../src/schema/validator';
import { resolveAllTokens, type TokenResolutionContext } from '../../src/engine/token-resolver';
import { renderDesign, renderPage, invalidateCache } from '../../src/renderer/renderer';
import { exportToSVG, exportToHTML } from '../../src/export/exporter';
import type { DesignSpec, ThemeSpec, Layer } from '../../src/schema/types';

const FIXTURES = path.join(__dirname, '..', 'fixtures');

function loadFixture(relativePath: string): string {
  return fs.readFileSync(path.join(FIXTURES, relativePath), 'utf-8');
}

describe('Full Poster Workflow', () => {
  let design: DesignSpec;
  let theme: ThemeSpec;

  it('1. parses full poster YAML without error', () => {
    const yamlContent = loadFixture('designs/full-poster.yaml');
    design = parseDesign(yamlContent);
    expect(design._protocol).toBe('design/v1');
    expect(design.meta.name).toBe('Full Feature Poster');
    expect(design.meta.type).toBe('poster');
  });

  it('2. validates poster with no critical errors', () => {
    const errors = validateDesignSpec(design);
    const critical = errors.filter(e => e.severity === 'error');
    expect(critical).toHaveLength(0);
  });

  it('3. poster has expected layer count and types', () => {
    expect(design.layers).toBeTruthy();
    expect(design.layers!.length).toBeGreaterThanOrEqual(10);

    const types = design.layers!.map(l => l.type);
    expect(types).toContain('rect');
    expect(types).toContain('circle');
    expect(types).toContain('text');
    expect(types).toContain('line');
    expect(types).toContain('icon');
    expect(types).toContain('polygon');
    expect(types).toContain('path');
  });

  it('4. loads theme and resolves all tokens', () => {
    const themeYaml = loadFixture('themes/dark-tech.yaml');
    theme = parseTheme(themeYaml);
    expect(theme.name).toBe('Dark Tech');

    const ctx: TokenResolutionContext = {
      theme,
      overrides: design.theme?.overrides,
    };

    const resolved = resolveAllTokens(design.layers!, ctx);

    // bg layer fill should have resolved color
    const bg = resolved.find(l => l.id === 'bg');
    expect(bg).toBeTruthy();
    if (bg?.type === 'rect' && bg.fill?.type === 'linear') {
      expect(bg.fill.stops[0].color).toBe('#1A1A2E');
      expect(bg.fill.stops[1].color).toBe('#16213E');
    }

    // text layers should have resolved font family
    const headline = resolved.find(l => l.id === 'headline');
    if (headline?.type === 'text') {
      expect(headline.style?.font_family).toBe('Inter');
      expect(headline.style?.color).toBe('#FFFFFF');
    }

    // theme override: primary should be #3D9EE4
    const badge = resolved.find(l => l.id === 'badge');
    if (badge?.type === 'rect' && badge.fill?.type === 'solid') {
      expect(badge.fill.color).toBe('#3D9EE4');
    }
  });

  it('5. renders to SVG with all layers present', () => {
    const svg = renderDesign(design, { theme });
    expect(svg.tagName).toBe('svg');
    expect(svg.getAttribute('width')).toBe('1080');

    const layerEls = svg.querySelectorAll('[data-layer-id]');
    expect(layerEls.length).toBe(design.layers!.length);

    // Verify specific layers exist
    expect(svg.querySelector('[data-layer-id="bg"]')).toBeTruthy();
    expect(svg.querySelector('[data-layer-id="headline"]')).toBeTruthy();
    expect(svg.querySelector('[data-layer-id="card"]')).toBeTruthy();
    expect(svg.querySelector('[data-layer-id="footer"]')).toBeTruthy();
  });

  it('6. SVG string contains gradient definitions', () => {
    invalidateCache(); // Clear cache so gradients are re-rendered into new defs
    const svgString = exportToSVG(design, { format: 'svg', theme });
    expect(svgString).toContain('linearGradient');
    expect(svgString).toContain('stop');
  });

  it('7. SVG string contains shadow filter', () => {
    invalidateCache();
    const svgString = exportToSVG(design, { format: 'svg', theme });
    expect(svgString).toContain('feDropShadow');
  });

  it('8. exports to SVG string', () => {
    const svgString = exportToSVG(design, { format: 'svg', theme });
    expect(svgString).toContain('<svg');
    expect(svgString).toContain('data-layer-id="bg"');
    expect(svgString).toContain('data-layer-id="headline"');
    expect(svgString).toContain('</svg>');
  });

  it('9. exports to self-contained HTML', () => {
    const html = exportToHTML(design, { format: 'html', theme });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
    expect(html).toContain(design.meta.name);
    expect(html).toContain('design-data');
  });

  it('10. roundtrips through YAML serialize/parse', () => {
    const yaml = serializeYAML(design);
    const reparsed = parseDesign(yaml);
    expect(reparsed._protocol).toBe(design._protocol);
    expect(reparsed.meta.name).toBe(design.meta.name);
    expect(reparsed.layers!.length).toBe(design.layers!.length);

    // Verify layer IDs preserved
    for (let i = 0; i < design.layers!.length; i++) {
      expect(reparsed.layers![i].id).toBe(design.layers![i].id);
    }
  });

  it('11. renders with grid overlay enabled', () => {
    const svg = renderDesign(design, { theme, showGrid: true });
    const grid = svg.querySelector('[data-role="grid-overlay"]');
    expect(grid).toBeTruthy();
  });
});

describe('Full Carousel Workflow', () => {
  let design: DesignSpec;
  let theme: ThemeSpec;

  it('1. parses carousel YAML', () => {
    design = parseDesign(loadFixture('designs/carousel-guide.yaml'));
    expect(design.meta.type).toBe('carousel');
    expect(design.pages).toBeTruthy();
    expect(design.pages!.length).toBe(3);
  });

  it('2. validates carousel', () => {
    const errors = validateDesignSpec(design);
    const critical = errors.filter(e => e.severity === 'error');
    expect(critical).toHaveLength(0);
  });

  it('3. each page has unique layer IDs', () => {
    for (const page of design.pages!) {
      const ids = page.layers!.map(l => l.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    }
  });

  it('4. renders each page independently', () => {
    theme = parseTheme(loadFixture('themes/dark-tech.yaml'));
    const { width, height } = design.document;

    for (const page of design.pages!) {
      const svg = renderPage(page.layers!, width, height, { theme });
      expect(svg.tagName).toBe('svg');
      expect(svg.querySelectorAll('[data-layer-id]').length).toBe(page.layers!.length);
    }
  });

  it('5. cover page has title and subtitle', () => {
    theme = parseTheme(loadFixture('themes/dark-tech.yaml'));
    const coverPage = design.pages![0];
    const svg = renderPage(coverPage.layers!, 1080, 1080, { theme });

    expect(svg.querySelector('[data-layer-id="cover-title"]')).toBeTruthy();
    expect(svg.querySelector('[data-layer-id="cover-subtitle"]')).toBeTruthy();
  });

  it('6. exports each page to SVG', () => {
    for (let i = 0; i < design.pages!.length; i++) {
      const svgString = exportToSVG(design, { format: 'svg', theme, pageIndex: i });
      expect(svgString).toContain('<svg');
      expect(svgString).toContain('</svg>');
    }
  });
});

describe('MCP Incremental Carousel Generation', () => {
  it('simulates create → append × 3 → seal workflow', async () => {
    const { createProject, createDesign, appendPage, sealDesign } =
      await import('../../src/mcp/tool-handlers');
    const os = await import('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-integ-'));

    try {
      // Step 1: Create project
      const projectResult = createProject({ name: 'Integration Test', path: path.join(tmpDir, 'project') });
      expect(projectResult.isError).toBeUndefined();

      const projectPath = path.join(tmpDir, 'project');

      // Step 2: Create carousel design
      const designResult = createDesign({
        project_path: projectPath,
        name: 'Integration Carousel',
        type: 'carousel',
      });
      expect(designResult.isError).toBeUndefined();

      const designPath = path.join(projectPath, 'designs/integration-carousel.design.yaml');

      // Step 3: Append 3 pages
      for (let i = 1; i <= 3; i++) {
        const appendResult = appendPage({
          design_path: designPath,
          page_id: `page_${i}`,
          label: `Page ${i}`,
          layers: [{
            id: `bg-${i}`, type: 'rect', z: 0,
            x: 0, y: 0, width: 1080, height: 1080,
            fill: { type: 'solid', color: '#1A1A2E' },
          }, {
            id: `title-${i}`, type: 'text', z: 20,
            x: 80, y: 200, width: 920,
            content: { type: 'plain', value: `Step ${i}` },
            style: { font_size: 48, font_weight: 700, color: '#FFF' },
          }],
        });
        const parsed = JSON.parse(appendResult.content[0].text);
        expect(parsed.page_count).toBe(i);
      }

      // Step 4: Seal
      const sealResult = sealDesign({ design_path: designPath });
      const sealParsed = JSON.parse(sealResult.content[0].text);
      expect(sealParsed.status).toBe('sealed');

      // Step 5: Verify the final file
      const finalYaml = fs.readFileSync(designPath, 'utf-8');
      const finalSpec = parseDesign(finalYaml);
      expect(finalSpec._mode).toBe('complete');
      expect(finalSpec.pages!.length).toBe(3);
      expect(finalSpec.meta.generation?.status).toBe('complete');
      expect(finalSpec.meta.generation?.completed_pages).toBe(3);

      // Step 6: Validate the final file
      const errors = validateDesignSpec(finalSpec);
      const critical = errors.filter(e => e.severity === 'error');
      expect(critical).toHaveLength(0);

      // Step 7: Render each page
      for (const page of finalSpec.pages!) {
        const svg = renderPage(page.layers!, 1080, 1080);
        expect(svg.querySelectorAll('[data-layer-id]').length).toBeGreaterThanOrEqual(2);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Token Resolution Edge Cases', () => {
  let theme: ThemeSpec;

  it('loads theme fixture', () => {
    theme = parseTheme(loadFixture('themes/dark-tech.yaml'));
  });

  it('resolves all color tokens', () => {
    const ctx: TokenResolutionContext = { theme };
    const layers: Layer[] = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100, fill: { type: 'solid', color: '$background' } } as Layer,
      { id: 'b', type: 'rect', z: 1, x: 0, y: 0, width: 100, height: 100, fill: { type: 'solid', color: '$surface' } } as Layer,
      { id: 'c', type: 'rect', z: 2, x: 0, y: 0, width: 100, height: 100, fill: { type: 'solid', color: '$primary' } } as Layer,
      { id: 'd', type: 'rect', z: 3, x: 0, y: 0, width: 100, height: 100, fill: { type: 'solid', color: '$secondary' } } as Layer,
    ];

    const resolved = resolveAllTokens(layers, ctx);
    const colors = resolved.map(l => {
      if (l.type === 'rect' && l.fill?.type === 'solid') return l.fill.color;
      return null;
    });

    expect(colors[0]).toBe('#1A1A2E');
    expect(colors[1]).toBe('#16213E');
    expect(colors[2]).toBe('#E94560');
    expect(colors[3]).toBe('#3D9EE4');
  });

  it('resolves typography family tokens', () => {
    const ctx: TokenResolutionContext = { theme };
    const layers: Layer[] = [
      { id: 't', type: 'text', z: 20, x: 0, y: 0, width: 100, content: { type: 'plain', value: 'Hi' }, style: { font_family: '$heading', color: '$text' } } as Layer,
    ];

    const resolved = resolveAllTokens(layers, ctx);
    if (resolved[0].type === 'text') {
      expect(resolved[0].style?.font_family).toBe('Inter');
      expect(resolved[0].style?.color).toBe('#FFFFFF');
    }
  });

  it('resolves gradient stops with token colors', () => {
    const ctx: TokenResolutionContext = { theme };
    const layers: Layer[] = [{
      id: 'g', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
      fill: {
        type: 'linear', angle: 135,
        stops: [
          { color: '$background', position: 0 },
          { color: '$primary', position: 100 },
        ],
      },
    } as Layer];

    const resolved = resolveAllTokens(layers, ctx);
    if (resolved[0].type === 'rect' && resolved[0].fill?.type === 'linear') {
      expect(resolved[0].fill.stops[0].color).toBe('#1A1A2E');
      expect(resolved[0].fill.stops[1].color).toBe('#E94560');
    }
  });

  it('applies theme overrides', () => {
    const ctx: TokenResolutionContext = { theme, overrides: { primary: '#00FF00' } };
    const layers: Layer[] = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100, fill: { type: 'solid', color: '$primary' } } as Layer,
    ];

    const resolved = resolveAllTokens(layers, ctx);
    if (resolved[0].type === 'rect' && resolved[0].fill?.type === 'solid') {
      expect(resolved[0].fill.color).toBe('#00FF00');
    }
  });

  it('returns fallback for unknown token', () => {
    const ctx: TokenResolutionContext = { theme };
    const layers: Layer[] = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100, fill: { type: 'solid', color: '$nonexistent' } } as Layer,
    ];

    const resolved = resolveAllTokens(layers, ctx);
    if (resolved[0].type === 'rect' && resolved[0].fill?.type === 'solid') {
      expect(resolved[0].fill.color).toBe('#FF00FF'); // debug pink fallback
    }
  });
});
