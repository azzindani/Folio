import { describe, it, expect } from 'vitest';
import { fixInvisibleText } from './engine-finalize-text';
import type { Layer } from '../schema/types';

const W = 1080, H = 1080;
const bgRect = (color: string, useColorKey = false): Layer => (useColorKey
  ? { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H, color } as unknown as Layer
  : { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H, fill: { type: 'solid', color } } as unknown as Layer);
const text = (id: string, value: string, style: Record<string, unknown>, flatColor?: string): Layer =>
  ({ id, type: 'text', z: 1, x: 80, y: 100, width: 800, height: 80, content: { type: 'plain', value }, style, ...(flatColor ? { color: flatColor } : {}) } as unknown as Layer);

const styleColor = (l: Layer): string => ((l as unknown as Record<string, unknown>)['style'] as Record<string, string>)['color'];

describe('fixInvisibleText', () => {
  it('recovers the model\'s legible flat color when a nested style color is invisible', () => {
    // dark nested #1A1A1A on black bg, but the model\'s flat intent is white.
    const layers = [bgRect('#0A0A0A'), text('t', 'IRONCLAD', { color: '#1A1A1A', font_size: 60 }, '#FFFFFF')];
    expect(fixInvisibleText(layers, W, H)).toBe(1);
    expect(styleColor(layers[1])).toBe('#FFFFFF');
  });

  it('forces a backdrop-matched neutral when no legible flat color exists', () => {
    const layers = [bgRect('#0A0A0A'), text('t', 'Doors 7 PM', { color: '#1A1A1A', font_size: 32 })];
    fixInvisibleText(layers, W, H);
    expect(styleColor(layers[1])).toBe('#FAFAFA'); // dark bg → light text
  });

  it('forces dark text on a light backdrop (pale-on-light)', () => {
    const layers = [bgRect('#F5EFE6'), text('t', 'HALON', { color: '#E0E0FF', font_size: 48 })];
    fixInvisibleText(layers, W, H);
    expect(styleColor(layers[1])).toBe('#141414'); // light bg → dark text
  });

  it('recognises a backdrop rect that carries its fill under `color`', () => {
    const layers = [bgRect('#0A0A0A', true), text('t', 'x', { color: '#111111', font_size: 40 })];
    expect(fixInvisibleText(layers, W, H)).toBe(1);
  });

  it('leaves already-legible text untouched', () => {
    const layers = [bgRect('#0A0A0A'), text('t', 'readable', { color: '#FAFAFA', font_size: 40 })];
    expect(fixInvisibleText(layers, W, H)).toBe(0);
    expect(styleColor(layers[1])).toBe('#FAFAFA');
  });

  it('does nothing when the backdrop is unknown (theme-only, no bg rect)', () => {
    const layers = [text('t', 'x', { color: '#E0E0FF', font_size: 40 })];
    expect(fixInvisibleText(layers, W, H)).toBe(0);
  });

  it('skips theme-token colors it cannot evaluate', () => {
    const layers = [bgRect('#0A0A0A'), text('t', 'x', { color: '$text', font_size: 40 })];
    expect(fixInvisibleText(layers, W, H)).toBe(0);
  });

  it('resolves a theme TOKEN text color and re-lights it on a contradicting bg', () => {
    // The children\'s-book failure: editorial-cream\'s $text (#2A2218 dark) over a
    // navy bg rect → invisible. The pass must resolve the token to evaluate it.
    const theme = { _protocol: 'theme/v1', name: 't', version: '1', colors: { background: '#FAF5EC', text: '#2A2218', secondary: '#3F5E4A' } } as unknown as import('../schema/types').ThemeSpec;
    const layers = [bgRect('#0A2463'), text('t', 'The Moon Forgot', { color: '$text', font_size: 80 })];
    expect(fixInvisibleText(layers, W, H, theme)).toBe(1);
    expect(styleColor(layers[1])).toBe('#FAFAFA'); // navy bg → light text
  });

  it('uses the theme background as the backdrop when there is no bg rect', () => {
    const theme = { _protocol: 'theme/v1', name: 't', version: '1', colors: { background: '#FAF5EC', text: '#2A2218' } } as unknown as import('../schema/types').ThemeSpec;
    // pale label on the cream theme bg, no rect — now catchable via the theme bg.
    const layers = [text('t', 'HALON', { color: '#EFE7D6', font_size: 48 })];
    expect(fixInvisibleText(layers, W, H, theme)).toBe(1);
    expect(styleColor(layers[0])).toBe('#141414');
  });

  it('reads a GRADIENT backdrop (averaged stops) — does not darken pale text on a dark gradient', () => {
    // The HALON canvas bug: a dark linear-gradient bg + pale text was wrongly
    // re-lit DARK because the gradient backdrop read as "none" → theme(light) fallback.
    const gradBg = { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H,
      fill: { type: 'linear', stops: [{ color: '#0A1430', position: 0 }, { color: '#1C1A3A', position: 50 }, { color: '#3E2A2E', position: 100 }] } } as unknown as Layer;
    const layers = [gradBg, text('t', 'HALON', { color: '#EDE6F2', font_size: 48 })];
    expect(fixInvisibleText(layers, W, H)).toBe(0);           // pale text on dark gradient = legible, untouched
    expect(styleColor(layers[1])).toBe('#EDE6F2');
  });

  it('re-lights dark text that IS invisible on a dark gradient backdrop', () => {
    const gradBg = { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H,
      fill: { type: 'linear', stops: [{ color: '#0A0A0A' }, { color: '#101018' }] } } as unknown as Layer;
    const layers = [gradBg, text('t', 'x', { color: '#1A1A1A', font_size: 40 })];
    expect(fixInvisibleText(layers, W, H)).toBe(1);
    expect(styleColor(layers[1])).toBe('#FAFAFA');
  });

  it('rescues text nested inside a group (one-group MCP posters)', () => {
    const inner = text('t', 'buried', { color: '#1A1A1A', font_size: 40 });
    const group = { id: 'g', type: 'group', z: 1, layers: [inner] } as unknown as Layer;
    const layers = [bgRect('#0A0A0A'), group];
    expect(fixInvisibleText(layers, W, H)).toBe(1);
    expect(styleColor(inner)).toBe('#FAFAFA');
  });
});
