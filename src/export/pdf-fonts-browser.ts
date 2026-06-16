// Browser font registry for VECTOR pdf export. jsPDF needs real TTF bytes to
// embed selectable, infinitely-crisp glyphs; the browser can't read the bundled
// fonts off disk, so it FETCHES them from `/fonts/…` (served by the Vite
// dev/preview server and the production static-server — see folioFontsPlugin).
// Uses the same `selectFontFile` the MCP server uses, so the editor's PDF picks
// the identical TTF and matches the server's PDF.

import { selectFontFile } from './pdf-font-select';
import type { PdfTextDoc } from './pdf-draw';

export interface BrowserFontPick { alias: string; fauxBold: boolean; }

let _filesPromise: Promise<Record<string, string[]>> | null = null;

/** Fetch (once) the family→files map the server publishes at /fonts/manifest.json. */
function fontFiles(fetchImpl: typeof fetch): Promise<Record<string, string[]>> {
  if (!_filesPromise) {
    _filesPromise = fetchImpl('/fonts/manifest.json')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('manifest fetch failed'))))
      .then((m: { files?: Record<string, string[]> }) => m.files ?? {})
      .catch(() => ({}));
  }
  return _filesPromise;
}

function abToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Ensure the bundled TTF for `family`+`weight` is registered in `pdf` and return
 * its alias + faux-bold flag, or null when the family isn't bundled or the fetch
 * fails (the caller then leaves that text in the raster). `registered` dedupes
 * embeds across runs/pages. `fetchImpl` is injectable for tests.
 */
export async function loadVectorFont(
  pdf: PdfTextDoc,
  family: string,
  weight: number,
  registered: Set<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<BrowserFontPick | null> {
  const sel = selectFontFile(await fontFiles(fetchImpl), family, weight);
  if (!sel) return null;
  if (registered.has(sel.alias)) return { alias: sel.alias, fauxBold: sel.fauxBold };
  try {
    const res = await fetchImpl(`/fonts/${encodeURIComponent(sel.file)}`);
    if (!res.ok) return null;
    pdf.addFileToVFS(sel.file, abToBase64(await res.arrayBuffer()));
    pdf.addFont(sel.file, sel.alias, 'normal');
    registered.add(sel.alias);
    return { alias: sel.alias, fauxBold: sel.fauxBold };
  } catch {
    return null;
  }
}

/** Reset the cached manifest fetch (tests only). */
export function _resetFontManifestCache(): void {
  _filesPromise = null;
}
