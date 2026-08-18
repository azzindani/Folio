// Asset explorer — the file pane, in every view mode.
//
// The modes are Explorer's, because they answer different questions and people
// already know which one they want:
//
//   xl / large / medium  seeing the artwork — which logo is this?
//   tiles                artwork plus the facts, for picking between similar files
//   list                 the most names in the least space, for finding one
//   details              sortable columns, for comparing size / type / date
//
// Only `details` and `tiles` carry metadata. An icon grid deliberately does
// not: at that size the name is already competing with the thumbnail.
import { esc, fmtBytes, fmtType, entryKey, type Entry, type SortKey, type ViewState } from './asset-explorer-view';
import { chromeIcon } from '../../editor/chrome-icons';
import { isCut } from './asset-explorer-clipboard';
import type { AssetRow } from './asset-explorer-io';

const COLUMNS: Array<{ key: SortKey; label: string; cls: string }> = [
  { key: 'name', label: 'Name', cls: 'c-name' },
  { key: 'size', label: 'Size', cls: 'c-size' },
  { key: 'type', label: 'Type', cls: 'c-type' },
  { key: 'added', label: 'Added', cls: 'c-date' },
];

/** Sortable column headings. Only the details view has columns to sort by. */
export function columnHeader(s: ViewState): string {
  if (s.view !== 'details') return '';
  return `<div class="ax-head" role="row">${COLUMNS.map(c =>
    `<button class="ax-h ${c.cls}${s.sort === c.key ? ' sorted' : ''}" data-sort="${c.key}">${c.label}${
      s.sort === c.key ? `<span class="ax-arrow">${s.desc ? '▾' : '▴'}</span>` : ''}</button>`).join('')}</div>`;
}

function art(a: AssetRow, url: string, px: number): string {
  if (a.kind === 'docs') return `<span class="ax-art ax-art-doc">${chromeIcon('file', px)}</span>`;
  // A font shows a type sample rather than an icon — which face it is matters
  // more than that it is a font, and Type already says FONT.
  if (a.kind === 'fonts') return `<span class="ax-art ax-art-font">Aa</span>`;
  return `<img class="ax-art" src="${esc(url)}" alt="" loading="lazy" draggable="false">`;
}

function folderArt(px: number): string {
  return `<span class="ax-art ax-art-folder">${chromeIcon('folder', px)}</span>`;
}

/** Attributes every cell shares, whatever the view mode. */
function cellAttrs(e: Entry, i: number, s: ViewState): string {
  const key = entryKey(e);
  const sel = s.selected.has(key);
  const cut = e.type === 'file' && isCut(e.asset.path);
  const title = e.type === 'folder' ? e.folder : e.asset.path;
  return `data-idx="${i}" data-key="${esc(key)}" draggable="true" role="option" tabindex="-1"
    aria-selected="${sel ? 'true' : 'false'}" title="${esc(title)}"
    class="${e.type === 'folder' ? 'folder ' : ''}${sel ? 'selected ' : ''}${cut ? 'cut ' : ''}`;
}

const nameOf = (e: Entry): string =>
  e.type === 'folder' ? e.name : (e.asset.path.split('/').pop() ?? e.asset.path);

function detailsRow(e: Entry, i: number, s: ViewState, urlOf: (a: AssetRow) => string): string {
  const attrs = cellAttrs(e, i, s);
  if (e.type === 'folder') {
    return `<div ${attrs}ax-row">
      <span class="c-name">${folderArt(17)}<span class="ax-nm">${esc(e.name)}</span></span>
      <span class="c-size"></span><span class="c-type">Folder</span>
      <span class="c-date">${e.count} item${e.count === 1 ? '' : 's'}</span>
    </div>`;
  }
  const a = e.asset;
  const loc = s.query ? `<span class="ax-loc">${esc(a.folder ?? (a.path.startsWith('lib/') ? 'shared' : 'root'))}</span>` : '';
  return `<div ${attrs}ax-row">
    <span class="c-name">${art(a, urlOf(a), 17)}<span class="ax-nm">${esc(nameOf(e))}</span>${loc}</span>
    <span class="c-size">${fmtBytes(a.bytes)}</span>
    <span class="c-type">${esc(fmtType(a))}${a.width ? ` <span class="ax-dim">${a.width}×${a.height}</span>` : ''}</span>
    <span class="c-date">${esc(a.added ?? '')}</span>
  </div>`;
}

/** Compact name-only row. Explorer's List view flows these into columns. */
function listRow(e: Entry, i: number, s: ViewState, urlOf: (a: AssetRow) => string): string {
  const inner = e.type === 'folder' ? folderArt(15) : art(e.asset, urlOf(e.asset), 15);
  return `<div ${cellAttrs(e, i, s)}ax-li">${inner}<span class="ax-nm">${esc(nameOf(e))}</span></div>`;
}

/** Icon grid. Size comes from the container class, so one shape serves three modes. */
function iconCell(e: Entry, i: number, s: ViewState, urlOf: (a: AssetRow) => string): string {
  const inner = e.type === 'folder' ? folderArt(40) : art(e.asset, urlOf(e.asset), 34);
  return `<div ${cellAttrs(e, i, s)}ax-icon">${inner}<span class="ax-nm">${esc(nameOf(e))}</span></div>`;
}

/** Artwork on the left, name and facts stacked on the right. */
function tileCell(e: Entry, i: number, s: ViewState, urlOf: (a: AssetRow) => string): string {
  const inner = e.type === 'folder' ? folderArt(26) : art(e.asset, urlOf(e.asset), 24);
  const meta = e.type === 'folder'
    ? `${e.count} item${e.count === 1 ? '' : 's'}`
    : `${fmtType(e.asset)} · ${fmtBytes(e.asset.bytes)}${e.asset.width ? ` · ${e.asset.width}×${e.asset.height}` : ''}`;
  return `<div ${cellAttrs(e, i, s)}ax-tile">${inner}
    <span class="ax-tile-t"><span class="ax-nm">${esc(nameOf(e))}</span><span class="ax-sub">${esc(meta)}</span></span>
  </div>`;
}

export function pane(s: ViewState, urlOf: (a: AssetRow) => string): string {
  if (!s.entries.length) {
    return `<div class="ax-list ${s.view}"><div class="ax-empty">${
      s.query ? 'Nothing matches that search.'
        : 'This folder is empty. Drop files here, or use Upload.'
    }</div></div>`;
  }
  const render =
    s.view === 'details' ? detailsRow
    : s.view === 'list' ? listRow
    : s.view === 'tiles' ? tileCell
    : iconCell;
  const cells = s.entries.map((e, i) => render(e, i, s, urlOf)).join('');
  return `<div class="ax-list ${s.view}" role="listbox" aria-multiselectable="true">${cells}</div>`;
}
