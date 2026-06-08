/** WS3 typography: transform, variable fonts, OpenType, outline, text-on-path, highlight. */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderText } from './layer-renderers';
import { createSVGRoot, resetDefIdCounter } from './svg-utils';
import type { TextLayer, TextStyle } from '../schema/types';

beforeEach(() => resetDefIdCounter());

function render(value: string, style: TextStyle, extra: Partial<TextLayer> = {}) {
  const svg = createSVGRoot(400, 200);
  const layer = {
    id: 't', type: 'text', z: 1, x: 20, y: 30, width: 360, height: 60,
    content: { type: 'plain', value }, style, ...extra,
  } as unknown as TextLayer;
  const g = renderText(layer, svg);
  svg.appendChild(g);
  return { svg, g };
}

describe('text-transform', () => {
  it('uppercases at the string level (resvg-safe)', () => {
    const { g } = render('Field Notes', { font_size: 24, text_transform: 'uppercase' });
    expect(g.querySelector('text')!.textContent).toBe('FIELD NOTES');
  });
  it('capitalizes each word', () => {
    const { g } = render('field notes', { font_size: 24, text_transform: 'capitalize' });
    expect(g.querySelector('text')!.textContent).toBe('Field Notes');
  });
});

describe('font-style / variable fonts / OpenType', () => {
  it('sets font-style italic', () => {
    const { g } = render('x', { font_style: 'italic' });
    expect(g.querySelector('text')!.getAttribute('font-style')).toBe('italic');
  });
  it('emits font-variation-settings from an axis map', () => {
    const { g } = render('x', { font_variation_settings: { wght: 350, wdth: 80 } });
    const fv = (g.querySelector('text') as SVGElement).style.getPropertyValue('font-variation-settings');
    expect(fv).toContain('"wght" 350');
    expect(fv).toContain('"wdth" 80');
  });
  it('emits font-feature-settings from a feature map', () => {
    const { g } = render('1234', { font_feature_settings: { tnum: 1, smcp: 1 } });
    const ff = (g.querySelector('text') as SVGElement).style.getPropertyValue('font-feature-settings');
    expect(ff).toContain('"tnum" 1');
  });
});

describe('text outline + highlight', () => {
  it('outlines glyphs with stroke + paint-order', () => {
    const { g } = render('x', { stroke: { color: '#000', width: 3 } });
    const t = g.querySelector('text')!;
    expect(t.getAttribute('stroke')).toBe('#000');
    expect(t.getAttribute('stroke-width')).toBe('3');
    expect(t.getAttribute('paint-order')).toBe('stroke');
  });
  it('paints a highlight band behind the text', () => {
    const { g } = render('marker', { font_size: 24, highlight: '#FDE047' });
    const rect = g.querySelector('rect');
    expect(rect).toBeTruthy();
    expect(rect!.getAttribute('fill')).toBe('#FDE047');
  });
});

describe('text-on-path', () => {
  it('curves a line along a path via <textPath> + a defs <path>', () => {
    const { svg, g } = render('around', { text_path: { d: 'M0 100 Q100 0 200 100', start_offset: 10 } });
    const tp = g.querySelector('textPath')!;
    expect(tp).toBeTruthy();
    expect(tp.getAttribute('href')).toMatch(/^#textpath-/);
    expect(tp.getAttribute('startOffset')).toBe('10%');
    expect(tp.textContent).toBe('around');
    expect(svg.querySelector('defs path')!.getAttribute('d')).toBe('M0 100 Q100 0 200 100');
  });
});
