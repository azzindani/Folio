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
import { editorSessionTtlMs } from '../jwt';

/** Stored entry. `exp` (epoch ms) makes a short link SELF-EXPIRE — without it the
 *  /o/<code> route was a permanent door that re-minted a fresh session on every
 *  visit, the one way to revive access without going through the (cookie-gated)
 *  Library. With it, a leaked/shown short link dies on the same clock as the
 *  editor session; only the owner re-issuing the link refreshes it. */
export interface ShortTarget { path: string; page?: number; exp?: number; }

function storeFile(): string {
  return path.join(process.env['FOLIO_PROJECTS_DIR'] ?? '/home/folio/projects', '.short-links.json');
}

/** Short-link lifetime (ms). Defaults to the editor session window (30 min) so a
 *  shown /o/<code> dies on the same clock as the link it 302s to; override with
 *  FOLIO_SHORT_LINK_TTL_MS. */
function shortLinkTtlMs(): number {
  const env = parseInt(process.env['FOLIO_SHORT_LINK_TTL_MS'] ?? '', 10);
  return Number.isFinite(env) && env > 0 ? env : editorSessionTtlMs();
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

/** Register (or refresh) a short code for a design path. Idempotent per path, and
 *  REFRESHES the expiry window — this is the only way a short link comes back to
 *  life, and it requires an owner action (a tool call / opening from the Library),
 *  never a leaked code resolving itself. */
export function registerShortLink(designPath: string, page?: number, now: number = Date.now()): string {
  const code = shortCode(designPath);
  const store = readStore();
  const ttl = shortLinkTtlMs();
  const exp = now + ttl;
  const next: ShortTarget = page === undefined ? { path: designPath, exp } : { path: designPath, page, exp };
  const cur = store[code];
  // Write when missing, changed, or past half-life — refreshes the window on
  // re-issue while avoiding fs churn on a rapid re-seal within the window.
  const stale = !cur || cur.path !== next.path || cur.page !== next.page || (cur.exp ?? 0) - now < ttl / 2;
  if (stale) {
    store[code] = next;
    try {
      fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
      fs.writeFileSync(storeFile(), JSON.stringify(store));
    } catch { /* best-effort: the long open_url still works if this write fails */ }
  }
  return code;
}

/**
 * Resolve a short code → its target, or null (unknown OR EXPIRED). Tolerates a
 * trailing `]` / ``` ` ``` a small model may glue on when wrapping the link in
 * markdown. Read-only — resolving never extends the window (a leaked code can't
 * keep itself alive). A legacy entry with no `exp` is treated as expired so the
 * permanent-door behaviour is closed the moment this ships.
 */
export function resolveShortLink(code: string, now: number = Date.now()): ShortTarget | null {
  const clean = code.replace(/[^A-Za-z0-9_-].*$/, '');
  if (!clean) return null;
  const t = readStore()[clean];
  if (!t || typeof t.path !== 'string') return null;
  if (typeof t.exp !== 'number' || now >= t.exp) return null;   // expired / legacy
  return t.page === undefined ? { path: t.path } : { path: t.path, page: t.page };
}
