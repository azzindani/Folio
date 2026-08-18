// Asset explorer — deriving what the file pane shows.
//
// Pure functions over the listing: which folders are children of the one in
// view, how many things each holds, what a search turns up, and the sort. No
// DOM and no panel state, so the same rules hold wherever the explorer is
// mounted — the editor's panel and the Design Library's drawer both call these.
import { storeOf, type AssetRow, type Scope } from './asset-explorer-io';
import { fmtType, type Entry, type SortKey } from './asset-explorer-view';
import { parentOf } from './asset-explorer-folders';

/** Everything the derivation needs, and nothing else. */
export interface EntrySource {
  rows: AssetRow[];
  scope: Scope;
  /** The folder in view — '' is the store root. */
  folder: string;
  query: string;
  /** Folder paths in the store being looked at. Both stores nest. */
  folders: string[];
  sort: SortKey;
  desc: boolean;
}

/** Direct children of a folder — what a file manager shows in its size column. */
export function countIn(src: EntrySource, folder: string): number {
  const files = src.rows.filter(r => storeOf(r) === src.scope && (r.folder ?? '') === folder).length;
  return files + src.folders.filter(f => parentOf(f) === folder).length;
}

export function subfolders(src: EntrySource): Entry[] {
  const here = src.folder;
  return src.folders
    .filter(f => parentOf(f) === here)
    .map(full => ({
      type: 'folder' as const,
      name: full.slice(here ? here.length + 1 : 0),
      folder: full,
      count: countIn(src, full),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function sortFiles(src: EntrySource, entries: Entry[]): Entry[] {
  const dir = src.desc ? -1 : 1;
  const val = (e: Entry): string | number => {
    if (e.type !== 'file') return '';
    const a = e.asset;
    if (src.sort === 'size') return a.bytes;
    if (src.sort === 'type') return fmtType(a);
    if (src.sort === 'added') return a.added ?? '';
    return (a.path.split('/').pop() ?? a.path).toLowerCase();
  };
  return entries.sort((a, b) => {
    const x = val(a), y = val(b);
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y)) * dir;
  });
}

/** Search spans BOTH stores and every folder — a file manager's search box is
 *  how you find something when you have forgotten where you put it. */
function searchEntries(src: EntrySource): Entry[] {
  const q = src.query.trim().toLowerCase();
  return sortFiles(src, src.rows
    .filter(r => r.path.toLowerCase().includes(q) || (r.alt ?? '').toLowerCase().includes(q))
    .map(a => ({ type: 'file', asset: a } as Entry)));
}

/** What the pane lists: folders first, then files. */
export function entriesFor(src: EntrySource): Entry[] {
  if (src.query.trim()) return searchEntries(src);
  const files = src.rows
    .filter(r => storeOf(r) === src.scope && (r.folder ?? '') === src.folder)
    .map(a => ({ type: 'file', asset: a } as Entry));
  return [...subfolders(src), ...sortFiles(src, files)];
}

/** Where a new folder or upload goes: inside whatever is open. */
export function childPath(folder: string, name: string): string {
  const clean = name.trim().replace(/^\/+|\/+$/g, '');
  return folder ? `${folder}/${clean}` : clean;
}
