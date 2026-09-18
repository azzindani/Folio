// The HTML report must load the faces its pages are set in. It loaded only the
// rich_text and report fonts, so an ordinary carousel's SVG headlines — and
// the editor's Preview, which runs this same assembler — came out in the
// browser's default serif.
import { describe, it, expect } from 'vitest';
import { collectSvgFonts, googleFontLinks } from './svg-fonts';
import { assembleReportHTML } from './html-assembler';
import type { DesignSpec } from '../schema/types';

describe('collectSvgFonts', () => {
  it('reads attribute and style forms, skipping generics and system faces', () => {
    const into = new Set<string>();
    collectSvgFonts(
      `<text font-family="Space Grotesk, sans-serif">a</text>`
      + `<text style="font-family: 'JetBrains Mono', monospace">b</text>`
      + `<text font-family="system-ui, Arial">c</text>`,
      into,
    );
    expect([...into].sort()).toEqual(['JetBrains Mono', 'Space Grotesk']);
  });

  it('ignores CSS variables and theme tokens', () => {
    const into = new Set<string>();
    collectSvgFonts(`<p style="font-family:var(--folio-font-body,system-ui)">x</p><text font-family="$heading">y</text>`, into);
    expect(into.size).toBe(0);
  });
});

describe('googleFontLinks', () => {
  it('emits one stylesheet per family, so one bad name cannot sink the rest', () => {
    const html = googleFontLinks(['Space Grotesk', 'Not A Real Font']);
    expect(html.match(/rel="stylesheet"/g)).toHaveLength(2);
    expect(html).toContain('family=Space+Grotesk');
  });

  it('emits nothing for no families', () => {
    expect(googleFontLinks([])).toBe('');
  });
});

describe('assembleReportHTML', () => {
  it('loads the family an ordinary text layer is set in', () => {
    const spec = {
      _protocol: 'design/v1',
      meta: { id: 'x', name: 'Deck', type: 'carousel', created: '', modified: '' },
      document: { width: 1080, height: 1350, unit: 'px' },
      pages: [{
        id: 'p1', label: 'One',
        layers: [{
          id: 'h', type: 'text', z: 1, x: 80, y: 120, width: 900,
          content: 'Folio', style: { font_family: 'Space Grotesk', font_size: 120 },
        }],
      }],
    } as unknown as DesignSpec;
    const html = assembleReportHTML(spec, new Map());
    expect(html).toContain('fonts.googleapis.com/css2?family=Space+Grotesk');
  });
});
