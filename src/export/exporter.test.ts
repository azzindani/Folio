/**
 * Unit tests for export/exporter.ts
 * Coverage target: 80%+
 * PNG/PDF tests are skipped (require real canvas/blob API not available in jsdom).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportToSVG, exportToHTML, downloadText, downloadBlob } from './exporter';
import type { DesignSpec, ThemeSpec } from '../schema/types';

// ── Fixtures ─────────────────────────────────────────────────

function makeSpec(overrides: Partial<DesignSpec> = {}): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test-export', name: 'Export Test', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080,
        fill: { type: 'solid', color: '#1A1A2E' } } as DesignSpec['layers'] extends Array<infer L> ? L : never,
      { id: 'headline', type: 'text', z: 20, x: 80, y: 200, width: 920,
        content: { type: 'plain', value: 'Test Headline' },
        style: { font_size: 72, font_weight: 700, color: '#FFFFFF' } } as DesignSpec['layers'] extends Array<infer L> ? L : never,
    ],
    ...overrides,
  };
}

function makeTheme(): ThemeSpec {
  return {
    _protocol: 'theme/v1',
    name: 'Test Theme', version: '1.0.0',
    colors: { primary: '#E94560', background: '#1A1A2E', text: '#FFFFFF' },
    typography: { scale: {}, families: { heading: 'Inter', body: 'Inter', mono: 'mono' } },
    spacing: { unit: 8, scale: [] },
    effects: {},
    radii: { md: 8 },
  };
}

function makeCarouselSpec(): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'carousel', name: 'Carousel', type: 'carousel', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    pages: [
      {
        id: 'page_1', label: 'Page 1',
        layers: [
          { id: 'bg-1', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080,
            fill: { type: 'solid', color: '#000' } } as DesignSpec['layers'] extends Array<infer L> ? L : never,
        ],
      },
      {
        id: 'page_2', label: 'Page 2',
        layers: [
          { id: 'bg-2', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080,
            fill: { type: 'solid', color: '#FFF' } } as DesignSpec['layers'] extends Array<infer L> ? L : never,
        ],
      },
    ],
  };
}

// ── exportToSVG ──────────────────────────────────────────────

describe('exportToSVG', () => {
  it('returns a string starting with <svg', () => {
    const result = exportToSVG(makeSpec(), { format: 'svg' });
    expect(typeof result).toBe('string');
    expect(result).toContain('<svg');
    expect(result).toContain('</svg>');
  });

  it('includes layer data-layer-id attributes', () => {
    const result = exportToSVG(makeSpec(), { format: 'svg' });
    expect(result).toContain('data-layer-id="bg"');
    expect(result).toContain('data-layer-id="headline"');
  });

  it('renders with correct dimensions', () => {
    const result = exportToSVG(makeSpec(), { format: 'svg' });
    expect(result).toContain('width="1080"');
    expect(result).toContain('height="1080"');
  });

  it('resolves theme tokens when theme provided', () => {
    const spec = makeSpec();
    // Use a theme token in the spec
    const specWithToken: DesignSpec = {
      ...spec,
      layers: [{
        id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080,
        fill: { type: 'solid', color: '$primary' },
      } as DesignSpec['layers'] extends Array<infer L> ? L : never],
    };
    const theme = makeTheme();
    const result = exportToSVG(specWithToken, { format: 'svg', theme });
    // Token $primary resolved to #E94560
    expect(result).toContain('#E94560');
  });

  it('renders a specific carousel page when pageIndex provided', () => {
    const spec = makeCarouselSpec();
    const result = exportToSVG(spec, { format: 'svg', pageIndex: 0 });
    expect(result).toContain('data-layer-id="bg-1"');
    expect(result).not.toContain('data-layer-id="bg-2"');
  });

  it('renders second carousel page when pageIndex=1', () => {
    const spec = makeCarouselSpec();
    const result = exportToSVG(spec, { format: 'svg', pageIndex: 1 });
    expect(result).toContain('data-layer-id="bg-2"');
    expect(result).not.toContain('data-layer-id="bg-1"');
  });

  it('renders all layers for poster (no pageIndex)', () => {
    const result = exportToSVG(makeSpec(), { format: 'svg' });
    expect(result).toContain('data-layer-id="bg"');
    expect(result).toContain('data-layer-id="headline"');
  });
});

// ── exportToHTML ─────────────────────────────────────────────

describe('exportToHTML', () => {
  it('returns a valid HTML string', () => {
    const result = exportToHTML(makeSpec(), { format: 'html' });
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('<html');
    expect(result).toContain('</html>');
  });

  it('embeds the SVG', () => {
    const result = exportToHTML(makeSpec(), { format: 'html' });
    expect(result).toContain('<svg');
    expect(result).toContain('</svg>');
  });

  it('includes design name in <title>', () => {
    const result = exportToHTML(makeSpec(), { format: 'html' });
    expect(result).toContain('<title>Export Test</title>');
  });

  it('embeds design data as JSON in script tag', () => {
    const result = exportToHTML(makeSpec(), { format: 'html' });
    expect(result).toContain('id="design-data"');
    expect(result).toContain('"_protocol": "design/v1"');
  });

  it('includes basic CSS reset', () => {
    const result = exportToHTML(makeSpec(), { format: 'html' });
    expect(result).toContain('<style>');
    expect(result).toContain('box-sizing: border-box');
  });

  it('includes animation CSS when animations provided', () => {
    const animations = new Map();
    animations.set('headline', {
      enter: { type: 'fade_up', delay: 0, duration: 600, easing: 'ease-out' },
    });
    const result = exportToHTML(makeSpec(), { format: 'html-animated', animations });
    // The HTML should contain something from animation CSS
    expect(result).toContain('<!DOCTYPE html>');
  });
});

// ── downloadText / downloadBlob ──────────────────────────────

describe('downloadText and downloadBlob', () => {
  beforeEach(() => {
    // jsdom doesn't implement URL.createObjectURL — provide a minimal stub
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      value: vi.fn().mockReturnValue('blob:mock-url'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      value: vi.fn(),
    });
    // Stub anchor click so jsdom doesn't try to navigate
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('downloadText calls createObjectURL and revokes after click', () => {
    downloadText('<svg>hello</svg>', 'export.svg', 'image/svg+xml');
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('downloadBlob calls createObjectURL with the blob', () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    downloadBlob(blob, 'file.txt');
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
