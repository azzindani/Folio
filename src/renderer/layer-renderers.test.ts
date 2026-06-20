/**
 * Unit tests for layer-renderers.ts
 * Coverage target: 80%+
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderPath, renderPolygon, renderLine, renderImage, renderIcon, renderMermaid, renderChart, renderCode, renderMath, renderGroup, renderRect, renderQRCode } from './layer-renderers';

// Simple render fn for group tests (avoids circular import with renderer.ts)
import { createSVGRoot, resetDefIdCounter } from './svg-utils';
import type { Layer, PathLayer, PolygonLayer, LineLayer, ImageLayer, IconLayer, MermaidLayer, ChartLayer, CodeLayer, MathLayer, GroupLayer, RectLayer, QRCodeLayer } from '../schema/types';

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
function makeSVG() {
  return createSVGRoot(1080, 1080);
}

beforeEach(() => {
  resetDefIdCounter();
});

// ── Rect color fallback ─────────────────────────────────────

describe('renderRect color fallback', () => {
  it('renders fill from a bare `color` when no `fill` is set', () => {
    // Small models emit {type:'rect', color:'#0A0A0A'} (no `fill`); without the
    // fallback the rect renders fill="none" and a full-canvas background vanishes.
    const layer = { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, color: '#0A0A0A' } as unknown as RectLayer;
    const el = renderRect(layer, makeSVG());
    expect(el.getAttribute('fill')).toBe('#0A0A0A');
  });

  it('still renders fill="none" when neither fill nor color is set', () => {
    const layer = { id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10 } as unknown as RectLayer;
    expect(renderRect(layer, makeSVG()).getAttribute('fill')).toBe('none');
  });

  it('prefers an explicit `fill` over `color`', () => {
    const layer = { id: 'r2', type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10, color: '#000000', fill: { type: 'solid', color: '#FF0000' } } as unknown as RectLayer;
    expect(renderRect(layer, makeSVG()).getAttribute('fill')).toBe('#FF0000');
  });
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

  it('renders a native-SVG placeholder (not foreignObject) when src is empty', () => {
    // Native primitives so it survives resvg PNG export, unlike a foreignObject.
    const layer = { id: 'ph', type: 'image', z: 0, x: 10, y: 20, width: 300, height: 200, src: '' } as unknown as ImageLayer;
    const el = renderImage(layer, makeSVG());
    expect(el.tagName).toBe('g');
    expect(el.querySelector('rect')).not.toBeNull();
    expect(el.querySelector('text')?.textContent).toBe('image');
    expect(el.getAttribute('data-layer-id')).toBe('ph');
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

  it('renders a solid dot fallback (no raw name) for unknown icon names', () => {
    const layer: IconLayer = {
      id: 'ic3', type: 'icon', z: 0,
      x: 0, y: 0, name: '__unknown_icon_xyz__', size: 32, color: '#abc',
    };
    const el = renderIcon(layer, makeSVG());
    const circle = el.querySelector('circle');
    expect(circle).toBeTruthy();
    // A filled accent dot (reads as an intentional bullet), not a hollow ring.
    expect(circle!.getAttribute('fill')).toBe('#abc');
    // The raw, unresolved name must NOT leak as visible text.
    expect(el.querySelector('text')).toBeNull();
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
