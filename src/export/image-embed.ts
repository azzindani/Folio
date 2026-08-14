/**
 * Inline externally-referenced `<image>` hrefs in a rendered SVG as data: URIs.
 *
 * WHY THIS EXISTS — export rasterizes by serializing the SVG into a Blob and
 * loading it through `new Image()`. A browser renders SVG-inside-`<img>` in
 * RESTRICTED mode: it refuses to load ANY external reference, even a
 * same-origin one that fetches fine from the page itself. Measured on the live
 * editor, same asset, same browser:
 *
 *     <image href="/__project_files/…/outlook.svg">   → 0 painted pixels
 *     <image href="data:image/svg+xml;base64,…">      → 8136 painted pixels
 *
 * So the editor canvas showed every logo while the exported PNG/PDF/SVG showed
 * none. Web fonts already get exactly this treatment (font-embed.ts) for the
 * same reason; images were missed.
 *
 * Both `href` and `xlink:href` are rewritten: image FILLS render as an
 * `<image>` inside a `<pattern>` carrying both attributes (fill-renderer.ts).
 */

/** Already renderable inside a restricted `<img>` — nothing to fetch. */
const INLINE_HREF = /^(data:|blob:|#)/i;

const XLINK_NS = 'http://www.w3.org/1999/xlink';

function hrefOf(el: Element): string {
  return el.getAttribute('href') ?? el.getAttributeNS(XLINK_NS, 'href') ?? '';
}

function setHref(el: Element, value: string): void {
  if (el.hasAttribute('href')) el.setAttribute('href', value);
  if (el.getAttributeNS(XLINK_NS, 'href') !== null) el.setAttributeNS(XLINK_NS, 'href', value);
  // A pattern fill sets both; a plain image layer may set only one. Guarantee
  // at least `href` so the rewrite can never silently no-op.
  if (!el.hasAttribute('href') && el.getAttributeNS(XLINK_NS, 'href') === null) {
    el.setAttribute('href', value);
  }
}

function blobToDataUri(blob: Blob): Promise<string | null> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = (): void => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetch one URL as a data: URI. Same-origin credentials are the default, so the
 * editor's auth cookie rides along to /__project_files/*. Returns null on any
 * failure — a missing asset must not abort the whole export.
 */
async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    return await blobToDataUri(blob);
  } catch {
    return null;
  }
}

/**
 * Rewrite every external `<image>` href in `svg` to a data: URI, in place.
 * Returns the number of hrefs successfully inlined.
 *
 * Each distinct URL is fetched ONCE however many layers reference it — a logo
 * repeated across eight carousel pages costs one request, not eight.
 */
export async function inlineExternalImages(svg: Element): Promise<number> {
  const images = [...svg.querySelectorAll('image')];
  if (!images.length) return 0;

  const pending = new Map<string, Promise<string | null>>();
  const targets: Array<{ el: Element; url: string }> = [];

  for (const el of images) {
    const url = hrefOf(el).trim();
    if (!url || INLINE_HREF.test(url)) continue;
    targets.push({ el, url });
    if (!pending.has(url)) pending.set(url, fetchAsDataUri(url));
  }
  if (!targets.length) return 0;

  const resolved = new Map<string, string | null>();
  await Promise.all([...pending].map(async ([url, p]) => { resolved.set(url, await p); }));

  let inlined = 0;
  for (const { el, url } of targets) {
    const dataUri = resolved.get(url);
    if (!dataUri) continue;                 // leave the href; it renders as a gap, not a crash
    setHref(el, dataUri);
    inlined++;
  }
  return inlined;
}
