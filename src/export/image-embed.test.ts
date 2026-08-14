import { describe, it, expect, vi, afterEach } from 'vitest';
import { inlineExternalImages } from './image-embed';

const XLINK = 'http://www.w3.org/1999/xlink';
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function svgWith(html: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.innerHTML = html;
  return svg;
}

/** jsdom has no fetch and its FileReader can't read a stubbed Blob — stub both. */
function stubFetch(handler: (url: string) => { ok: boolean; bytes?: Uint8Array }): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (url: string) => {
    const r = handler(String(url));
    return {
      ok: r.ok,
      blob: async () => ({ size: r.bytes?.length ?? 0, type: 'image/png', bytes: r.bytes }),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', spy);
  class FR {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: { bytes?: Uint8Array }): void {
      this.result = `data:image/png;base64,${Buffer.from(blob.bytes ?? PNG_BYTES).toString('base64')}`;
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('FileReader', FR);
  return spy;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('inlineExternalImages', () => {
  it('rewrites an external href to a data: URI — the export bug in one line', async () => {
    stubFetch(() => ({ ok: true, bytes: PNG_BYTES }));
    const svg = svgWith('<image href="/__project_files/proj/lib/microsoft/logos/outlook.svg" />');

    const n = await inlineExternalImages(svg);

    expect(n).toBe(1);
    expect(svg.querySelector('image')?.getAttribute('href')).toMatch(/^data:image\/png;base64,/);
  });

  it('rewrites BOTH href and xlink:href — an image FILL sets the pair', async () => {
    stubFetch(() => ({ ok: true, bytes: PNG_BYTES }));
    const svg = svgWith('<pattern><image href="/__project_files/p/lib/a.png" /></pattern>');
    const img = svg.querySelector('image')!;
    img.setAttributeNS(XLINK, 'xlink:href', '/__project_files/p/lib/a.png');

    await inlineExternalImages(svg);

    expect(img.getAttribute('href')).toMatch(/^data:/);
    expect(img.getAttributeNS(XLINK, 'href')).toMatch(/^data:/);
  });

  it('fetches each distinct URL ONCE however many layers use it', async () => {
    const spy = stubFetch(() => ({ ok: true, bytes: PNG_BYTES }));
    const svg = svgWith(
      '<image href="/f/logo.svg" /><image href="/f/logo.svg" />' +
      '<image href="/f/logo.svg" /><image href="/f/other.svg" />',
    );

    const n = await inlineExternalImages(svg);

    expect(n).toBe(4);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('leaves data:, blob: and fragment hrefs untouched, and never fetches', async () => {
    const spy = stubFetch(() => ({ ok: true, bytes: PNG_BYTES }));
    const svg = svgWith(
      '<image href="data:image/png;base64,AAAA" /><image href="blob:http://x/1" /><image href="#frag" />',
    );

    expect(await inlineExternalImages(svg)).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the export alive when one asset 404s — a gap, not a crash', async () => {
    stubFetch(url => (url.includes('missing') ? { ok: false } : { ok: true, bytes: PNG_BYTES }));
    const svg = svgWith('<image href="/f/missing.png" /><image href="/f/good.png" />');

    const n = await inlineExternalImages(svg);

    expect(n).toBe(1);
    const [bad, good] = [...svg.querySelectorAll('image')];
    expect(bad?.getAttribute('href')).toBe('/f/missing.png');
    expect(good?.getAttribute('href')).toMatch(/^data:/);
  });

  it('survives a rejected fetch (offline) without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const svg = svgWith('<image href="/f/a.png" />');

    await expect(inlineExternalImages(svg)).resolves.toBe(0);
  });

  it('does no work and issues no request when the SVG has no images', async () => {
    const spy = stubFetch(() => ({ ok: true, bytes: PNG_BYTES }));
    const svg = svgWith('<text>hello</text>');

    expect(await inlineExternalImages(svg)).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
