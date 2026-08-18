// Asset store — folder and path rules.
//
// Shared by the project store, the editor's file manager and the MCP asset
// ops, so there is exactly ONE definition of what a folder name may be and how
// a stored path is read back. Split from assets.ts to keep that file inside the
// 700-line budget; assets.ts re-exports these, so importers need not care.
import type { AssetKind } from './assets';

/** How deep a folder path may go. Matches the shared library's own limit. */
export const MAX_PROJECT_FOLDER_DEPTH = 4;

/** One path segment, sanitized. '' when nothing usable survives. */
function cleanFolderSegment(seg: string): string {
  const s = String(seg ?? '').trim();
  if (!s || s === '.' || s === '..') return '';
  const clean = s.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase().slice(0, 40);
  return clean === '.' || clean === '..' ? '' : clean;
}

/**
 * A user folder inside a kind dir: `assets/images/clients/acme/logo.png`.
 *
 * Nests, up to MAX_PROJECT_FOLDER_DEPTH. It used to keep only the FIRST segment,
 * which made the editor's file manager behave at random — "New folder" worked at
 * the root and silently filed the folder somewhere else from anywhere deeper,
 * because there was nowhere deeper to put it. A store you cannot make a folder
 * inside is not one anybody can organise.
 *
 * Traversal is handled by rebuilding the path from cleaned segments rather than
 * by inspecting the input: ".." cannot survive cleanFolderSegment, so no ".."
 * can reach the filesystem regardless of how it was spelled or encoded.
 * Returns '' for "no folder" — never null, so callers can always join it.
 */
export function sanitizeFolder(folder?: string): string {
  return String(folder ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(cleanFolderSegment)
    .filter(Boolean)
    .slice(0, MAX_PROJECT_FOLDER_DEPTH)
    .join('/');
}

/** Split a project-relative asset path into its parts, or null if malformed. */
export function parseAssetPath(rel: string): { kind: AssetKind; folder: string; name: string } | null {
  const m = String(rel ?? '').replace(/^\/+/, '').match(/^assets\/(images|icons|fonts|docs)\/(.+)$/);
  if (!m) return null;
  const parts = (m[2] ?? '').split('/');
  const name = parts.pop() ?? '';
  if (!name) return null;
  const raw = parts.join('/');
  const folder = sanitizeFolder(raw);
  // A path whose folder does not survive sanitising is not one this store can
  // have produced — refuse it rather than silently rewriting where it points.
  if (raw !== folder) return null;
  return { kind: m[1] as AssetKind, folder, name };
}
