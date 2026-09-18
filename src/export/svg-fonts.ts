// The fonts an exported page actually USES, read from its rendered markup.
//
// The interactive report loaded web fonts only for rich_text layers and the
// report's own heading/body fonts. Every ordinary text layer is drawn into an
// SVG carrying `font-family="Space Grotesk, …"`, and nothing loaded that family
// — so the exported HTML, and the editor's Preview (the same code path), set a
// carousel's headlines in the browser's default serif. The canvas, the PNG and
// the PDF all had the right face; only the HTML did not.

const GENERIC = new Set([
  'sans-serif', 'serif', 'monospace', 'system-ui', 'ui-monospace', 'ui-sans-serif',
  'ui-serif', 'cursive', 'fantasy', 'inherit', 'initial', '-apple-system',
  'blinkmacsystemfont', 'segoe ui', 'helvetica', 'helvetica neue', 'arial', 'georgia',
  'times', 'times new roman', 'courier', 'courier new', 'menlo', 'monaco', 'consolas',
  'dejavu sans',
]);

/** Add every named (non-generic, non-system) family the markup uses to `into`. */
export function collectSvgFonts(markup: string, into: Set<string>): void {
  const stacks = [
    ...markup.matchAll(/font-family="([^"]+)"/g),
    ...markup.matchAll(/font-family='([^']+)'/g),
    ...markup.matchAll(/font-family:\s*([^;"}]+)/g),
  ].map(m => m[1] ?? '');
  for (const stack of stacks) {
    // A custom-property stack is the report's own heading/body font, which the
    // assembler already loads from the report settings; its fallbacks are
    // generics, and splitting it on commas yields "system-ui)" and friends.
    if (stack.includes('var(')) continue;
    for (const raw of stack.split(',')) {
      const fam = raw.trim().replace(/^(&quot;|&#39;|['"])|(&quot;|&#39;|['"])$/g, '').trim();
      if (!fam || fam.startsWith('var(') || fam.startsWith('$')) continue;
      if (GENERIC.has(fam.toLowerCase())) continue;
      into.add(fam);
    }
  }
}

/**
 * One stylesheet link PER family, not one combined URL: a single name Google
 * does not serve (a project's own TTF, a model's invention) makes a combined
 * request 400, and then no family loads at all. The editor's loader learned
 * the same lesson (font-loader.ts, ensureDesignFonts).
 */
export function googleFontLinks(families: Iterable<string>): string {
  const list = [...new Set(families)].sort();
  if (list.length === 0) return '';
  const links = list.map(f =>
    `<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700;900&display=swap" rel="stylesheet">`);
  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    ...links,
  ].join('\n');
}
