/**
 * Runtime Google Fonts loader for type-pack families.
 *
 * The static <link> in index.html only covers the families used by the
 * 14 built-in themes. Type-packs declare many more (Cormorant, Limelight,
 * Stardos Stencil, Press Start 2P, …); preloading all of them at boot
 * would bloat the network waterfall before the user even opens the
 * catalog. Instead we inject one extra <link> on first catalog open with
 * exactly the families the index reports — same hashing, same caching.
 */

let injected = false;

/**
 * Returns a Google Fonts URL for the given family list, or null when the
 * list is empty / no fresh families were added.
 */
function buildHref(families: string[]): string | null {
  if (families.length === 0) return null;
  // De-dup and stable-sort so the URL is cacheable across reloads.
  const dedup = [...new Set(families.map(f => f.trim()).filter(Boolean))].sort();
  if (dedup.length === 0) return null;
  // Weights — generous enough for headings + body without bloating the
  // download. Mono fonts get 400/700 only; display/script fonts use the
  // default single weight implied by family-only syntax.
  const families_encoded = dedup
    .map(name => `family=${name.replace(/ /g, '+')}:wght@400;500;700;800`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${families_encoded}&display=swap`;
}

/**
 * Inject the runtime stylesheet exactly once per session. Subsequent
 * calls are no-ops so this is safe to call from every catalog-open path.
 */
export function ensureTypePackFonts(families: string[]): void {
  if (injected) return;
  if (typeof document === 'undefined') return;
  const href = buildHref(families);
  if (!href) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-folio-fonts', 'type-packs');
  document.head.appendChild(link);
  injected = true;
}

/** Test hook — reset the injection guard so a re-mount can re-inject. */
export function _resetFontLoader(): void {
  injected = false;
  document.head.querySelectorAll('[data-folio-fonts="type-packs"]').forEach(el => el.remove());
}
