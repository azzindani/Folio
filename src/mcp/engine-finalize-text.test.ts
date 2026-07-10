import { describe, it, expect } from 'vitest';
import { fixInvisibleText } from './engine-finalize-legibility';
import type { Layer } from '../schema/types';

const W = 1080, H = 1080;
const bgRect = (color: string, useColorKey = false): Layer => (useColorKey
  ? { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H, color } as unknown as Layer
  : { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H, fill: { type: 'solid', color } } as unknown as Layer);
const text = (id: string, value: string, style: Record<string, unknown>, flatColor?: string): Layer =>
  ({ id, type: 'text', z: 1, x: 80, y: 100, width: 800, height: 80, content: { type: 'plain', value }, style, ...(flatColor ? { color: flatColor } : {}) } as unknown as Layer);

const styleColor = (l: Layer): string => ((l as unknown as Record<string, unknown>)['style'] as Record<string, string>)['color'];
// A positioned opaque shape (a band / card / badge behind the text).
const shapeAt = (color: string, x: number, y: number, w: number, h: number, z: number, opacity = 1): Layer =>
  ({ id: `s${z}`, type: 'rect', z, x, y, width: w, height: h, opacity, fill: { type: 'solid', color } } as unknown as Layer);
// A text at an explicit position + z (the base `text` helper pins x:80 y:100 z:1).
const textAt = (value: string, x: number, y: number, color: string): Layer =>
  ({ id: 't', type: 'text', z: 2, x, y, width: 800, height: 80, content: { type: 'plain', value }, style: { color, font_size: 48 } } as unknown as Layer);
// A label sized INTO the 230×64 pill at (120,840) so the pill is its local backdrop.
const pillLabel = (color: string): Layer =>
  ({ id: 't', type: 'text', z: 2, x: 120, y: 856, width: 230, height: 32, content: { type: 'plain', value: '3 STEPS' }, style: { color, font_size: 24 } } as unknown as Layer);

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

  it('keeps a white knockout that sits on a LOCAL dark band over a light page', () => {
    // The common hero-band pattern: light page, dark band, white headline ON the
    // band. Judged against the dominant light bg it would be wrongly darkened.
    const band = shapeAt('#101010', 0, 80, W, 160, 1);
    const head = textAt('HEADLINE', 80, 100, '#FFFFFF');
    const layers = [bgRect('#F5EFE6'), band, head];
    expect(fixInvisibleText(layers, W, H)).toBe(0);   // legible on its real backdrop
    expect(styleColor(head)).toBe('#FFFFFF');
  });

  it('keeps dark text on a LOCAL light card over a dark page', () => {
    const card = shapeAt('#F0F0F0', 40, 80, 900, 160, 1);
    const body = textAt('Card body text', 80, 100, '#1E1E1E');
    const layers = [bgRect('#0A0A0A'), card, body];
    expect(fixInvisibleText(layers, W, H)).toBe(0);
    expect(styleColor(body)).toBe('#1E1E1E');
  });

  it('still rescues invisible text that is NOT on a local panel', () => {
    // Same light page + dark band, but the pale text floats BELOW the band on the
    // bare page — no local cover → judged against the light bg → rescued.
    const band = shapeAt('#101010', 0, 80, W, 160, 1);
    const floating = textAt('a pale subhead', 80, 420, '#EFE7D6');
    const layers = [bgRect('#F5EFE6'), band, floating];
    expect(fixInvisibleText(layers, W, H)).toBe(1);
    expect(styleColor(floating)).toBe('#141414');     // light page → dark text
  });

  it('re-lights a muted SATURATED color by darkening its hue, not nuking to black', () => {
    // terracotta eyebrow on cream (CR ≈ 2.06 < 2.5) → re-lit, but it must stay
    // terracotta (reddish), not flatten to #141414.
    const layers = [bgRect('#F1E7D6'), text('t', 'BACK IN STOCK', { color: '#BD5733', font_size: 26 })];
    expect(fixInvisibleText(layers, W, H)).toBe(1);
    const c = styleColor(layers[1]).replace('#', '');
    expect(c).not.toBe('141414');
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    expect(r).toBeGreaterThan(g);   // still reddish/warm, hue preserved
    expect(r).toBeGreaterThan(b);
  });

  it('falls back to a neutral for a greyscale invisible color (no hue to keep)', () => {
    const layers = [bgRect('#F2EFE6'), text('t', 'x', { color: '#C8C8C8', font_size: 30 })];
    fixInvisibleText(layers, W, H);
    expect(styleColor(layers[1])).toBe('#141414');   // light bg, greyscale → neutral dark
  });

  it('re-seal stays SILENT when relight caps out at the current color (no phantom count)', () => {
    // #FAFAFA on a saturated vermillion pill misses the target ratio, and the
    // best relight candidate IS #FAFAFA — nothing changes, so nothing may be
    // counted. (Every seal of pour-over-guide-v2 reported a phantom "Re-lit 1".)
    const pill = shapeAt('#c4552a', 120, 840, 230, 64, 1);
    const lbl = pillLabel('#FAFAFA');
    const layers = [bgRect('#f4efe6'), pill, lbl];
    expect(fixInvisibleText(layers, W, H)).toBe(0);
    expect(styleColor(lbl)).toBe('#FAFAFA');           // untouched
  });

  it('still counts a REAL relight, and the follow-up run is a no-op', () => {
    const pill = shapeAt('#c4552a', 120, 840, 230, 64, 1);
    const lbl = pillLabel('#f4efe6');                    // low-contrast cream → re-lit
    const layers = [bgRect('#f4efe6'), pill, lbl];
    expect(fixInvisibleText(layers, W, H)).toBe(1);
    expect(fixInvisibleText(layers, W, H)).toBe(0);      // idempotent in count, not just bytes
  });

  it('does NOT treat a translucent panel as a solid backdrop', () => {
    // A 0.3-opacity dark band can't make white text legible on a light page, so the
    // text is judged against the opaque ground (light) and rescued.
    const sheer = shapeAt('#101010', 0, 80, W, 160, 1, 0.3);
    const head = textAt('GHOST', 80, 100, '#FFFFFF');
    const layers = [bgRect('#F0F0F0'), sheer, head];
    expect(fixInvisibleText(layers, W, H)).toBe(1);
    expect(styleColor(head)).toBe('#141414');
  });
});
