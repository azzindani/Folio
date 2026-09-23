// asset_search's first stop: the asset pack that ships with Folio (library/).
//
// A pack hit is already in the shared library under lib/folio/…, its licence
// is known and redistributable, and using it costs no network call — so it is
// listed before anything the internet returns, and it still answers when the
// deployment has asset search switched off (FOLIO_ASSET_NET=off).
import { packDir, readPackManifest, packLibPath, type PackFile } from './library-pack';
import type { AssetCandidate, SearchWhat } from './asset-search';

/** The pack folders that can answer each `what`. */
const WHAT_DIRS: Partial<Record<SearchWhat, string[]>> = {
  sound: ['sfx/'], music: ['music/'], clip: ['clips/'],
  icon: ['svg/'], logo: ['svg/logos/'], illustration: ['svg/'],
};

const KIND_BY_EXT: Record<string, AssetCandidate['kind']> = {
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', mp4: 'video', webm: 'video', svg: 'images', png: 'images',
};

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);

/**
 * How well a pack file answers the query: a whole-word hit on its title, tags
 * or path counts double a substring hit ("whoosh" in "whooshes").
 */
export function packScore(f: PackFile, query: string): number {
  const hay = [f.title ?? '', ...(f.tags ?? []), f.path].join(' ').toLowerCase();
  const tokens = new Set(words(hay));
  return words(query).reduce((n, w) => n + (tokens.has(w) ? 2 : hay.includes(w) ? 1 : 0), 0);
}

function candidate(f: PackFile, libPath: string): AssetCandidate {
  const ext = f.path.split('.').pop() ?? '';
  const c: AssetCandidate = {
    ref: `pack:${f.path}`, source: 'folio-pack', kind: KIND_BY_EXT[ext] ?? 'images',
    title: f.title ?? libPath.split('/').pop() ?? f.path, filetype: ext, license: f.license,
    path: libPath,
    note: `Already in the library — use src:"${libPath}" directly, nothing to fetch.`,
  };
  if (f.duration_ms !== undefined) c.duration_ms = f.duration_ms;
  if (f.creator) c.creator = f.creator;
  if (f.page) c.page = f.page;
  return c;
}

/** Pack files matching the query for this `what`, best first (shorter first on a tie). */
export function searchPack(what: SearchWhat, query: string, limit: number): AssetCandidate[] {
  const dirs = WHAT_DIRS[what];
  const dir = dirs ? packDir() : null;
  const manifest = dir ? readPackManifest(dir) : null;
  if (!dirs || !manifest) return [];
  return manifest.files
    .filter(f => dirs.some(d => f.path.startsWith(d)))
    .map(f => ({ f, lib: packLibPath(f.path), score: packScore(f, query) }))
    .filter((s): s is { f: PackFile; lib: string; score: number } => s.lib !== null && s.score > 0)
    .sort((a, b) => b.score - a.score || (a.f.duration_ms ?? 0) - (b.f.duration_ms ?? 0))
    .slice(0, limit)
    .map(s => candidate(s.f, s.lib));
}
