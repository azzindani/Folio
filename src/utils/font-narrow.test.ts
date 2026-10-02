import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { svgFamilies, narrowFonts, fallbackFonts } from './font-narrow';
import { Resvg } from '@resvg/resvg-js';
import { renderInProcess } from './resvg-isolate';

const FONTS = path.resolve(process.cwd(), 'src/mcp/fonts');
const full = { font: { fontDirs: [FONTS], loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } };
const svg = (family: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><rect width="400" height="120" fill="#fff"/>` +
  `<text x="10" y="80" font-family="${family}" font-weight="800" font-size="56" fill="#111">Words in.</text>` +
  `<text x="10" y="110" style="font-family: 'Space Grotesk', sans-serif; font-size: 20px" fill="#111">sub line</text></svg>`;

describe('svgFamilies', () => {
  it('reads attributes, styles and entity-quoted lists', () => {
    expect([...svgFamilies(svg('&quot;Archivo&quot;, sans-serif'))].sort()).toEqual(['archivo', 'sans-serif', 'space grotesk']);
  });
});

describe('narrowFonts', () => {
  it.skipIf(!fallbackFonts())('keeps the full option when the text uses a glyph a named family lacks', () => {
    expect(narrowFonts(svg('Archivo'), full)).not.toBe(full);
    expect(narrowFonts(svg('Archivo').replace('Words in.', 'Done ✓'), full)).toBe(full);
  });

  it('keeps the full option for italic text — no bundled face is italic', () => {
    expect(narrowFonts(svg('Archivo').replace('font-weight="800"', 'font-weight="800" font-style="italic"'), full)).toBe(full);
  });

  it('keeps the full option for a family that is not bundled', () => {
    expect(narrowFonts(svg('Some Uploaded Face'), full)).toBe(full);
    expect(narrowFonts(svg('Archivo'), undefined)).toBeUndefined();
  });

  it.skipIf(!fallbackFonts())('hands resvg only the named families plus DejaVu — and draws the same pixels', () => {
    const narrowed = narrowFonts(svg('Archivo'), full);
    const files = narrowed?.font && 'fontFiles' in narrowed.font ? narrowed.font.fontFiles ?? [] : [];
    expect(files.some(f => /Archivo-ExtraBold/.test(f))).toBe(true);
    expect(files.some(f => /SpaceGrotesk/.test(f))).toBe(true);
    expect(files.some(f => /Anton/.test(f))).toBe(false);
    const a = renderInProcess({ svg: svg('Archivo'), opts: full, want: 'pixels' });
    const withAll = Buffer.from(new Resvg(svg('Archivo'), full).render().pixels);   // no narrowing
    expect(a.pixels.equals(withAll)).toBe(true);
  });
});
