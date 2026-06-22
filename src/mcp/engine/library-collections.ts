// Design Library — user-defined COLLECTIONS (e.g. "Real" vs "Test", or any name
// you like). A non-destructive overlay over the file store: a single manifest at
// <root>/.library/collections.json maps a design (by its path relative to the
// projects root) to a collection. Files never move, links never break, every
// change is reversible — it's pure metadata the gallery groups by.
//
// Unassigned designs fall back to a heuristic (test-ish project names → "Test",
// everything else → "Unsorted") so a fresh library shows a meaningful split with
// zero manual work; any explicit assignment overrides the guess.
//
// Pure fs + path only (no engine.ts / MCP side effects) so the editor's static
// server can import it to serve the write endpoint.

import * as fs from 'fs';
import * as path from 'path';

export interface CollectionsState {
  version: number;
  collections: string[];                 // user-curated names (tab order seed)
  assignments: Record<string, string>;   // relDesignPath → collection name
}

/** Collections every library starts with, so the tabs exist before you sort. */
export const DEFAULT_COLLECTIONS = ['Real', 'Test'] as const;
/** Virtual bucket for designs with no explicit assignment — never stored. */
export const UNSORTED = 'Unsorted';

function manifestPath(root: string): string {
  return path.join(root, '.library', 'collections.json');
}

/** A portable, stable key for a design: its path relative to the projects root. */
export function relKey(root: string, designPath: string): string {
  return path.relative(root, designPath).split(path.sep).join('/');
}

/** Heuristic home for an UNassigned design — keyed off its project name. */
export function isTestish(project: string): boolean {
  return /(^|[-_])(test|tests|suite|harness|probe|scratch|tmp|temp|demo|sample|eval|bench|lab|frontier)([-_]|$)/i.test(project)
    || project.toLowerCase().includes('test');
}

export function loadCollections(root: string): CollectionsState {
  const empty: CollectionsState = { version: 1, collections: [...DEFAULT_COLLECTIONS], assignments: {} };
  try {
    const raw = fs.readFileSync(manifestPath(root), 'utf8');
    const parsed = JSON.parse(raw) as Partial<CollectionsState>;
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      collections: Array.isArray(parsed.collections) && parsed.collections.length
        ? parsed.collections.filter((c): c is string => typeof c === 'string')
        : [...DEFAULT_COLLECTIONS],
      assignments: parsed.assignments && typeof parsed.assignments === 'object'
        ? Object.fromEntries(Object.entries(parsed.assignments).filter(([, v]) => typeof v === 'string')) as Record<string, string>
        : {},
    };
  } catch { return empty; }
}

export function saveCollections(root: string, state: CollectionsState): void {
  const dir = path.dirname(manifestPath(root));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(manifestPath(root), JSON.stringify(state, null, 2));
}

/** The collection a design currently belongs to (explicit assignment, else guess). */
export function effectiveCollection(relPath: string, project: string, state: CollectionsState): string {
  const explicit = state.assignments[relPath];
  if (explicit) return explicit;
  return isTestish(project) ? 'Test' : UNSORTED;
}

/** Full tab list: defaults ∪ curated ∪ every collection in use, then Unsorted. */
export function allCollections(state: CollectionsState): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...DEFAULT_COLLECTIONS, ...state.collections, ...Object.values(state.assignments)]) {
    if (c && c !== UNSORTED && !seen.has(c)) { seen.add(c); out.push(c); }
  }
  out.push(UNSORTED);
  return out;
}

/**
 * Assign a design to a collection (or clear it back to the heuristic default when
 * `collection` is empty or "Unsorted"). Persists and returns the new state.
 * A never-before-seen collection name is registered so its tab survives even if
 * you later move its last design out.
 */
export function assignDesign(root: string, relPath: string, collection: string): CollectionsState {
  const state = loadCollections(root);
  const name = collection.trim();
  if (!name || name === UNSORTED) {
    delete state.assignments[relPath];
  } else {
    state.assignments[relPath] = name;
    if (!state.collections.includes(name)) state.collections.push(name);
  }
  saveCollections(root, state);
  return state;
}
