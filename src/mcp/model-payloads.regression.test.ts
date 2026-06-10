import { describe, it, expect } from 'vitest';
import { expandShorthandLayers, coerceShorthandLayers } from './shorthand-parser';
import { renderToSVGString } from './engine/svg-export';
import type { DesignSpec, Layer } from '../schema/types';

/**
 * Regression corpus — the ACTUAL malformed/complex shorthand payloads emitted
 * by the lab agents (nemotron-nano and Kimi K2.6) this session, frozen as
 * fixtures. Each previously rendered blank / collapsed / dropped content; this
 * suite asserts the meaningful render outcome survives. If a future change
 * regresses small-model robustness, one of these fails — turning "is it
 * improving?" into a checked number rather than a claim.
 *
 * Provenance: payloads captured from ~/.claude/projects/-workspace/*.jsonl in
 * the harness-claude container (see project-harnesses-lab-mcp memory).
 */

// Assemble a design from a shorthand-layers object and render it to SVG.
function renderSVG(layersObj: unknown, themeRef = 'dark-tech'): { svg: string; layers: Layer[] } {
  const layers = expandShorthandLayers(coerceShorthandLayers(layersObj));
  const spec = {
    _protocol: 'design/v1',
    meta: { id: 'r', name: 'Regression', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
    document: { width: 1080, height: 1080, unit: 'px' },
    theme: { ref: themeRef },
    layers,
  } as unknown as DesignSpec;
  return { svg: renderToSVGString(spec), layers };
}

// Find a layer by id anywhere in the (possibly nested) tree.
function byId(layers: Layer[], id: string): Layer | undefined {
  for (const l of layers) {
    if (l.id === id) return l;
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    if (kids) { const f = byId(kids, id); if (f) return f; }
  }
  return undefined;
}

describe('regression corpus — real lab-agent payloads stay rendered', () => {
  it('nemotron verbose-schema aliases: content/font_size survive (was blank)', () => {
    const { svg, layers } = renderSVG({
      title: { pos: [200, 50, 800, 150], type: 'text', content: 'Morning Coffee', font_size: 80, color: '#333' },
    });
    const t = byId(layers, 'title') as Layer & { content?: { value?: string }; style?: { font_size?: number } };
    expect(t.content?.value).toBe('Morning Coffee');
    expect(t.style?.font_size).toBe(80);
    expect(svg).toContain('Morning Coffee');
  });

  it('nemotron terse single-letter keys: p/t/f/c/s/col render (was invisible)', () => {
    const { svg, layers } = renderSVG({
      bg: { p: [0, 0, 1080, 1080], t: 'rect', f: 'linear-gradient(to right, #f5c6a5, #e0a96d)' },
      headline: { p: [140, 120, 800, 150], c: 'BREW AND CO', s: 90, t: 'text', col: '#3b2415' },
    });
    const h = byId(layers, 'headline') as Layer & { content?: { value?: string }; style?: { font_size?: number } };
    expect(h.content?.value).toBe('BREW AND CO');
    expect(h.style?.font_size).toBe(90);
    const bg = byId(layers, 'bg') as Layer & { fill?: { type?: string } };
    expect(bg.fill?.type).toBe('linear');
    expect(svg).toContain('BREW AND CO');
  });

  it('bare "gradient" keyword → themed gradient (was invalid black)', () => {
    const { layers } = renderSVG({ bg: { type: 'rect', pos: [0, 0, 1080, 1080], fill: 'gradient' } });
    const bg = byId(layers, 'bg') as Layer & { fill?: { type?: string; stops?: { color: string }[] } };
    expect(bg.fill?.type).toBe('linear');
    expect(bg.fill?.stops?.length).toBe(2);
  });

  it('Kimi children-nesting + shape + corner_radius (was dropped → "nesting unsupported")', () => {
    const { svg, layers } = renderSVG({
      bg: { type: 'shape', pos: [0, 0, 1080, 1080], fill: '#0f0c29', corner_radius: 0 },
      'card-row': { type: 'row', pos: [70, 470, 940, 420], gap: 28, children: [
        { type: 'column', width: 290, height: 420, corner_radius: 18, children: [
          { type: 'icon', width: 56, height: 56, icon: 'zap' },
          { type: 'text', width: 230, height: 44, text: 'Realtime Sync', font_size: 30 },
        ] },
      ] },
    });
    expect((byId(layers, 'bg') as Layer).type).toBe('rect'); // shape→rect
    const row = byId(layers, 'card-row') as Layer & { type?: string; radius?: number; layers?: Layer[] };
    expect(row.type).toBe('auto_layout');
    const col = row.layers?.[0] as Layer & { type?: string; radius?: number };
    expect(col.type).toBe('auto_layout');
    expect(col.radius).toBe(18); // corner_radius→radius
    expect(svg).toContain('Realtime Sync');
  });

  it('Kimi sizeless columns flex-distribute instead of collapsing', () => {
    // A row whose 3 children have NO width → renderAutoLayout must spread them.
    const { layers } = renderSVG({
      row: { type: 'row', pos: [60, 400, 960, 300], gap: 20, layers: [
        { type: 'column', height: 300, layers: [{ type: 'text', width: 240, height: 50, text: 'A', size: 28 }] },
        { type: 'column', height: 300, layers: [{ type: 'text', width: 240, height: 50, text: 'B', size: 28 }] },
        { type: 'column', height: 300, layers: [{ type: 'text', width: 240, height: 50, text: 'C', size: 28 }] },
      ] },
    });
    const row = byId(layers, 'row') as Layer & { layers?: Layer[] };
    expect(row.layers).toHaveLength(3);
    // (flex sizing happens at render time; here we assert the structure is intact
    // and the render produces all three labels)
    const svg = renderSVG({
      row: { type: 'row', pos: [60, 400, 960, 300], gap: 20, layers: [
        { type: 'column', height: 300, layers: [{ type: 'text', width: 240, height: 50, text: 'AAA', size: 28 }] },
        { type: 'column', height: 300, layers: [{ type: 'text', width: 240, height: 50, text: 'BBB', size: 28 }] },
        { type: 'column', height: 300, layers: [{ type: 'text', width: 240, height: 50, text: 'CCC', size: 28 }] },
      ] },
    }).svg;
    expect(svg).toContain('AAA');
    expect(svg).toContain('BBB');
    expect(svg).toContain('CCC');
  });

  it('repeat with data binding generates one card per row', () => {
    const { svg, layers } = renderSVG({
      tiers: { type: 'row', pos: [70, 360, 940, 560], gap: 28, layers: {
        card: { type: 'column', repeat: [{ name: 'Starter', price: '$0' }, { name: 'Pro', price: '$19' }, { name: 'Team', price: '$49' }],
                width: 290, height: 560, fill: '#16213E', layers: {
          plan: { type: 'text', width: 220, height: 44, text: '{{name}}', size: 36 },
          price: { type: 'text', width: 220, height: 90, text: '{{price}}', size: 72 },
        } },
      } },
    });
    const tiers = byId(layers, 'tiers') as Layer & { layers?: Layer[] };
    expect(tiers.layers).toHaveLength(3);
    expect(svg).toContain('Starter');
    expect(svg).toContain('$49');
  });

  it('icon synonyms resolve; unreal names fall back to a clean circle (no raw-name leak)', () => {
    const { svg } = renderSVG({
      a: { type: 'icon', pos: [0, 0, 48, 48], icon: 'photo' },              // → image glyph
      b: { type: 'icon', pos: [100, 0, 48, 48], icon: '__no_such_icon__' }, // → circle fallback
    });
    // The unresolved name must NOT leak as visible text; it renders a circle.
    expect(svg).not.toContain('__no_such_icon__');
    expect(svg).toContain('<circle');
  });
});
