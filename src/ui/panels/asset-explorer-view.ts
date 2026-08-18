// Asset explorer — HTML builders.
//
// Pure functions: state in, markup out. Nothing here touches the network or
// the document, which keeps the interaction file readable and lets the layout
// be unit-tested without a server.
//
// The shape is a file manager on purpose — tree, breadcrumb, sortable columns,
// status bar. An author arriving with a folder of screenshots already knows how
// this works; the previous chip-and-tile drawer made them learn something new.
import { chromeIcon } from '../../editor/chrome-icons';
import type { AssetRow, ProjectRow, Scope } from './asset-explorer-io';

/** A folder or a file, as the pane lists them — folders first, like Explorer. */
export type Entry =
  | { type: 'folder'; name: string; folder: string; count: number }
  | { type: 'file'; asset: AssetRow };

export type ViewMode = 'details' | 'icons';
export type SortKey = 'name' | 'size' | 'type' | 'added';

export interface TreeNode {
  label: string;
  scope: Scope;
  folder: string;
  depth: number;
  root?: boolean;
}

export interface ViewState {
  project: string | null;
  projects: ProjectRow[];
  scope: Scope;
  folder: string;
  entries: Entry[];
  tree: TreeNode[];
  selected: Set<string>;
  view: ViewMode;
  sort: SortKey;
  desc: boolean;
  query: string;
  totalProject: number;
  totalShared: number;
  /** Filling the window rather than the sidebar — the tree needs the room. */
  full: boolean;
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

// ── Chrome ────────────────────────────────────────────────────────

export function toolbar(s: ViewState): string {
  const picker = s.projects.length
    ? `<select class="ax-project" title="Project" aria-label="Project">${
      s.projects.map(p => `<option value="${esc(p.name)}"${p.name === s.project ? ' selected' : ''}>${esc(p.name)} (${p.assets})</option>`).join('')
    }</select>`
    : `<span class="ax-project-name">${esc(s.project ?? '')}</span>`;
  return `
    <div class="ax-top">
      ${picker}
      <button class="ax-btn ax-primary" data-act="upload" title="Upload files (or drop them here)">${chromeIcon('upload', 14)} Upload</button>
      <button class="ax-btn" data-act="newfolder" title="New folder">${chromeIcon('plus', 14)} Folder</button>
      <button class="ax-btn" data-act="write" title="Write a text or markdown file">${chromeIcon('pen', 14)} Write</button>
      <span class="ax-gap"></span>
      <button class="ax-btn ax-sq" data-act="view" title="${s.view === 'details' ? 'Icons view' : 'Details view'}">${chromeIcon(s.view === 'details' ? 'component' : 'list', 15)}</button>
      <button class="ax-btn ax-sq" data-act="full" title="${s.full ? 'Back to the panel (Esc)' : 'Open full window'}">${chromeIcon(s.full ? 'shrink' : 'expand', 15)}</button>
      <button class="ax-btn ax-sq" data-act="refresh" title="Refresh">${chromeIcon('refresh', 15)}</button>
    </div>`;
}

/** Breadcrumb + search. The crumbs are the navigation history a tree cannot
 *  show when the tree pane is folded away on a narrow panel. */
export function crumbs(s: ViewState): string {
  const rootLabel = s.scope === 'library' ? 'Shared library' : (s.project ?? 'Project');
  const parts: string[] = [
    `<button class="ax-crumb" data-nav="${s.scope}:">${chromeIcon(s.scope === 'library' ? 'library' : 'layers', 12)} ${esc(rootLabel)}</button>`,
  ];
  if (s.folder) {
    const segs = s.folder.split('/');
    segs.forEach((seg, i) => {
      const upto = segs.slice(0, i + 1).join('/');
      parts.push(`<span class="ax-sep">›</span><button class="ax-crumb" data-nav="${s.scope}:${esc(upto)}">${esc(seg)}</button>`);
    });
  }
  return `
    <div class="ax-crumbs">
      <div class="ax-crumb-path">${parts.join('')}</div>
      <input class="ax-search" type="search" placeholder="Search all assets…" value="${esc(s.query)}" aria-label="Search assets">
    </div>`;
}

export function tree(s: ViewState): string {
  const nodes = s.tree.map(n => {
    const active = n.scope === s.scope && n.folder === s.folder && !s.query;
    const icon = n.root ? (n.scope === 'library' ? 'library' : 'layers') : 'folder';
    return `<button class="ax-node${active ? ' active' : ''}" data-nav="${n.scope}:${esc(n.folder)}" style="--d:${n.depth}" title="${esc(n.label)}">
      <span class="ax-node-i">${chromeIcon(icon, 13)}</span><span class="ax-node-l">${esc(n.label)}</span></button>`;
  }).join('');
  return `<nav class="ax-tree" aria-label="Folders">${nodes}</nav>`;
}

export function status(s: ViewState): string {
  const files = s.entries.filter(e => e.type === 'file').length;
  const folders = s.entries.length - files;
  const bytes = s.entries.reduce((n, e) => n + (e.type === 'file' ? e.asset.bytes : 0), 0);
  const bits = [
    `${folders ? `${folders} folder${folders === 1 ? '' : 's'}, ` : ''}${files} file${files === 1 ? '' : 's'}`,
    s.selected.size ? `${s.selected.size} selected` : '',
    files ? fmtBytes(bytes) : '',
  ].filter(Boolean);
  return `<div class="ax-status"><span>${bits.join(' · ')}</span><span class="ax-status-r">${s.totalProject} in project · ${s.totalShared} shared</span></div>`;
}

// ── The file pane ─────────────────────────────────────────────────

const COLUMNS: Array<{ key: SortKey; label: string; cls: string }> = [
  { key: 'name', label: 'Name', cls: 'c-name' },
  { key: 'size', label: 'Size', cls: 'c-size' },
  { key: 'type', label: 'Type', cls: 'c-type' },
  { key: 'added', label: 'Added', cls: 'c-date' },
];

export function columnHeader(s: ViewState): string {
  if (s.view !== 'details') return '';
  return `<div class="ax-head" role="row">${COLUMNS.map(c =>
    `<button class="ax-h ${c.cls}${s.sort === c.key ? ' sorted' : ''}" data-sort="${c.key}">${c.label}${
      s.sort === c.key ? `<span class="ax-arrow">${s.desc ? '▾' : '▴'}</span>` : ''}</button>`).join('')}</div>`;
}

function thumb(a: AssetRow, url: string): string {
  if (a.kind === 'docs') return `<span class="ax-ic ax-ic-doc">${chromeIcon('file', 17)}</span>`;
  // A font shows a type sample rather than an icon — which face it is matters
  // more than that it is a font, and the row already says FONT under Type.
  if (a.kind === 'fonts') return `<span class="ax-ic ax-ic-font">Aa</span>`;
  return `<img class="ax-ic" src="${esc(url)}" alt="" loading="lazy" draggable="false">`;
}

export function pane(s: ViewState, urlOf: (a: AssetRow) => string): string {
  if (!s.entries.length) {
    return `<div class="ax-list ${s.view}"><div class="ax-empty">${
      s.query ? 'Nothing matches that search.'
        : 'This folder is empty. Drop files here, or use Upload.'
    }</div></div>`;
  }
  const cells = s.entries.map((e, i) => (s.view === 'details' ? row(e, i, s, urlOf) : tile(e, i, s, urlOf))).join('');
  return `<div class="ax-list ${s.view}" role="listbox" aria-multiselectable="true">${cells}</div>`;
}

function row(e: Entry, i: number, s: ViewState, urlOf: (a: AssetRow) => string): string {
  const key = entryKey(e);
  const sel = s.selected.has(key) ? ' selected' : '';
  if (e.type === 'folder') {
    return `<div class="ax-row folder${sel}" data-idx="${i}" data-key="${esc(key)}" role="option" aria-selected="${sel ? 'true' : 'false'}" tabindex="-1">
      <span class="c-name"><span class="ax-ic ax-ic-folder">${chromeIcon('folder', 17)}</span><span class="ax-nm">${esc(e.name)}</span></span>
      <span class="c-size"></span><span class="c-type">Folder</span><span class="c-date">${e.count} item${e.count === 1 ? '' : 's'}</span>
    </div>`;
  }
  const a = e.asset;
  const loc = s.query ? `<span class="ax-loc">${esc(a.folder ?? (a.path.startsWith('lib/') ? 'shared' : 'root'))}</span>` : '';
  return `<div class="ax-row${sel}" data-idx="${i}" data-key="${esc(key)}" draggable="true" role="option" aria-selected="${sel ? 'true' : 'false'}" tabindex="-1" title="${esc(a.path)}">
    <span class="c-name">${thumb(a, urlOf(a))}<span class="ax-nm">${esc(a.path.split('/').pop() ?? a.path)}</span>${loc}</span>
    <span class="c-size">${fmtBytes(a.bytes)}</span>
    <span class="c-type">${esc(fmtType(a))}${a.width ? ` <span class="ax-dim">${a.width}×${a.height}</span>` : ''}</span>
    <span class="c-date">${esc(a.added ?? '')}</span>
  </div>`;
}

function tile(e: Entry, i: number, s: ViewState, urlOf: (a: AssetRow) => string): string {
  const key = entryKey(e);
  const sel = s.selected.has(key) ? ' selected' : '';
  if (e.type === 'folder') {
    return `<div class="ax-tile folder${sel}" data-idx="${i}" data-key="${esc(key)}" role="option" aria-selected="${sel ? 'true' : 'false'}" tabindex="-1">
      <span class="ax-tile-art ax-ic-folder">${chromeIcon('folder', 34)}</span><span class="ax-nm">${esc(e.name)}</span><span class="ax-sub">${e.count} item${e.count === 1 ? '' : 's'}</span>
    </div>`;
  }
  const a = e.asset;
  const art = a.kind === 'images' || a.kind === 'icons'
    ? `<img class="ax-tile-art" src="${esc(urlOf(a))}" alt="" loading="lazy" draggable="false">`
    : `<span class="ax-tile-art">${a.kind === 'fonts' ? 'Aa' : chromeIcon('file', 30)}</span>`;
  return `<div class="ax-tile${sel}" data-idx="${i}" data-key="${esc(key)}" draggable="true" role="option" aria-selected="${sel ? 'true' : 'false'}" tabindex="-1" title="${esc(a.path)}">
    ${art}<span class="ax-nm">${esc(a.path.split('/').pop() ?? a.path)}</span><span class="ax-sub">${fmtBytes(a.bytes)}${a.width ? ` · ${a.width}×${a.height}` : ''}</span>
  </div>`;
}

/** The whole panel. One string so a re-render is a single DOM write. */
export function shell(s: ViewState, urlOf: (a: AssetRow) => string): string {
  return `
    <div class="ax">
      ${toolbar(s)}
      ${crumbs(s)}
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
