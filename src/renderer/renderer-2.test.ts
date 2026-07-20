import { describe, it, expect, beforeEach } from 'vitest';
import { renderPage, renderLayer, invalidateCache } from './renderer';
import { createSVGRoot } from './svg-utils';
import type { Layer, RectLayer } from '../schema/types';

describe('background / backdrop full-bleed type', () => {
  beforeEach(() => { invalidateCache(); });

  it('renders a content-less `background` layer as nothing, NOT the `[background: id]` placeholder', () => {
    // suite-009 cover: model added a bare {id:bg, type:background} per page → it
    // hit the default placeholder and printed `[background: bg]` on the poster.
    const layers = [{ id: 'bg', type: 'background', z: 0 } as unknown as Layer];
    const svg = renderPage(layers, 1080, 1350);
    expect(svg.textContent ?? '').not.toContain('background: bg');
    expect(svg.querySelector('[data-background="empty"]')).toBeTruthy();
  });

  it('covers the whole canvas with the fill when a `background` layer carries one', () => {
    const layers = [{ id: 'bg', type: 'background', z: 0, fill: { type: 'solid', color: '#101820' } } as unknown as Layer];
    const svg = renderPage(layers, 1080, 1350);
    const rect = svg.querySelector('rect[fill="#101820"]');
    expect(rect).toBeTruthy();
    expect(rect?.getAttribute('width')).toBe('1080');
    expect(rect?.getAttribute('height')).toBe('1350');
  });
});

