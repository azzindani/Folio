/**
 * Unit tests for layer-renderers.ts
 * Coverage target: 80%+
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderPath, renderPolygon, renderLine,
  renderImage, renderIcon, renderMermaid, renderChart,
  renderCode, renderMath, renderGroup, renderRect,
  renderQRCode, renderAutoLayout,
  renderInteractiveChart, renderInteractiveTable, renderRichText,
  renderKpiCard, renderMap, renderEmbedCode, renderPopup,
} from './layer-renderers';

// Simple render fn for group tests (avoids circular import with renderer.ts)
const simpleRenderFn = (layer: Layer, svg: SVGSVGElement): SVGElement => {
  // For tests, always render as rect
  return renderRect({
    id: layer.id, type: 'rect', z: layer.z,
    x: (layer as RectLayer).x ?? 0,
    y: (layer as RectLayer).y ?? 0,
    width: (layer as RectLayer).width ?? 10,
    height: (layer as RectLayer).height ?? 10,
  }, svg);
};
import { createSVGRoot, resetDefIdCounter } from './svg-utils';
import type {
  Layer, PathLayer, PolygonLayer, LineLayer, ImageLayer, IconLayer,
  MermaidLayer, ChartLayer, CodeLayer, MathLayer, GroupLayer, RectLayer,
  QRCodeLayer, AutoLayoutLayer,
  InteractiveChartLayer, InteractiveTableLayer, RichTextLayer,
  KpiCardLayer, MapLayer, EmbedCodeLayer, PopupLayer,
} from '../schema/types';

function makeSVG() {
  return createSVGRoot(1080, 1080);
}

beforeEach(() => {
  resetDefIdCounter();
});

// ── Path ────────────────────────────────────────────────────

describe('renderPath', () => {
  it('renders a <path> element with the d attribute', () => {
    const layer: PathLayer = {
      id: 'p', type: 'path', z: 0,
      d: 'M 0 0 L 100 100',
    };
    const el = renderPath(layer, makeSVG());
    expect(el.tagName).toBe('path');
    expect(el.getAttribute('d')).toBe('M 0 0 L 100 100');
    expect(el.getAttribute('data-layer-id')).toBe('p');
  });

  it('renders fill: none when no fill specified', () => {
    const layer: PathLayer = { id: 'p2', type: 'path', z: 0, d: 'M 0 0' };
    const el = renderPath(layer, makeSVG());
    expect(el.getAttribute('fill')).toBe('none');
  });

  it('applies solid fill when provided', () => {
    const layer: PathLayer = {
      id: 'p3', type: 'path', z: 0, d: 'M 0 0',
      fill: { type: 'solid', color: '#FF0000' },
    };
    const el = renderPath(layer, makeSVG());
    expect(el.getAttribute('fill')).toBe('#FF0000');
  });

  it('applies stroke when provided', () => {
    const layer: PathLayer = {
      id: 'p4', type: 'path', z: 0, d: 'M 0 0',
      stroke: { color: '#0000FF', width: 2 },
    };
    const el = renderPath(layer, makeSVG());
    expect(el.getAttribute('stroke')).toBe('#0000FF');
    expect(el.getAttribute('stroke-width')).toBe('2');
  });
});

// ── Polygon ─────────────────────────────────────────────────

describe('renderPolygon', () => {
  it('renders a <polygon> with explicit points', () => {
    const layer: PolygonLayer = {
      id: 'poly', type: 'polygon', z: 0,
      x: 0, y: 0, width: 100, height: 100,
      points: '0,0 100,0 50,100',
    };
    const el = renderPolygon(layer, makeSVG());
    expect(el.tagName).toBe('polygon');
    expect(el.getAttribute('points')).toBe('0,0 100,0 50,100');
  });

  it('computes hexagon points from sides=6', () => {
    const layer: PolygonLayer = {
      id: 'hex', type: 'polygon', z: 0,
      x: 0, y: 0, width: 100, height: 100,
      sides: 6,
    };
    const el = renderPolygon(layer, makeSVG());
    const pts = el.getAttribute('points')!;
    const pairs = pts.trim().split(' ');
    expect(pairs).toHaveLength(6);
  });

  it('computes triangle points from sides=3', () => {
    const layer: PolygonLayer = {
      id: 'tri', type: 'polygon', z: 0,
      x: 0, y: 0, width: 100, height: 100,
      sides: 3,
    };
    const el = renderPolygon(layer, makeSVG());
    const pts = el.getAttribute('points')!.trim().split(' ');
    expect(pts).toHaveLength(3);
  });

  it('applies no fill when none provided', () => {
    const layer: PolygonLayer = {
      id: 'poly2', type: 'polygon', z: 0,
      x: 0, y: 0, width: 50, height: 50,
      points: '0,0 50,0 25,50',
    };
    const el = renderPolygon(layer, makeSVG());
    expect(el.getAttribute('fill')).toBe('none');
  });

  it('applies fill when provided', () => {
    const layer: PolygonLayer = {
      id: 'poly3', type: 'polygon', z: 0,
      x: 0, y: 0, width: 50, height: 50,
      points: '0,0 50,0 25,50',
      fill: { type: 'solid', color: '#ABCDEF' },
    };
    const el = renderPolygon(layer, makeSVG());
    expect(el.getAttribute('fill')).toBe('#ABCDEF');
  });
});

// ── Line ────────────────────────────────────────────────────

describe('renderLine', () => {
  it('renders a <line> element with coordinates', () => {
    const layer: LineLayer = {
      id: 'l', type: 'line', z: 0,
      x1: 0, y1: 0, x2: 100, y2: 100,
    };
    const el = renderLine(layer, makeSVG());
    expect(el.tagName).toBe('line');
    expect(el.getAttribute('x1')).toBe('0');
    expect(el.getAttribute('y1')).toBe('0');
    expect(el.getAttribute('x2')).toBe('100');
    expect(el.getAttribute('y2')).toBe('100');
    expect(el.getAttribute('data-layer-id')).toBe('l');
  });

  it('applies default stroke when none provided', () => {
    const layer: LineLayer = {
      id: 'l2', type: 'line', z: 0,
      x1: 0, y1: 0, x2: 50, y2: 50,
    };
    const el = renderLine(layer, makeSVG());
    expect(el.getAttribute('stroke')).toBe('#000');
    expect(el.getAttribute('stroke-width')).toBe('1');
  });

  it('applies custom stroke when provided', () => {
    const layer: LineLayer = {
      id: 'l3', type: 'line', z: 0,
      x1: 0, y1: 0, x2: 50, y2: 50,
      stroke: { color: '#FF0000', width: 3, dash: [5, 3] },
    };
    const el = renderLine(layer, makeSVG());
    expect(el.getAttribute('stroke')).toBe('#FF0000');
    expect(el.getAttribute('stroke-width')).toBe('3');
    expect(el.getAttribute('stroke-dasharray')).toBe('5 3');
  });
});

// ── Image ───────────────────────────────────────────────────

describe('renderImage', () => {
  it('renders an <image> element with src', () => {
    const layer: ImageLayer = {
      id: 'img', type: 'image', z: 0,
      x: 10, y: 20, width: 300, height: 200,
      src: '/assets/photo.png',
    };
    const el = renderImage(layer, makeSVG());
    expect(el.tagName).toBe('image');
    expect(el.getAttribute('href')).toBe('/assets/photo.png');
    expect(el.getAttribute('x')).toBe('10');
    expect(el.getAttribute('y')).toBe('20');
    expect(el.getAttribute('width')).toBe('300');
    expect(el.getAttribute('height')).toBe('200');
    expect(el.getAttribute('data-layer-id')).toBe('img');
  });

  it('sets preserveAspectRatio for fit=cover', () => {
    const layer: ImageLayer = {
      id: 'img-cover', type: 'image', z: 0,
      x: 0, y: 0, width: 100, height: 100,
      src: '/img.jpg', fit: 'cover',
    };
    const el = renderImage(layer, makeSVG());
    expect(el.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
  });

  it('sets preserveAspectRatio for fit=contain', () => {
    const layer: ImageLayer = {
      id: 'img-contain', type: 'image', z: 0,
      x: 0, y: 0, width: 100, height: 100,
      src: '/img.jpg', fit: 'contain',
    };
    const el = renderImage(layer, makeSVG());
    expect(el.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });

  it('does not set preserveAspectRatio for fit=fill', () => {
    const layer: ImageLayer = {
      id: 'img-fill', type: 'image', z: 0,
      x: 0, y: 0, width: 100, height: 100,
      src: '/img.jpg', fit: 'fill',
    };
    const el = renderImage(layer, makeSVG());
    expect(el.getAttribute('preserveAspectRatio')).toBeNull();
  });
});

// ── Icon ────────────────────────────────────────────────────

describe('renderIcon', () => {
  it('renders a group with a real Lucide SVG for known icons', () => {
    const layer: IconLayer = {
      id: 'ic', type: 'icon', z: 0,
      x: 10, y: 10,
      name: 'download', size: 24, color: '#E94560',
    };
    const el = renderIcon(layer, makeSVG());
    expect(el.tagName).toBe('g');
    expect(el.getAttribute('data-layer-id')).toBe('ic');
    // Known icon → nested <svg> element
    const innerSvg = el.querySelector('svg');
    expect(innerSvg).toBeTruthy();
    expect(innerSvg!.getAttribute('stroke')).toBe('#E94560');
    expect(innerSvg!.getAttribute('width')).toBe('24');
  });

  it('uses default size 24 and color currentColor when not specified', () => {
    const layer: IconLayer = {
      id: 'ic2', type: 'icon', z: 0,
      x: 0, y: 0, name: 'star',
    };
    const el = renderIcon(layer, makeSVG());
    const innerSvg = el.querySelector('svg');
    expect(innerSvg!.getAttribute('width')).toBe('24');
    expect(innerSvg!.getAttribute('stroke')).toBe('currentColor');
  });

  it('renders fallback rect+text for unknown icon names', () => {
    const layer: IconLayer = {
      id: 'ic3', type: 'icon', z: 0,
      x: 0, y: 0, name: '__unknown_icon_xyz__', size: 32, color: '#abc',
    };
    const el = renderIcon(layer, makeSVG());
    const rect = el.querySelector('rect');
    expect(rect).toBeTruthy();
    const text = el.querySelector('text');
    expect(text).toBeTruthy();
    expect(text!.textContent).toBe('__unknown_icon_xyz__');
  });
});

// ── Mermaid ─────────────────────────────────────────────────

describe('renderMermaid', () => {
  it('renders a foreignObject placeholder', () => {
    const layer: MermaidLayer = {
      id: 'mm', type: 'mermaid', z: 0,
      x: 0, y: 0, width: 400, height: 300,
      definition: 'graph TD\n  A --> B',
    };
    const el = renderMermaid(layer, makeSVG());
    expect(el.tagName).toBe('foreignObject');
    expect(el.getAttribute('width')).toBe('400');
    expect(el.getAttribute('height')).toBe('300');
    expect(el.getAttribute('data-layer-id')).toBe('mm');
  });

  it('shows the definition as placeholder text', () => {
    const layer: MermaidLayer = {
      id: 'mm2', type: 'mermaid', z: 0,
      x: 10, y: 20, width: 300, height: 200,
      definition: 'flowchart LR\n  A --> B',
    };
    const el = renderMermaid(layer, makeSVG());
    // The placeholder div should contain the raw definition text
    const div = el.querySelector('div');
    expect(div).toBeTruthy();
    expect(div!.textContent).toContain('flowchart LR');
  });

  it('uses default 400x300 when width/height are non-numeric', () => {
    const layer = {
      id: 'mm3', type: 'mermaid', z: 0,
      definition: 'graph TD\n  A --> B',
    } as unknown as MermaidLayer;
    const el = renderMermaid(layer, makeSVG());
    expect(el.getAttribute('width')).toBe('400');
    expect(el.getAttribute('height')).toBe('300');
  });
});

// ── Chart ───────────────────────────────────────────────────

describe('renderChart', () => {
  it('renders a foreignObject for vega-lite chart', () => {
    const layer: ChartLayer = {
      id: 'ch', type: 'chart', z: 0,
      x: 0, y: 0, width: 400, height: 300,
      spec: {
        mark: 'bar',
        data: { values: [{ x: 1, y: 2 }] },
        encoding: { x: { field: 'x' }, y: { field: 'y' } },
      },
    };
    const el = renderChart(layer, makeSVG());
    expect(el.tagName).toBe('foreignObject');
    expect(el.getAttribute('width')).toBe('400');
    expect(el.getAttribute('height')).toBe('300');
    expect(el.getAttribute('data-layer-id')).toBe('ch');
  });

  it('uses default 400x300 when width/height are non-numeric', () => {
    const layer = {
      id: 'ch2', type: 'chart', z: 0,
      spec: { mark: 'point' },
    } as unknown as ChartLayer;
    const el = renderChart(layer, makeSVG());
    expect(el.getAttribute('width')).toBe('400');
    expect(el.getAttribute('height')).toBe('300');
  });
});

// ── Code ────────────────────────────────────────────────────

describe('renderCode', () => {
  it('renders a foreignObject code block', () => {
    const layer: CodeLayer = {
      id: 'co', type: 'code', z: 0,
      x: 0, y: 0, width: 600, height: 300,
      language: 'typescript',
      code: 'const x = 1;',
    };
    const el = renderCode(layer, makeSVG());
    expect(el.tagName).toBe('foreignObject');
    expect(el.getAttribute('data-layer-id')).toBe('co');
    // Should contain a pre/code element
    const pre = el.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(el.textContent).toContain('const x = 1;');
  });

  it('sets language class on code element', () => {
    const layer: CodeLayer = {
      id: 'co2', type: 'code', z: 0,
      x: 0, y: 0, width: 500, height: 200,
      language: 'python',
      code: 'print("hello")',
    };
    const el = renderCode(layer, makeSVG());
    const code = el.querySelector('code');
    expect(code!.className).toBe('language-python');
  });

  it('uses default 400x200 when width/height are non-numeric', () => {
    const layer = {
      id: 'co3', type: 'code', z: 0,
      language: 'javascript',
      code: 'let x;',
    } as unknown as CodeLayer;
    const el = renderCode(layer, makeSVG());
    expect(el.getAttribute('width')).toBe('400');
    expect(el.getAttribute('height')).toBe('200');
  });
});

// ── Math ────────────────────────────────────────────────────

describe('renderMath', () => {
  it('renders a foreignObject for KaTeX expression', () => {
    const layer: MathLayer = {
      id: 'ma', type: 'math', z: 0,
      x: 0, y: 0, width: 300, height: 100,
      expression: 'E = mc^2',
    };
    const el = renderMath(layer, makeSVG());
    expect(el.tagName).toBe('foreignObject');
    expect(el.getAttribute('data-layer-id')).toBe('ma');
    // Should contain the expression
    expect(el.textContent).toContain('E = mc^2');
  });

  it('uses default 300x100 when width/height are non-numeric', () => {
    const layer = {
      id: 'ma2', type: 'math', z: 0,
      expression: 'x^2 + y^2 = z^2',
    } as unknown as MathLayer;
    const el = renderMath(layer, makeSVG());
    expect(el.getAttribute('width')).toBe('300');
    expect(el.getAttribute('height')).toBe('100');
  });
});

// ── Group ────────────────────────────────────────────────────

describe('renderGroup', () => {
  it('renders a <g> container with child layers', () => {
    const layer: GroupLayer = {
      id: 'grp', type: 'group', z: 10,
      x: 0, y: 0,
      layers: [
        { id: 'child1', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50 } as RectLayer,
        { id: 'child2', type: 'rect', z: 1, x: 60, y: 0, width: 50, height: 50 } as RectLayer,
      ],
    };
    const svg = makeSVG();
    const el = renderGroup(layer, svg, simpleRenderFn);
    expect(el.tagName).toBe('g');
    expect(el.getAttribute('data-layer-id')).toBe('grp');
    const rects = el.querySelectorAll('rect');
    expect(rects).toHaveLength(2);
  });

  it('renders empty group with no children', () => {
    const layer: GroupLayer = {
      id: 'empty-grp', type: 'group', z: 5,
      x: 0, y: 0, layers: [],
    };
    const el = renderGroup(layer, makeSVG(), simpleRenderFn);
    expect(el.tagName).toBe('g');
    expect(el.childElementCount).toBe(0);
  });

  it('applies rotation to group', () => {
    const layer: GroupLayer = {
      id: 'rotgrp', type: 'group', z: 10,
      x: 100, y: 100, width: 200, height: 200,
      rotation: 45,
      layers: [
        { id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50 } as RectLayer,
      ],
    };
    const el = renderGroup(layer, makeSVG(), simpleRenderFn);
    expect(el.getAttribute('transform')).toContain('rotate(45');
  });
});

describe('renderQRCode', () => {
  function makeSVG() { return createSVGRoot(400, 400); }

  it('returns a <g> with data-layer-id', () => {
    const layer: QRCodeLayer = {
      id: 'qr1', type: 'qrcode', z: 0, x: 10, y: 10, width: 120, height: 120,
      value: 'https://example.com',
      error_correction: 'M',
    } as unknown as QRCodeLayer;
    const el = renderQRCode(layer, makeSVG());
    expect(el.tagName).toBe('g');
    expect(el.getAttribute('data-layer-id')).toBe('qr1');
  });

  it('renders dark module rects for a simple value', () => {
    const layer: QRCodeLayer = {
      id: 'qr2', type: 'qrcode', z: 0, x: 0, y: 0, width: 210, height: 210,
      value: 'A',
      error_correction: 'L',
      fill: '#000000',
      background: '#ffffff',
    } as unknown as QRCodeLayer;
    const el = renderQRCode(layer, makeSVG());
    const rects = el.querySelectorAll('rect');
    // Background rect + multiple module rects
    expect(rects.length).toBeGreaterThan(1);
  });

  it('renders background rect when background is not transparent', () => {
    const layer: QRCodeLayer = {
      id: 'qr3', type: 'qrcode', z: 0, x: 0, y: 0, width: 120, height: 120,
      value: 'hi',
      background: '#ffffff',
    } as unknown as QRCodeLayer;
    const el = renderQRCode(layer, makeSVG());
    const rects = el.querySelectorAll('rect');
    // At least one background rect
    expect(rects.length).toBeGreaterThan(0);
    expect(rects[0].getAttribute('fill')).toBe('#ffffff');
  });

  it('skips background rect when background is transparent', () => {
    const layer: QRCodeLayer = {
      id: 'qr4', type: 'qrcode', z: 0, x: 0, y: 0, width: 120, height: 120,
      value: 'Z',
      background: 'transparent',
      fill: '#000',
    } as unknown as QRCodeLayer;
    const el = renderQRCode(layer, makeSVG());
    const rects = Array.from(el.querySelectorAll('rect'));
    // No background rect — first rect should be a module rect (fill=#000)
    const bgRect = rects.find(r => r.getAttribute('fill') === 'transparent');
    expect(bgRect).toBeUndefined();
  });

  it('works with all EC levels', () => {
    for (const ec of ['L', 'M', 'Q', 'H'] as const) {
      const layer: QRCodeLayer = {
        id: `qr-${ec}`, type: 'qrcode', z: 0, x: 0, y: 0, width: 120, height: 120,
        value: 'test',
        error_correction: ec,
      } as unknown as QRCodeLayer;
      const el = renderQRCode(layer, makeSVG());
      expect(el.tagName).toBe('g');
    }
  });

  it('renders error fallback rect when encodeQR throws', async () => {
    // Mock the QR encode module to throw for this test
    const { vi } = await import('vitest');
    const qrModule = await import('./qr/encode');
    const spy = vi.spyOn(qrModule, 'encodeQR').mockImplementation(() => {
      throw new Error('QR encode failed');
    });

    const layer: QRCodeLayer = {
      id: 'qr-bad', type: 'qrcode', z: 0, x: 0, y: 0, width: 100, height: 100,
      value: 'test',
    } as unknown as QRCodeLayer;
    const el = renderQRCode(layer, makeSVG());
    const errorRect = Array.from(el.querySelectorAll('rect')).find(r =>
      r.getAttribute('stroke') === '#e94560',
    );
    expect(errorRect).toBeDefined();
    spy.mockRestore();
  });
});

describe('renderAutoLayout', () => {
  function makeSVG() { return createSVGRoot(800, 800); }
  beforeEach(() => { resetDefIdCounter(); });

  it('returns a <g> with data-layer-id', () => {
    const layer: AutoLayoutLayer = {
      id: 'al1', type: 'auto_layout', z: 0, x: 0, y: 0, width: 300, height: 100,
      direction: 'row', gap: 8, layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el.tagName).toBe('g');
    expect(el.getAttribute('data-layer-id')).toBe('al1');
  });

  it('lays out children in a row', () => {
    const children: RectLayer[] = [
      { id: 'c1', type: 'rect', z: 0, x: 0, y: 0, width: 80, height: 40 },
      { id: 'c2', type: 'rect', z: 1, x: 0, y: 0, width: 80, height: 40 },
    ];
    const layer: AutoLayoutLayer = {
      id: 'row', type: 'auto_layout', z: 0, x: 10, y: 10, width: 200, height: 60,
      direction: 'row', gap: 10, layers: children as Layer[],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el.children.length).toBe(2);
  });

  it('lays out children in a column', () => {
    const children: RectLayer[] = [
      { id: 'd1', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 50 },
      { id: 'd2', type: 'rect', z: 1, x: 0, y: 0, width: 100, height: 50 },
    ];
    const layer: AutoLayoutLayer = {
      id: 'col', type: 'auto_layout', z: 0, x: 0, y: 0, width: 120, height: 200,
      direction: 'column', gap: 5, layers: children as Layer[],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el.children.length).toBe(2);
  });

  it('renders background rect when fill is set', () => {
    const layer: AutoLayoutLayer = {
      id: 'al-fill', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0,
      fill: { type: 'solid', color: '#ff0000' },
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    const rect = el.querySelector('rect');
    expect(rect).toBeTruthy();
    expect(rect?.getAttribute('fill')).toBe('#ff0000');
  });

  it('handles padding object', () => {
    const layer: AutoLayoutLayer = {
      id: 'al-pad', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el).toBeTruthy();
  });

  it('handles numeric padding', () => {
    const layer: AutoLayoutLayer = {
      id: 'al-numpad', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0,
      padding: 16 as unknown as AutoLayoutLayer['padding'],
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    expect(el).toBeTruthy();
  });

  it('applies opacity attribute when fill has opacity (lines 668-669)', () => {
    const layer: AutoLayoutLayer = {
      id: 'al-opacity', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0,
      fill: { type: 'solid', color: '#0000ff', opacity: 0.5 },
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    const rect = el.querySelector('rect');
    expect(rect?.getAttribute('opacity')).toBe('0.5');
  });

  it('applies stroke to background rect when stroke is defined (line 676)', () => {
    const layer: AutoLayoutLayer = {
      id: 'al-stroke', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0,
      fill: { type: 'solid', color: '#00ff00' },
      stroke: { color: '#ff0000', width: 2 },
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    const rect = el.querySelector('rect');
    expect(rect?.getAttribute('stroke')).toBe('#ff0000');
  });

  it('sets rx/ry on background rect when radius is a number (lines 667-669)', () => {
    const layer = {
      id: 'al-radius', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 100,
      direction: 'row', gap: 0,
      fill: { type: 'solid', color: '#0000ff' },
      radius: 8,
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    const rect = el.querySelector('rect');
    expect(rect?.getAttribute('rx')).toBe('8');
    expect(rect?.getAttribute('ry')).toBe('8');
  });

  it('uses default 0 for width/height when non-numeric (line 664-665)', () => {
    const layer = {
      id: 'al-nosize', type: 'auto_layout', z: 0, x: 0, y: 0,
      direction: 'row', gap: 0,
      fill: { type: 'solid', color: '#ff0000' },
      layers: [],
    } as unknown as AutoLayoutLayer;
    const el = renderAutoLayout(layer, makeSVG(), simpleRenderFn);
    const rect = el.querySelector('rect');
    expect(rect?.getAttribute('width')).toBe('0');
    expect(rect?.getAttribute('height')).toBe('0');
  });
});

// ── Text ─────────────────────────────────────────────────────
import { renderText } from './layer-renderers';
import type { TextLayer } from '../schema/types';

describe('renderText', () => {
  it('renders plain text with fill color', () => {
    const layer: TextLayer = {
      id: 'tx1', type: 'text', z: 0, x: 10, y: 20, width: 300, height: 60,
      content: { type: 'plain', value: 'Hello' },
      style: { font_size: 24, color: '#ff0000' },
    };
    const el = renderText(layer, makeSVG());
    const text = el.querySelector('text');
    expect(text?.getAttribute('fill')).toBe('#ff0000');
    expect(text?.getAttribute('font-size')).toBe('24');
  });

  it('renders multiline plain text with tspan elements', () => {
    const layer: TextLayer = {
      id: 'multi', type: 'text', z: 0, x: 0, y: 0, width: 300, height: 100,
      content: { type: 'plain', value: 'Line1\nLine2\nLine3' },
      style: {},
    };
    const el = renderText(layer, makeSVG());
    const tspans = el.querySelectorAll('tspan');
    expect(tspans.length).toBe(3);
  });

  it('renders plain text with text-anchor for center align', () => {
    const layer: TextLayer = {
      id: 'center', type: 'text', z: 0, x: 0, y: 0, width: 200, height: 50,
      content: { type: 'plain', value: 'Centered' },
      style: { align: 'center' },
    };
    const el = renderText(layer, makeSVG());
    const text = el.querySelector('text');
    expect(text?.getAttribute('text-anchor')).toBe('middle');
  });

  it('renders plain text with right text-anchor', () => {
    const layer: TextLayer = {
      id: 'right', type: 'text', z: 0, x: 0, y: 0, width: 200, height: 50,
      content: { type: 'plain', value: 'Right' },
      style: { align: 'right' },
    };
    const el = renderText(layer, makeSVG());
    expect(el.querySelector('text')?.getAttribute('text-anchor')).toBe('end');
  });

  it('renders rich text with tspan spans', () => {
    const layer: TextLayer = {
      id: 'rich', type: 'text', z: 0, x: 0, y: 0, width: 300, height: 60,
      content: { type: 'rich', spans: [
        { text: 'Bold', bold: true, color: '#f00' },
        { text: ' Normal', italic: true, size: 18 },
      ] },
      style: {},
    };
    const el = renderText(layer, makeSVG());
    const tspans = el.querySelectorAll('tspan');
    expect(tspans.length).toBe(2);
    expect(tspans[0].getAttribute('font-weight')).toBe('bold');
    expect(tspans[0].getAttribute('fill')).toBe('#f00');
    expect(tspans[1].getAttribute('font-style')).toBe('italic');
    expect(tspans[1].getAttribute('font-size')).toBe('18');
  });

  it('renders markdown as foreignObject div', () => {
    const layer: TextLayer = {
      id: 'md', type: 'text', z: 0, x: 0, y: 0, width: 400, height: 200,
      content: { type: 'markdown', value: '# Hello\n\nWorld' },
      style: { font_size: 16 },
    };
    const el = renderText(layer, makeSVG());
    expect(el.querySelector('foreignObject')).not.toBeNull();
  });

  it('applies letter-spacing and line-height to plain text', () => {
    const layer: TextLayer = {
      id: 'spacing', type: 'text', z: 0, x: 0, y: 0, width: 200, height: 50,
      content: { type: 'plain', value: 'Spaced' },
      style: { letter_spacing: 2, line_height: 1.8 },
    };
    const el = renderText(layer, makeSVG());
    expect(el.querySelector('text')?.getAttribute('letter-spacing')).toBe('2px');
  });
});

// ── Circle ───────────────────────────────────────────────────
import { renderCircle } from './layer-renderers';
import type { CircleLayer } from '../schema/types';

describe('renderCircle', () => {
  it('renders an ellipse with correct cx/cy/rx/ry', () => {
    const layer: CircleLayer = {
      id: 'c1', type: 'circle', z: 0, x: 0, y: 0, width: 100, height: 80,
    };
    const el = renderCircle(layer, makeSVG());
    expect(el.tagName).toBe('ellipse');
    expect(el.getAttribute('rx')).toBe('50');
    expect(el.getAttribute('ry')).toBe('40');
  });

  it('uses explicit cx/cy when provided', () => {
    const layer: CircleLayer = {
      id: 'c2', type: 'circle', z: 0, cx: 200, cy: 150, rx: 60, ry: 60,
    } as unknown as CircleLayer;
    const el = renderCircle(layer, makeSVG());
    expect(el.getAttribute('cx')).toBe('200');
    expect(el.getAttribute('cy')).toBe('150');
  });

  it('applies fill and stroke', () => {
    const layer: CircleLayer = {
      id: 'c3', type: 'circle', z: 0, x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: '#00ff00' },
      stroke: { color: '#ff0000', width: 3 },
    };
    const el = renderCircle(layer, makeSVG());
    expect(el.getAttribute('fill')).toBe('#00ff00');
    expect(el.getAttribute('stroke')).toBe('#ff0000');
    expect(el.getAttribute('stroke-width')).toBe('3');
  });
});

// ── Icon fallback ────────────────────────────────────────────
describe('renderIcon — fallback for unknown icon', () => {
  it('renders dashed rect and text label for unknown icon name', () => {
    const layer: IconLayer = {
      id: 'unk', type: 'icon', z: 0, name: '__nonexistent_icon__', size: 32,
      x: 0, y: 0,
    } as unknown as IconLayer;
    const el = renderIcon(layer, makeSVG());
    expect(el.querySelector('rect')).not.toBeNull();
    const text = el.querySelector('text');
    expect(text?.textContent).toBe('__nonexistent_icon__');
  });
});

// ── Report layer renderers ───────────────────────────────────

describe('renderInteractiveChart', () => {
  it('renders a foreignObject with folio-chart container', () => {
    const layer: InteractiveChartLayer = {
      id: 'chart1', type: 'interactive_chart', z: 0,
      chart_type: 'bar', data_ref: '$data.sales',
      x: 10, y: 20, width: 600, height: 400,
    } as unknown as InteractiveChartLayer;
    const fo = renderInteractiveChart(layer, makeSVG());
    expect(fo.tagName.toLowerCase()).toBe('foreignobject');
    const container = fo.querySelector('.folio-chart');
    expect(container).not.toBeNull();
  });

  it('stores plotly spec in data attribute', () => {
    const layer: InteractiveChartLayer = {
      id: 'c2', type: 'interactive_chart', z: 0,
      chart_type: 'line', data_ref: '$data.metrics',
      x: 0, y: 0, width: 400, height: 300,
      title: 'My Chart', legend: false, grid: true, animate: false,
    } as unknown as InteractiveChartLayer;
    const fo = renderInteractiveChart(layer, makeSVG());
    const container = fo.querySelector<HTMLElement>('.folio-chart');
    const spec = JSON.parse(container?.dataset['plotlySpec'] ?? '{}');
    expect(spec.chartType).toBe('line');
    expect(spec.title).toBe('My Chart');
    expect(spec.legend).toBe(false);
  });

  it('defaults width/height to 400/300 when not numeric', () => {
    const layer = { id: 'c3', type: 'interactive_chart', z: 0, chart_type: 'bar', data_ref: '$data.x' } as unknown as InteractiveChartLayer;
    const fo = renderInteractiveChart(layer, makeSVG());
    expect(fo.getAttribute('width')).toBe('400');
    expect(fo.getAttribute('height')).toBe('300');
  });
});

describe('renderInteractiveTable', () => {
  it('renders a foreignObject with folio-table container', () => {
    const layer: InteractiveTableLayer = {
      id: 't1', type: 'interactive_table', z: 0,
      data_ref: '$data.rows', columns: [{ field: 'name', title: 'Name' }],
      x: 0, y: 0, width: 800, height: 300,
    } as unknown as InteractiveTableLayer;
    const fo = renderInteractiveTable(layer, makeSVG());
    expect(fo.tagName.toLowerCase()).toBe('foreignobject');
    expect(fo.querySelector('.folio-table')).not.toBeNull();
  });

  it('stores tabulator spec with columns in data attribute', () => {
    const cols = [{ field: 'rev', title: 'Revenue', width: 120, sortable: true }];
    const layer: InteractiveTableLayer = {
      id: 't2', type: 'interactive_table', z: 0,
      data_ref: '$data.sales', columns: cols,
      pagination: true, page_size: 10, filterable: true, exportable: true, theme: 'midnight',
      x: 0, y: 0, width: 600, height: 300,
    } as unknown as InteractiveTableLayer;
    const fo = renderInteractiveTable(layer, makeSVG());
    const container = fo.querySelector<HTMLElement>('.folio-table');
    const spec = JSON.parse(container?.dataset['tabulatorSpec'] ?? '{}');
    expect(spec.columns).toEqual(cols);
    expect(spec.pageSize).toBe(10);
    expect(spec.exportable).toBe(true);
  });
});

describe('renderRichText', () => {
  it('renders markdown with data-markdown-src', () => {
    const layer: RichTextLayer = {
      id: 'rt1', type: 'rich_text', z: 0,
      content: '## Hello', format: 'markdown',
      x: 0, y: 0, width: 500, height: 200,
    } as unknown as RichTextLayer;
    const fo = renderRichText(layer, makeSVG());
    const container = fo.querySelector<HTMLElement>('.folio-richtext');
    expect(container?.dataset['markdownSrc']).toBe('## Hello');
  });

  it('renders HTML content directly as innerHTML', () => {
    const layer: RichTextLayer = {
      id: 'rt2', type: 'rich_text', z: 0,
      content: '<p>Hello</p>', format: 'html',
      x: 0, y: 0, width: 500, height: 200,
    } as unknown as RichTextLayer;
    const fo = renderRichText(layer, makeSVG());
    const container = fo.querySelector('.folio-richtext');
    expect(container?.innerHTML).toContain('<p>Hello</p>');
  });

  it('applies font styling from layer props', () => {
    const layer: RichTextLayer = {
      id: 'rt3', type: 'rich_text', z: 0,
      content: 'text', font_family: 'Roboto', font_size: 18,
      color: '#fff', link_color: '#aaa',
      x: 0, y: 0, width: 400, height: 100,
    } as unknown as RichTextLayer;
    const fo = renderRichText(layer, makeSVG());
    const c = fo.querySelector<HTMLElement>('.folio-richtext');
    expect(c?.style.cssText).toContain('Roboto');
    expect(c?.style.cssText).toContain('18px');
  });
});

describe('renderKpiCard', () => {
  it('renders a foreignObject with folio-kpi card', () => {
    const layer: KpiCardLayer = {
      id: 'kpi1', type: 'kpi_card', z: 0,
      label: 'Revenue', value: 142000,
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    expect(fo.tagName.toLowerCase()).toBe('foreignobject');
    expect(fo.querySelector('.folio-kpi')).not.toBeNull();
  });

  it('shows label and formatted value', () => {
    const layer: KpiCardLayer = {
      id: 'kpi2', type: 'kpi_card', z: 0,
      label: 'Total', value: 1500,
      format: 'currency', currency: 'USD', decimals: 0,
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    const card = fo.querySelector('.folio-kpi');
    expect(card?.textContent).toContain('Total');
    expect(card?.innerHTML).toContain('$1,500');
  });

  it('shows positive delta with up arrow', () => {
    const layer: KpiCardLayer = {
      id: 'kpi3', type: 'kpi_card', z: 0,
      label: 'Growth', value: 100, delta: 12.4, delta_format: 'percent',
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    expect(fo.querySelector('.folio-kpi')?.innerHTML).toContain('▲');
  });

  it('shows negative delta with down arrow', () => {
    const layer: KpiCardLayer = {
      id: 'kpi4', type: 'kpi_card', z: 0,
      label: 'Churn', value: 50, delta: -2.1,
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    expect(fo.querySelector('.folio-kpi')?.innerHTML).toContain('▼');
  });

  it('renders sparkline canvas when sparkline_data present', () => {
    const layer: KpiCardLayer = {
      id: 'kpi5', type: 'kpi_card', z: 0,
      label: 'Revenue', value: 100,
      sparkline_data: '$data.sales', sparkline_field: 'revenue', sparkline_color: '#6c5ce7',
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    const canvas = fo.querySelector('canvas.kpi-sparkline');
    expect(canvas).not.toBeNull();
  });

  it('formats number with decimals', () => {
    const layer: KpiCardLayer = {
      id: 'kpi6', type: 'kpi_card', z: 0,
      label: 'Rate', value: 3.14159, format: 'number', decimals: 2,
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    expect(fo.querySelector('.folio-kpi')?.innerHTML).toContain('3.14');
  });

  it('formats percent value', () => {
    const layer: KpiCardLayer = {
      id: 'kpi7', type: 'kpi_card', z: 0,
      label: 'Growth', value: 12.5, format: 'percent',
      x: 0, y: 0, width: 300, height: 180,
    } as unknown as KpiCardLayer;
    const fo = renderKpiCard(layer, makeSVG());
    expect(fo.querySelector('.folio-kpi')?.innerHTML).toContain('%');
  });
});

describe('renderMap', () => {
  it('renders a foreignObject with folio-map container', () => {
    const layer: MapLayer = {
      id: 'map1', type: 'map', z: 0,
      center: [20, 0], zoom: 2, tile_provider: 'osm',
      x: 0, y: 0, width: 700, height: 450,
    } as unknown as MapLayer;
    const fo = renderMap(layer, makeSVG());
    expect(fo.querySelector('.folio-map')).not.toBeNull();
  });

  it('stores leaflet spec in data attribute', () => {
    const overlays = [{ type: 'markers' as const, data_ref: '$data.regions', lat_field: 'lat', lng_field: 'lng' }];
    const layer: MapLayer = {
      id: 'map2', type: 'map', z: 0,
      center: [51.5, -0.1], zoom: 10,
      tile_provider: 'carto-dark', overlays,
      x: 0, y: 0, width: 600, height: 400,
    } as unknown as MapLayer;
    const fo = renderMap(layer, makeSVG());
    const container = fo.querySelector<HTMLElement>('.folio-map');
    const spec = JSON.parse(container?.dataset['leafletSpec'] ?? '{}');
    expect(spec.zoom).toBe(10);
    expect(spec.tileProvider).toBe('carto-dark');
    expect(spec.overlays).toHaveLength(1);
  });
});

describe('renderEmbedCode', () => {
  it('renders a sandboxed iframe by default', () => {
    const layer: EmbedCodeLayer = {
      id: 'em1', type: 'embed_code', z: 0,
      html: '<div>hello</div>', sandbox: true,
      x: 0, y: 0, width: 400, height: 300,
    } as unknown as EmbedCodeLayer;
    const fo = renderEmbedCode(layer, makeSVG());
    const iframe = fo.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('srcdoc')).toBe('<div>hello</div>');
  });

  it('sets allow-scripts sandbox attribute when allow_scripts', () => {
    const layer: EmbedCodeLayer = {
      id: 'em2', type: 'embed_code', z: 0,
      html: '<script>1+1</script>', sandbox: true, allow_scripts: true,
      x: 0, y: 0, width: 400, height: 300,
    } as unknown as EmbedCodeLayer;
    const fo = renderEmbedCode(layer, makeSVG());
    expect(fo.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('renders div with innerHTML when sandbox:false', () => {
    const layer: EmbedCodeLayer = {
      id: 'em3', type: 'embed_code', z: 0,
      html: '<p>raw</p>', sandbox: false,
      x: 0, y: 0, width: 400, height: 300,
    } as unknown as EmbedCodeLayer;
    const fo = renderEmbedCode(layer, makeSVG());
    expect(fo.querySelector('iframe')).toBeNull();
    expect(fo.querySelector('div')?.innerHTML).toContain('<p>raw</p>');
  });
});

describe('renderPopup', () => {
  it('renders a hidden <g> element', () => {
    const layer: PopupLayer = {
      id: 'pop1', type: 'popup', z: 100,
      trigger_id: 'btn1', modal: true, open_animation: 'fade',
      layers: [],
      x: 100, y: 100, width: 600, height: 400,
    } as unknown as PopupLayer;
    const g = renderPopup(layer, makeSVG(), (l, s) => renderRect(l as RectLayer, s));
    expect(g.tagName.toLowerCase()).toBe('g');
    expect(g.getAttribute('visibility')).toBe('hidden');
    expect(g.getAttribute('data-popup-id')).toBe('pop1');
  });

  it('renders backdrop rect', () => {
    const layer: PopupLayer = {
      id: 'pop2', type: 'popup', z: 100, layers: [],
      x: 0, y: 0, width: 400, height: 300,
    } as unknown as PopupLayer;
    const g = renderPopup(layer, makeSVG(), (l, s) => renderRect(l as RectLayer, s));
    const backdrop = g.querySelector('[data-popup-backdrop]');
    expect(backdrop).not.toBeNull();
  });

  it('renders child layers inside the popup', () => {
    const child: RectLayer = { id: 'child', type: 'rect', z: 1, x: 0, y: 0, width: 50, height: 50 };
    const layer: PopupLayer = {
      id: 'pop3', type: 'popup', z: 100, layers: [child],
      x: 0, y: 0, width: 400, height: 300,
    } as unknown as PopupLayer;
    const g = renderPopup(layer, makeSVG(), (l, s) => renderRect(l as RectLayer, s));
    // backdrop + panel + 1 child = at least 3 children
    expect(g.children.length).toBeGreaterThanOrEqual(3);
  });
});
