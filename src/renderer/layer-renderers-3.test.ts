/**
 * Unit tests for layer-renderers.ts
 * Coverage target: 80%+
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderRect, renderMap, renderEmbedCode, renderPopup } from './layer-renderers';

// Simple render fn for group tests (avoids circular import with renderer.ts)
import { createSVGRoot } from './svg-utils';
import type { RectLayer, MapLayer, EmbedCodeLayer, PopupLayer } from '../schema/types';

import { renderText } from './layer-renderers';

function makeSVG() {
  return createSVGRoot(1080, 1080);
}

beforeEach(() => {
});

// ── Path ────────────────────────────────────────────────────

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

describe('renderText — tolerant of LLM-authored shorthand', () => {
  it('renders a `text:` alias + flat style without throwing (no content object)', () => {
    const svg = makeSVG();
    // The shape that crashed exported reports: text layer with `text` + flat
    // font/size/weight/color instead of content:{type,value} + style:{}.
    const layer = {
      id: 'headline', type: 'text', z: 1, x: 0, y: 0, width: 800, height: 80,
      text: 'From record high to bear market',
      font: 'Playfair Display', size: 54, weight: 800, color: '#161616',
    } as unknown as import('../schema/types').TextLayer;
    let el!: SVGElement;
    expect(() => { el = renderText(layer, svg); }).not.toThrow();
    // Text may wrap into multiple tspans; assert the words rendered (intact).
    const txt = el.textContent ?? '';
    expect(txt).toContain('record');
    expect(txt).toContain('market');
  });

  it('renders a bare-string content', () => {
    const svg = makeSVG();
    const layer = { id: 't', type: 'text', z: 0, x: 0, y: 0, width: 400, height: 40,
      content: 'plain string' } as unknown as import('../schema/types').TextLayer;
    let el!: SVGElement;
    expect(() => { el = renderText(layer, svg); }).not.toThrow();
    expect(el.textContent ?? '').toContain('plain string');
  });

  it('still renders the canonical content:{type:plain,value} form', () => {
    const svg = makeSVG();
    const layer = { id: 't2', type: 'text', z: 0, x: 0, y: 0, width: 400, height: 40,
      content: { type: 'plain', value: 'canonical' }, style: { font_size: 20 } } as unknown as import('../schema/types').TextLayer;
    expect(renderText(layer, svg).textContent ?? '').toContain('canonical');
  });
});
