import { describe, it, expect, beforeEach } from 'vitest';
import { loadVectorFont, _resetFontManifestCache } from './pdf-fonts-browser';
import type { PdfTextDoc } from './pdf-draw';

const MANIFEST = { files: { Inter: ['Inter[opsz,wght].ttf'] } };

function fakeFetch(log: string[]): typeof fetch {
  return (async (url: string) => {
    log.push(url);
    if (url === '/fonts/manifest.json') {
      return { ok: true, json: async () => MANIFEST } as unknown as Response;
    }
    if (url.startsWith('/fonts/')) {
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer } as unknown as Response;
    }
    return { ok: false } as unknown as Response;
  }) as unknown as typeof fetch;
}

function stubPdf(): { doc: PdfTextDoc; vfs: string[]; fonts: string[] } {
  const vfs: string[] = []; const fonts: string[] = [];
  const doc = {
    addFileToVFS: (f: string) => { vfs.push(f); },
    addFont: (_f: string, family: string) => { fonts.push(family); },
    setFont: () => {}, setFontSize: () => {}, setTextColor: () => {},
    setDrawColor: () => {}, setLineWidth: () => {}, text: () => {},
  } as PdfTextDoc;
  return { doc, vfs, fonts };
}

describe('loadVectorFont', () => {
  beforeEach(() => _resetFontManifestCache());

  it('fetches the manifest + TTF, registers the font, returns alias + faux-bold', async () => {
    const log: string[] = [];
    const { doc, vfs, fonts } = stubPdf();
    const registered = new Set<string>();
    const pick = await loadVectorFont(doc, 'Inter', 800, registered, fakeFetch(log));
    expect(pick).not.toBeNull();
    expect(pick!.fauxBold).toBe(true);            // variable Inter @ 800 → faux-bold
    expect(vfs).toEqual(['Inter[opsz,wght].ttf']);
    expect(fonts).toHaveLength(1);
    expect(registered.has(pick!.alias)).toBe(true);
    expect(log).toContain('/fonts/manifest.json');
    expect(log.some(u => u.startsWith('/fonts/Inter'))).toBe(true);
  });

  it('returns null for an unbundled family and never fetches a TTF', async () => {
    const log: string[] = [];
    const { doc, vfs } = stubPdf();
    const pick = await loadVectorFont(doc, 'Comic Sans MS', 400, new Set(), fakeFetch(log));
    expect(pick).toBeNull();
    expect(vfs).toHaveLength(0);
  });

  it('does not re-embed an already-registered font', async () => {
    const log: string[] = [];
    const { doc, vfs } = stubPdf();
    const registered = new Set<string>();
    await loadVectorFont(doc, 'Inter', 400, registered, fakeFetch(log));
    const ttfFetches1 = log.filter(u => u.startsWith('/fonts/Inter')).length;
    await loadVectorFont(doc, 'Inter', 400, registered, fakeFetch(log));
    const ttfFetches2 = log.filter(u => u.startsWith('/fonts/Inter')).length;
    expect(vfs).toHaveLength(1);          // embedded once
    expect(ttfFetches2).toBe(ttfFetches1); // no second TTF fetch
  });
});
