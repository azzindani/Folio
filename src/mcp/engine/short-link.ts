// Short, opaque editor links — /o/<code> → 302 to the full tokenized editor URL.
//
// A vision-less small model cannot faithfully relay a ~300-char editor URL with
// an embedded JWT: it truncates, re-encodes (%2F→/, %3A%2F%2F→://), wraps it in
// markdown that leaves a trailing `]`, and emits several conflicting copies (the
// observed "wrong link" failure on a 30B model). This maps a short, STABLE code
// → the design path, so the model only copies ~10 characters and the server
// mints the auth token on the redirect (no secret in the string it handles).
//
// Side-effect-free (fs + path + a pure hash only) so the editor static-server
// can import resolveShortLink() without pulling in MCP/OAuth module side effects.
import * as fs from 'fs';
import * as path from 'path';

export interface ShortTarget { path: string; page?: number; }

function storeFile(): string {
  return path.join(process.env['FOLIO_PROJECTS_DIR'] ?? '/home/folio/projects', '.short-links.json');
}

/**
 * 53-bit deterministic hash (cyrb53) → base36. Same path ⇒ same code, so a
 * re-seal reuses one stable link and the store never grows past #designs. No
 * randomness (would break determinism + is banned in the render path anyway).
 */
export function shortCode(input: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(36).padStart(10, '0').slice(0, 11);
}

function readStore(): Record<string, ShortTarget> {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(), 'utf-8')) as Record<string, ShortTarget>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

/** Register (or refresh) a short code for a design path. Idempotent per path. */
export function registerShortLink(designPath: string, page?: number): string {
  const code = shortCode(designPath);
  const store = readStore();
  const next: ShortTarget = page === undefined ? { path: designPath } : { path: designPath, page };
  const cur = store[code];
  // Skip the write when nothing changed — no needless fs churn on re-seal.
  if (!cur || cur.path !== next.path || cur.page !== next.page) {
    store[code] = next;
    try {
      fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
      fs.writeFileSync(storeFile(), JSON.stringify(store));
    } catch { /* best-effort: the long open_url still works if this write fails */ }
  }
  return code;
}

/**
 * Resolve a short code → its target, or null. Tolerates a trailing `]` / ``` ` ```
 * a small model may glue on when wrapping the link in markdown. Read-only.
 */
export function resolveShortLink(code: string): ShortTarget | null {
  const clean = code.replace(/[^A-Za-z0-9_-].*$/, '');
  if (!clean) return null;
  const t = readStore()[clean];
  return t && typeof t.path === 'string' ? t : null;
}
