import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../schema/types';
import {
  collectLayerAnimations,
  pageLayers,
  injectStyle,
  buildAnimatedSVG,
  wrapAnimatedHTML,
} from './svg-animate';

const STUB_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect/></svg>';

function spec(over: Partial<DesignSpec> = {}): DesignSpec {
  return {
    document: { width: 100, height: 100, unit: 'px', dpi: 96 },
    layers: [],
    ...over,
  } as DesignSpec;
}

function layer(id: string, extra: Record<string, unknown> = {}): Layer {
  return { id, type: 'rect', ...extra } as unknown as Layer;
}

describe('collectLayerAnimations', () => {
  it('finds animations on top-level layers', () => {
    const m = collectLayerAnimations([
      layer('a', { animation: { loop: { type: 'pulse' } } }),
      layer('b'),
    ]);
    expect([...m.keys()]).toEqual(['a']);
  });

  it('recurses into nested groups', () => {
    // An MCP-authored carousel page is ONE locked group, so a shallow walk
    // would report zero animations on every deck the engine produces.
    const m = collectLayerAnimations([
      layer('g1', {
        type: 'group',
        layers: [
          layer('inner', { animation: { enter: { type: 'fade_up' } } }),
          layer('g2', { type: 'group', layers: [layer('deep', { animation: { loop: { type: 'spin' } } })] }),
        ],
      }),
    ]);
    expect([...m.keys()].sort()).toEqual(['deep', 'inner']);
  });

  it('ignores layers with no animation', () => {
    expect(collectLayerAnimations([layer('x'), layer('y')]).size).toBe(0);
  });
});

describe('pageLayers', () => {
  it('returns root layers for a single-page poster', () => {
    expect(pageLayers(spec({ layers: [layer('p')] }), 0)).toHaveLength(1);
  });

  it('selects the requested page of a deck', () => {
    const s = spec({
      pages: [
        { id: 'p1', layers: [layer('one')] },
        { id: 'p2', layers: [layer('two'), layer('three')] },
      ],
    } as Partial<DesignSpec>);
    expect(pageLayers(s, 1)).toHaveLength(2);
  });

  it('clamps an out-of-range page index instead of throwing', () => {
    const s = spec({ pages: [{ id: 'p1', layers: [layer('one')] }] } as Partial<DesignSpec>);
    expect(pageLayers(s, 99)).toHaveLength(1);
  });
});

describe('injectStyle', () => {
  it('inserts a style element after the opening svg tag', () => {
    const out = injectStyle(STUB_SVG, 'rect { opacity: 0.5; }');
    expect(out).toContain('<style');
    expect(out.indexOf('<style')).toBeGreaterThan(out.indexOf('<svg'));
    expect(out.indexOf('<style')).toBeLessThan(out.indexOf('<rect'));
  });

  it('wraps CSS in CDATA so the SVG stays well-formed XML', () => {
    // A bare > from a child selector would otherwise break strict XML parsers.
    const out = injectStyle(STUB_SVG, 'g > rect { fill: red; }');
    expect(out).toContain('<![CDATA[');
    expect(out).toContain('g > rect');
  });

  it('is a no-op for empty CSS', () => {
    expect(injectStyle(STUB_SVG, '   ')).toBe(STUB_SVG);
  });

  it('returns the input unchanged when there is no svg tag', () => {
    expect(injectStyle('<html></html>', 'a{}')).toBe('<html></html>');
  });
});

describe('buildAnimatedSVG', () => {
  const renderSVG = (): string => STUB_SVG;

  it('injects keyframe CSS for an animated layer', () => {
    const s = spec({
      layers: [layer('box', {
        animation: {
          keyframes: [{ t: 0, opacity: 0 }, { t: 1000, opacity: 1 }],
          playback: { duration: 1000 },
        },
      })],
    });
    const r = buildAnimatedSVG(s, { renderSVG });
    expect(r.animatedLayers).toEqual(['box']);
    expect(r.svg).toContain('@keyframes kf-box');
    expect(r.svg).toContain('[data-layer-id="box"]');
  });

  it('reports a still result when nothing is animated', () => {
    const r = buildAnimatedSVG(spec({ layers: [layer('plain')] }), { renderSVG });
    expect(r.animatedLayers).toEqual([]);
    expect(r.svg).not.toContain('<style');
  });

  it('collects animations from the requested page only', () => {
    const s = spec({
      pages: [
        { id: 'p1', layers: [layer('a', { animation: { loop: { type: 'spin' } } })] },
        { id: 'p2', layers: [layer('b', { animation: { loop: { type: 'pulse' } } })] },
      ],
    } as Partial<DesignSpec>);
    expect(buildAnimatedSVG(s, { renderSVG, pageIndex: 1 }).animatedLayers).toEqual(['b']);
  });
});

describe('wrapAnimatedHTML', () => {
  it('produces a standalone document containing the svg', () => {
    const html = wrapAnimatedHTML(STUB_SVG, 'My Design');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain(STUB_SVG);
    expect(html).toContain('<title>My Design</title>');
  });

  it('honors prefers-reduced-motion', () => {
    // A loop the viewer cannot stop is an accessibility failure, not a feature.
    expect(wrapAnimatedHTML(STUB_SVG, 'x')).toContain('prefers-reduced-motion');
  });

  it('escapes markup in the title', () => {
    expect(wrapAnimatedHTML(STUB_SVG, '<script>&')).toContain('&lt;script&gt;&amp;');
  });
});
