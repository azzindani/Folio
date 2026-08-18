// Asset explorer — shared types, formatting, and the page assembly.
//
// The rendering itself lives in two siblings: `asset-explorer-chrome.ts` (the
// frame — command bar, navigation, tree, status) and `asset-explorer-list.ts`
// (the file pane, in every view mode). This file holds what both agree on.
import type { AssetRow, ProjectRow, Scope } from './asset-explorer-io';
import { commandBar, navRow, tree, status } from './asset-explorer-chrome';
import { columnHeader, pane } from './asset-explorer-list';

/** A folder or a file, as the pane lists them — folders first, like Explorer. */
export type Entry =
  | { type: 'folder'; name: string; folder: string; count: number }
  | { type: 'file'; asset: AssetRow };

/** Explorer's view modes. Each answers a different question — see the comment
 *  at the top of asset-explorer-list.ts. */
export type ViewMode = 'xl' | 'large' | 'medium' | 'tiles' | 'list' | 'details';

export const VIEW_MODES: Array<{ id: ViewMode; label: string; icon: string }> = [
  { id: 'xl', label: 'Extra large icons', icon: 'square' },
  { id: 'large', label: 'Large icons', icon: 'image' },
  { id: 'medium', label: 'Medium icons', icon: 'component' },
  { id: 'tiles', label: 'Tiles', icon: 'table' },
  { id: 'list', label: 'List', icon: 'list' },
  { id: 'details', label: 'Details', icon: 'sliders' },
];

export type SortKey = 'name' | 'size' | 'type' | 'added';

export interface ViewState {
  project: string | null;
  projects: ProjectRow[];
  scope: Scope;
  folder: string;
  entries: Entry[];
  /** Folder paths in each store — the tree renders both branches itself. */
  folders: string[];
  libraryFolders: string[];
  selected: Set<string>;
  selectedFiles: number;
  selectedFolders: number;
  view: ViewMode;
  sort: SortKey;
  desc: boolean;
  query: string;
  totalProject: number;
  totalShared: number;
  /** Filling the window rather than the sidebar — the tree needs the room. */
  full: boolean;
  /** "3 items cut" — shown in the status bar while a clipboard is held. */
  clip: string;
  canPaste: boolean;
  canBack: boolean;
}

export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

/** Human file size. Explorer shows KB for everything small; so do we. */
export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** The extension, uppercased — the "Type" column, as a file manager shows it. */
export function fmtType(a: AssetRow): string {
  const ext = (a.path.split('.').pop() ?? '').toUpperCase();
  return ext.length <= 5 ? ext : a.kind.toUpperCase();
}

export function entryKey(e: Entry): string {
  return e.type === 'folder' ? `folder:${e.folder}` : e.asset.path;
}

/** The whole panel. One string so a re-render is a single DOM write. */
export function shell(s: ViewState, urlOf: (a: AssetRow) => string): string {
  return `
    <div class="ax">
      ${navRow(s)}
      ${commandBar(s)}
      <div class="ax-main">
        ${tree(s)}
        <div class="ax-files">
          ${columnHeader(s)}
          ${pane(s, urlOf)}
        </div>
      </div>
      ${status(s)}
      <input type="file" multiple class="ax-file" hidden>
      <div class="ax-drop" hidden><div class="ax-drop-in">Drop to upload into <b>${esc(s.folder || (s.scope === 'library' ? 'the shared library' : 'the project root'))}</b></div></div>
    </div>`;
}

export { columnHeader, pane } from './asset-explorer-list';
export { commandBar, navRow, tree, status, wireDropOverlay } from './asset-explorer-chrome';