describe('buildClipDefs — rotation with non-numeric width/height (lines 255-256)', () => {
  beforeEach(() => { invalidateCache(); });

  it('rotation branch uses 0 when mask width/height are non-numeric', () => {
    const layers: Layer[] = [
      {
        id: 'no-size-mask', type: 'rect', z: 2, x: 10, y: 10,
        rotation: 30,
        // No width/height → typeof width === 'number' is false → uses 0
      } as unknown as Layer,
      {
        id: 'clipped2', type: 'rect', z: 1, x: 0, y: 0, width: 200, height: 200,
        clip_path_ref: 'no-size-mask',
      } as unknown as RectLayer,
    ];
    const svg = renderPage(layers, 400, 400);
    const clipShape = svg.querySelector('#cp-no-size-mask > *');
    // Rotation transform should exist; center computed as (10 + 0/2, 10 + 0/2) = (10, 10)
    expect(clipShape?.getAttribute('transform')).toMatch(/rotate\(30,/);
  });

  it('rotation branch ?? 0 fallback when mask has no x or y (lines 255-256 ?? branch)', () => {
    // No x, no y, no width, no height → all ?? 0 branches taken
    const layers: Layer[] = [
      {
        id: 'noxy-mask', type: 'rect', z: 2, rotation: 45,
      } as unknown as Layer,
      {
        id: 'clipped3', type: 'rect', z: 1, x: 0, y: 0, width: 200, height: 200,
        clip_path_ref: 'noxy-mask',
      } as unknown as RectLayer,
    ];
    const svg = renderPage(layers, 400, 400);
    const clipShape = svg.querySelector('#cp-noxy-mask > *');
    expect(clipShape?.getAttribute('transform')).toMatch(/rotate\(45,0,0\)/);
  });
});

describe('renderLayer — show_if with layer field reference', () => {
  it('uses layer fields in expression (width check)', () => {
    const svg = createSVGRoot(400, 400);
    invalidateCache();
    const el = renderLayer({
      id: 'expr', type: 'rect', z: 0, x: 0, y: 0, width: 200, height: 50,
      show_if: 'width > 100',
    } as RectLayer, svg);
    expect(el.getAttribute('data-hidden')).toBeNull();
  });

  it('hides layer when field-based expression is false', () => {
    const svg = createSVGRoot(400, 400);
    invalidateCache();
    const el = renderLayer({
      id: 'hidden-expr', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50,
      show_if: 'width > 100',
    } as RectLayer, svg);
    expect(el.getAttribute('data-hidden')).toBe('show_if');
  });
});

describe('renderLayer — additional layer types via renderPage', () => {
  beforeEach(() => { invalidateCache(); });

  it('renders image layer (line 88)', () => {
    const layers: Layer[] = [
      { id: 'img', type: 'image', z: 0, x: 0, y: 0, width: 200, height: 150,
        src: 'https://example.com/photo.jpg' } as unknown as Layer,
    ];
    const svg = renderPage(layers, 400, 400);
    expect(svg.querySelector('[data-layer-id="img"]')).not.toBeNull();
  });

  it('renders mermaid layer (line 90)', () => {
    const layers: Layer[] = [
      { id: 'mmd', type: 'mermaid', z: 0, x: 0, y: 0, width: 400, height: 300,
        definition: 'graph TD\n  A-->B' } as unknown as Layer,
    ];
    const svg = renderPage(layers, 400, 400);
    expect(svg.querySelector('[data-layer-id="mmd"]')).not.toBeNull();
  });

  it('renders chart layer (line 91)', () => {
    const layers: Layer[] = [
      { id: 'chart1', type: 'chart', z: 0, x: 0, y: 0, width: 400, height: 300,
        chart_type: 'bar', data: [] } as unknown as Layer,
    ];
    const svg = renderPage(layers, 400, 400);
    expect(svg.querySelector('[data-layer-id="chart1"]')).not.toBeNull();
  });

  it('renders code layer (line 92)', () => {
    const layers: Layer[] = [
      { id: 'code1', type: 'code', z: 0, x: 0, y: 0, width: 400, height: 200,
        code: 'const x = 1;', language: 'javascript' } as unknown as Layer,
    ];
    const svg = renderPage(layers, 400, 400);
    expect(svg.querySelector('[data-layer-id="code1"]')).not.toBeNull();
  });

  it('renders math layer (line 93)', () => {
    const layers: Layer[] = [
      { id: 'math1', type: 'math', z: 0, x: 0, y: 0, width: 300, height: 80,
        expression: 'E = mc^2' } as unknown as Layer,
    ];
    const svg = renderPage(layers, 400, 400);
    expect(svg.querySelector('[data-layer-id="math1"]')).not.toBeNull();
  });

  it('renders qrcode layer (line 97)', () => {
    const layers: Layer[] = [
      { id: 'qr1', type: 'qrcode', z: 0, x: 50, y: 50, width: 100, height: 100,
        value: 'https://example.com' } as unknown as Layer,
    ];
    const svg = renderPage(layers, 400, 400);
    expect(svg.querySelector('[data-layer-id="qr1"]')).not.toBeNull();
  });

  it('renders auto_layout layer (line 98)', () => {
    const layers: Layer[] = [
      { id: 'al', type: 'auto_layout', z: 0, x: 0, y: 0, width: 200, height: 200,
        direction: 'horizontal', gap: 8, padding: 8, layers: [] } as unknown as Layer,
    ];
    const svg = renderPage(layers, 400, 400);
    expect(svg.querySelector('[data-layer-id="al"]')).not.toBeNull();
  });

  it('renders unknown type via default placeholder (line 99)', () => {
    const layers: Layer[] = [
      { id: 'unk', type: 'custom_widget' as Layer['type'], z: 0, x: 0, y: 0,
        width: 100, height: 100 } as unknown as Layer,
    ];
    const svg = renderPage(layers, 400, 400);
    expect(svg.querySelector('[data-layer-id="unk"]')).not.toBeNull();
  });
});

describe('renderLayer — report layer types (lines 101-107)', () => {
  it('renders interactive_chart layer', () => {
    const layers: Layer[] = [
      { id: 'chart1', type: 'interactive_chart', z: 0, x: 0, y: 0, width: 400, height: 300,
        chart_type: 'bar', data_source: 'sales' } as unknown as Layer,
    ];
    const svg = renderPage(layers, 500, 500);
    expect(svg.querySelector('[data-layer-id="chart1"]')).not.toBeNull();
  });

  it('renders interactive_table layer', () => {
    const layers: Layer[] = [
      { id: 'tbl1', type: 'interactive_table', z: 0, x: 0, y: 0, width: 400, height: 300,
        data_source: 'users', columns: [] } as unknown as Layer,
    ];
    const svg = renderPage(layers, 500, 500);
    expect(svg.querySelector('[data-layer-id="tbl1"]')).not.toBeNull();
  });

  it('renders rich_text layer', () => {
    const layers: Layer[] = [
      { id: 'rt1', type: 'rich_text', z: 0, x: 0, y: 0, width: 300, height: 200,
        content: '# Hello' } as unknown as Layer,
    ];
    const svg = renderPage(layers, 500, 500);
    expect(svg.querySelector('[data-layer-id="rt1"]')).not.toBeNull();
  });

  it('renders kpi_card layer', () => {
    const layers: Layer[] = [
      { id: 'kpi1', type: 'kpi_card', z: 0, x: 0, y: 0, width: 200, height: 120,
        label: 'Revenue', value: '$1M' } as unknown as Layer,
    ];
    const svg = renderPage(layers, 500, 500);
    expect(svg.querySelector('[data-layer-id="kpi1"]')).not.toBeNull();
  });

  const kpi = (delta: unknown): string => {
    const layers: Layer[] = [
      { id: 'k', type: 'kpi_card', z: 0, x: 0, y: 0, width: 200, height: 120,
        label: 'Tools', value: '21', delta } as unknown as Layer,
    ];
    return renderPage(layers, 500, 500).querySelector('[data-layer-id="k"]')?.textContent ?? '';
  };

  it('shows a WORD delta as written, not as NaN', () => {
    // "unchanged" / "was 2" / "flat" are ordinary things to put on a KPI card.
    // Coercing them with Number() printed a literal "▼ NaN" on the canvas while
    // the interactive HTML export rendered the same field as plain text — the
    // editor preview and the export disagreed about one design.
    expect(kpi('unchanged')).toContain('unchanged');
    expect(kpi('unchanged')).not.toContain('NaN');
    expect(kpi('was 2')).toContain('was 2');
  });

  it('gives a non-numeric delta no arrow, since it claims no direction', () => {
    expect(kpi('unchanged')).not.toContain('▲');
    expect(kpi('unchanged')).not.toContain('▼');
  });

  it('still treats a numeric delta as numeric, with its arrow', () => {
    expect(kpi(12)).toContain('▲');
    expect(kpi(-3)).toContain('▼');
    expect(kpi(12)).not.toContain('NaN');
  });

  it('omits the delta row entirely when there is no delta', () => {
    expect(kpi(undefined)).not.toContain('▲');
    expect(kpi(undefined)).not.toContain('NaN');
  });

  it('renders map layer', () => {
    const layers: Layer[] = [
      { id: 'map1', type: 'map', z: 0, x: 0, y: 0, width: 400, height: 300,
        center: [51.5, -0.1], zoom: 10 } as unknown as Layer,
    ];
    const svg = renderPage(layers, 500, 500);
    expect(svg.querySelector('[data-layer-id="map1"]')).not.toBeNull();
  });

  it('renders embed_code layer', () => {
    const layers: Layer[] = [
      { id: 'emb1', type: 'embed_code', z: 0, x: 0, y: 0, width: 300, height: 200,
        code: '<div>Hello</div>' } as unknown as Layer,
    ];
    const svg = renderPage(layers, 500, 500);
    expect(svg.querySelector('[data-layer-id="emb1"]')).not.toBeNull();
  });

  it('renders popup layer', () => {
    const layers: Layer[] = [
      { id: 'pop1', type: 'popup', z: 0, x: 0, y: 0, width: 300, height: 200,
        trigger_id: 'btn1', layers: [] } as unknown as Layer,
    ];
    const svg = renderPage(layers, 500, 500);
    expect(svg.querySelector('[data-layer-id="pop1"]')).not.toBeNull();
  });
});

describe('render isolation barrier', () => {
  it('renders a placeholder (not a throw) when a layer renderer throws', () => {
    const svg = createSVGRoot(500, 500);
    // A getter that throws when the renderer reads width — simulates any
    // malformed layer. The whole render must not blow up; one bad layer →
    // one dashed placeholder, siblings unaffected.
    const evil = { id: 'evil', type: 'rect', z: 0, x: 10, y: 10,
      get width(): number { throw new Error('boom'); } } as unknown as Layer;
    let el!: SVGElement;
    expect(() => { el = renderLayer(evil, svg); }).not.toThrow();
    expect(el.getAttribute('data-layer-id')).toBe('evil');
    expect(el.getAttribute('data-render-error')).toContain('boom');
  });

  it('renders a callout missing content without throwing (text alias works)', () => {
    const layers: Layer[] = [
      { id: 'co_empty', type: 'callout', z: 0, x: 0, y: 0, width: 300, height: 80, variant: 'info' } as unknown as Layer,
      { id: 'co_text', type: 'callout', z: 0, x: 0, y: 100, width: 300, height: 80, variant: 'info', text: 'aliased body' } as unknown as Layer,
    ];
    let svg!: SVGSVGElement;
    expect(() => { svg = renderPage(layers, 500, 500); }).not.toThrow();
    expect(svg.querySelector('[data-render-error]')).toBeNull(); // neither needed a placeholder
    expect(svg.textContent ?? '').toContain('aliased body');
  });
});
