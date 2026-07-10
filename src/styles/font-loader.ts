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

// ── Design fonts ──────────────────────────────────────────────
// The type-pack loader above only covers families a THEME declares. A design's
// layers can name any family (a mood picks e.g. Orbitron / Bricolage Grotesque),
// which would fall back to a generic in the live editor while rendering correctly
// in raster export (those are bundled for resvg). Load a design's own families on
// open so the editor matches the export. Accumulates across designs (unlike the
// one-shot type-pack guard) and injects ONE link PER family so a single bogus
// name (a model hallucination) can't 400 the whole batch.
const loadedDesignFamilies = new Set<string>();
const GENERIC_FONT = new Set([
  'sans-serif', 'serif', 'monospace', 'system-ui', 'ui-monospace', 'ui-sans-serif',
  'ui-serif', 'cursive', 'fantasy', 'inherit', 'dejavu sans',
]);

export function ensureDesignFonts(families: string[]): void {
  if (typeof document === 'undefined') return;
  for (const raw of families) {
    const fam = (raw ?? '').trim().replace(/^['"]|['"]$/g, '');
    const key = fam.toLowerCase();
    // $heading/$body/$mono are theme tokens (loaded via type-packs/static link).
    if (!fam || fam.startsWith('$') || GENERIC_FONT.has(key) || loadedDesignFamilies.has(key)) continue;
    loadedDesignFamilies.add(key);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${fam.replace(/ /g, '+')}:wght@400;500;700;800&display=swap`;
    link.setAttribute('data-folio-fonts', 'design');
    document.head.appendChild(link);
  }
}

// ── Project fonts (WP-1.6) ────────────────────────────────────
// TTF/OTF the operator uploaded to <project>/assets/fonts. These aren't on
// Google Fonts, so the <link> path above can't reach them — register each with
// the FontFace API pointed at the authed project-files mount, so the editor
// renders the operator's own typeface (matching resvg raster + vector PDF,
// which read the same files server-side). Idempotent per family+weight; a fetch
// failure on one file leaves the rest intact.
const loadedProjectFonts = new Set<string>();

/** Font asset rows (path under assets/fonts) + a resolver to their fetch URL. */
export function loadProjectFonts(
  fonts: Array<{ path: string }>,
  urlFor: (path: string) => string,
): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  void import('../utils/font-name').then(({ fontFamilyFromFilename, fontWeightFromFilename, isFontFile }) => {
    for (const f of fonts) {
      const file = f.path.split('/').pop() ?? '';
      if (!isFontFile(file)) continue;
      const family = fontFamilyFromFilename(file);
      const weight = fontWeightFromFilename(file);
      if (!family) continue;
      const key = `${family}::${weight}`;
      if (loadedProjectFonts.has(key)) continue;
      loadedProjectFonts.add(key);
      try {
        const face = new FontFace(family, `url("${urlFor(f.path)}")`, { weight, display: 'swap' });
        void face.load().then(loaded => { (document as unknown as { fonts: FontFaceSet }).fonts.add(loaded); }).catch(() => { loadedProjectFonts.delete(key); });
      } catch { loadedProjectFonts.delete(key); }
    }
  }).catch(() => { /* module load failed — leave editor on fallback fonts */ });
}

/** Test hook — reset the injection guard so a re-mount can re-inject. */
export function _resetFontLoader(): void {
  injected = false;
  loadedDesignFamilies.clear();
  loadedProjectFonts.clear();
  document.head.querySelectorAll('[data-folio-fonts="type-packs"],[data-folio-fonts="design"]').forEach(el => el.remove());
}
