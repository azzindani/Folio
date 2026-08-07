// Platform-correct shortcut labels.
//
// Every hint in the editor was written with Mac glyphs — "⌘K", "⌘⇧L", "⌥+drag"
// — and shown to everyone. On Windows and Linux, which is most people, the key
// named does not exist on the keyboard. The KEY HANDLING was always correct
// (it accepts ctrl or meta); only the labels lied.
//
// Kept tiny and dependency-free: it is imported by the toolbar, the context
// menu, the properties panel and the mobile panel titles.

/** Mac if the UA says so. Falls back to "not Mac", which is the safer guess. */
function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/i.test(ua);
}

let cached: boolean | null = null;
function mac(): boolean {
  if (cached === null) cached = isMac();
  return cached;
}

/** Test seam — the platform is read once and cached. */
export function resetPlatformCache(): void { cached = null; }

/** The primary modifier: ⌘ on Mac, Ctrl elsewhere. */
export function modKey(): string { return mac() ? '⌘' : 'Ctrl'; }
/** Alt/Option. */
export function altKey(): string { return mac() ? '⌥' : 'Alt'; }
/** Shift — ⇧ reads fine on Mac, spelled out elsewhere. */
export function shiftKey(): string { return mac() ? '⇧' : 'Shift'; }

/**
 * Rewrite a Mac-glyph shortcut string for the current platform.
 *
 *   sc('⌘⇧L')  → "⌘⇧L"        on Mac
 *              → "Ctrl+Shift+L" elsewhere
 *
 * Mac keeps the glyphs run together, which is the platform convention;
 * everywhere else the parts are joined with "+", which is theirs.
 */
export function sc(macForm: string): string {
  if (mac()) return macForm;
  const parts: string[] = [];
  let rest = macForm;
  // Order matters for the output: Ctrl+Alt+Shift+Key is the conventional one.
  if (rest.includes('⌘')) { parts.push('Ctrl'); rest = rest.replace(/⌘/g, ''); }
  if (rest.includes('⌥')) { parts.push('Alt'); rest = rest.replace(/⌥/g, ''); }
  if (rest.includes('⇧')) { parts.push('Shift'); rest = rest.replace(/⇧/g, ''); }
  rest = rest.trim();
  if (rest) parts.push(rest);
  return parts.join('+');
}
