import { describe, it, expect, vi } from 'vitest';
import { collectUsedFonts, fontCssUrl, buildEmbeddedFontStyle } from './font-embed';

function svgWith(html: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.innerHTML = html;
  return svg;
}

describe('collectUsedFonts', () => {
  it('gathers families + weights from attributes and inline styles', () => {
    const svg = svgWith(
      '<text font-family="Space Grotesk" font-weight="800">a</text>' +
      '<text font-family="IBM Plex Mono" font-weight="500">b</text>' +
      '<text style="font-family: Inter; font-weight: 400">c</text>',
    );
    const fonts = collectUsedFonts(svg);
    expect([...fonts.get('Space Grotesk')!]).toEqual([800]);
    expect([...fonts.get('IBM Plex Mono')!]).toEqual([500]);
    expect([...fonts.get('Inter')!]).toEqual([400]);
  });

  it('ignores generic keywords and reads the first family of a stack', () => {
    const svg = svgWith(
      '<text font-family="sans-serif">a</text>' +
      '<text font-family="Inter, sans-serif" font-weight="700">b</text>',
    );
    const fonts = collectUsedFonts(svg);
    expect(fonts.has('sans-serif')).toBe(false);
    expect([...fonts.get('Inter')!]).toEqual([700]);
  });

  it('defaults weight to 400 when absent', () => {
    const fonts = collectUsedFonts(svgWith('<text font-family="Lora">a</text>'));
    expect([...fonts.get('Lora')!]).toEqual([400]);
  });
});

describe('fontCssUrl', () => {
  it('builds a css2 url with sorted families + weights', () => {
    const fonts = new Map([
      ['Space Grotesk', new Set([800, 400])],
      ['Inter', new Set([400])],
    ]);
    expect(fontCssUrl(fonts)).toBe(
      'https://fonts.googleapis.com/css2?family=Inter:wght@400&family=Space+Grotesk:wght@400;800&display=swap',
    );
  });

  it('returns null for no fonts', () => {
    expect(fontCssUrl(new Map())).toBeNull();
  });
});

describe('buildEmbeddedFontStyle', () => {
  it('inlines fetched woff2 as a data URI @font-face', async () => {
    const css = "@font-face{font-family:'Inter';src:url(https://fonts.gstatic.com/x.woff2) format('woff2');}";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(css) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer) });
    const style = await buildEmbeddedFontStyle(svgWith('<text font-family="Inter">a</text>'), fetchMock as unknown as typeof fetch);
    expect(style).toContain('<style');
    expect(style).toContain('data:font/woff2;base64,');
    expect(style).not.toContain('https://fonts.gstatic.com/x.woff2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns empty string when there are no web fonts', async () => {
    const fetchMock = vi.fn();
    const style = await buildEmbeddedFontStyle(svgWith('<text font-family="sans-serif">a</text>'), fetchMock as unknown as typeof fetch);
    expect(style).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades to empty string (not throw) when the fetch fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    const style = await buildEmbeddedFontStyle(svgWith('<text font-family="Inter">a</text>'), fetchMock as unknown as typeof fetch);
    expect(style).toBe('');
  });
});
