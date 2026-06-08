/**
 * Self-contained web fonts for SVG export.
 *
 * The editor renders with web fonts loaded into the live document, but
 * exportToPNG serializes the SVG and rasterizes it through `<img>`→canvas —
 * an isolated context that CANNOT see the page's fonts and cannot fetch
 * external resources, so every web font silently falls back to a serif. The
 * fix is to make the SVG carry its fonts: fetch the woff2 for the families it
 * uses and inline them as `@font-face { src: url(data:…) }`. Inline data URIs
 * are the one font source the `<img>` rasterizer honours, so PNG/PDF (and a
 * standalone .svg opened anywhere) then match the editor.
 */

const GENERIC = new Set([
  'sans-serif', 'serif', 'monospace', 'system-ui', 'ui-monospace', 'ui-sans-serif',
  'ui-serif', 'cursive', 'fantasy', 'inherit', 'initial', 'monospace,monospace',
]);

/** family → set of font-weights, gathered from a rendered SVG's text layers. */
export function collectUsedFonts(svg: Element): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const add = (famRaw: string | null, weightRaw: string | null): void => {
    if (!famRaw) return;
    const fam = famRaw.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (!fam || GENERIC.has(fam.toLowerCase())) return;
    const w = Number.parseInt(weightRaw ?? '', 10);
    const weight = Number.isFinite(w) && w > 0 ? w : 400;
    if (!out.has(fam)) out.set(fam, new Set());
    out.get(fam)!.add(weight);
  };
  const nodes = [svg, ...Array.from(svg.querySelectorAll('*'))];
  for (const el of nodes) {
    add(el.getAttribute('font-family'), el.getAttribute('font-weight'));
    const style = el.getAttribute('style');
    if (style) {
      const fam = /font-family:\s*([^;]+)/i.exec(style)?.[1] ?? null;
      const wt = /font-weight:\s*([^;]+)/i.exec(style)?.[1] ?? null;
      add(fam, wt);
    }
  }
  return out;
}

/** Build the Google Fonts css2 URL for the collected families + weights. */
export function fontCssUrl(fonts: Map<string, Set<number>>): string | null {
  if (fonts.size === 0) return null;
  const fam = [...fonts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([f, ws]) => {
      const weights = [...ws].sort((a, b) => a - b);
      return `family=${f.replace(/ /g, '+')}:wght@${weights.join(';')}`;
    })
    .join('&');
  return `https://fonts.googleapis.com/css2?${fam}&display=swap`;
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
 * Returns a `<style>` element string with every web font used in `svg`
 * inlined as a data-URI `@font-face`, or '' when there are no web fonts or
 * the fetch fails (export then degrades to fallback fonts rather than break).
 * `fetchImpl` is injectable for testing.
 */
export async function buildEmbeddedFontStyle(
  svg: Element,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = fontCssUrl(collectUsedFonts(svg));
  if (!url) return '';
  try {
    const cssRes = await fetchImpl(url, {
      // a modern UA makes googleapis return woff2 @font-face blocks
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' },
    });
    if (!cssRes.ok) return '';
    let css = await cssRes.text();
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+\.woff2?)\)/g)].map(m => m[1]))];
    for (const fontUrl of urls) {
      const res = await fetchImpl(fontUrl);
      if (!res.ok) continue;
      const b64 = abToBase64(await res.arrayBuffer());
      const mime = fontUrl.endsWith('.woff2') ? 'font/woff2' : 'font/woff';
      css = css.split(`url(${fontUrl})`).join(`url(data:${mime};base64,${b64})`);
    }
    return `<style type="text/css">${css}</style>`;
  } catch {
    return '';
  }
}
