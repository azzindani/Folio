// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ensureDesignFonts, _resetFontLoader } from './font-loader';

describe('ensureDesignFonts', () => {
  beforeEach(() => _resetFontLoader());

  const links = (): HTMLLinkElement[] =>
    [...document.head.querySelectorAll('link[data-folio-fonts="design"]')] as HTMLLinkElement[];

  it('injects one Google Fonts link per real family', () => {
    ensureDesignFonts(['Orbitron', 'Bricolage Grotesque']);
    const hrefs = links().map(l => l.href);
    expect(hrefs.length).toBe(2);
    expect(hrefs.some(h => h.includes('family=Orbitron'))).toBe(true);
    expect(hrefs.some(h => h.includes('family=Bricolage+Grotesque'))).toBe(true);
  });

  it('skips theme tokens ($heading), generics, and blanks', () => {
    ensureDesignFonts(['$heading', 'sans-serif', '', 'Inter']);
    const hrefs = links().map(l => l.href);
    expect(hrefs.length).toBe(1);
    expect(hrefs[0]).toContain('family=Inter');
  });

  it('dedupes across calls (case-insensitive) — each family loads once', () => {
    ensureDesignFonts(['Orbitron']);
    ensureDesignFonts(['orbitron', 'Quicksand']);
    expect(links().length).toBe(2);
  });
});
