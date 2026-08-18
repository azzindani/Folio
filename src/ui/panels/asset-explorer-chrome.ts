// Asset explorer — the frame around the file pane: command bar, navigation
// row, folder tree, status bar.
//
// The command bar is the point. Every verb used to live in a right-click menu,
// which means it may as well not exist: you cannot discover a menu you have no
// reason to open, and on a touchscreen you can barely reach one. A file manager
// puts its verbs on top, greyed out until they apply, so the available actions
// are readable at a glance.
import { chromeIcon } from '../../editor/chrome-icons';
import { esc, VIEW_MODES, type ViewState } from './asset-explorer-view';

/** One button in the command bar. `group` inserts a divider between clusters. */
export interface Command {
  id: string;
  label: string;
  icon: string;
  accel?: string;
  disabled?: boolean;
  danger?: boolean;
  group: number;
  /** Label hidden below a certain width — icon-only, with the title as tooltip. */
  compact?: boolean;
}

/**
 * What the bar offers, and what is live right now.
 *
 * Disabled is computed from the selection rather than the button being absent,
 * so the bar never changes shape as you click around — the position of Delete
 * is somewhere your hand can learn.
 */
export function commands(s: ViewState): Command[] {
  const files = s.selectedFiles;
  const folders = s.selectedFolders;
  const any = files + folders;
  const one = any === 1;
  return [
    { id: 'newfolder', label: 'New folder', icon: 'plus', group: 0 },
    { id: 'upload', label: 'Upload', icon: 'upload', group: 0 },
    { id: 'write', label: 'Write', icon: 'pen', group: 0, compact: true },

    { id: 'cut', label: 'Cut', icon: 'scissors', group: 1, disabled: !files, compact: true },
    { id: 'copy', label: 'Copy', icon: 'copy', group: 1, disabled: !files, compact: true },
    { id: 'paste', label: 'Paste', icon: 'clipboard', group: 1, disabled: !s.canPaste, compact: true },

    { id: 'rename', label: 'Rename', icon: 'pen', accel: 'F2', group: 2, disabled: !one, compact: true },
    { id: 'moveto', label: 'Move to', icon: 'folder', group: 2, disabled: !any, compact: true },
    { id: 'delete', label: 'Delete', icon: 'trash', accel: 'Del', group: 2, disabled: !any, danger: true },
  ];
}

export function commandBar(s: ViewState): string {
  const items = commands(s);
  let group = items[0]?.group ?? 0;
  const buttons = items.map(c => {
    const divider = c.group !== group ? (group = c.group, '<span class="ax-div"></span>') : '';
    return `${divider}<button class="ax-cmd${c.danger ? ' danger' : ''}${c.compact ? ' compact' : ''}"
      data-cmd="${c.id}" ${c.disabled ? 'disabled' : ''}
      title="${esc(c.label)}${c.accel ? ` (${c.accel})` : ''}">
      ${chromeIcon(c.icon, 15)}<span class="ax-cmd-l">${esc(c.label)}</span></button>`;
  }).join('');

  const view = VIEW_MODES.map(v =>
    `<button class="ax-vmode${v.id === s.view ? ' active' : ''}" data-view="${v.id}" title="${esc(v.label)}">
      ${chromeIcon(v.icon, 15)}<span class="ax-cmd-l">${esc(v.label)}</span></button>`).join('');

  // The six modes, visible as a segmented control wherever there is room. They
  // used to live only in the dropdown below, at the far right of the bar next
  // to Refresh — so "show me these as a list" meant finding a menu you had no
  // reason to open, and the answer was that the feature was missing.
  const segment = VIEW_MODES.map(v =>
    `<button class="ax-seg${v.id === s.view ? ' active' : ''}" data-view="${v.id}"
      title="${esc(v.label)}" aria-label="${esc(v.label)}"
      aria-pressed="${v.id === s.view}">${chromeIcon(v.icon, 15)}</button>`).join('');

  return `
    <div class="ax-cmdbar">
      ${buttons}
      <span class="ax-gap"></span>
      <div class="ax-viewseg" role="group" aria-label="View">${segment}</div>
      <div class="ax-viewpick">
        <button class="ax-cmd compact" data-cmd="viewmenu" title="Change the view">
          ${chromeIcon(VIEW_MODES.find(v => v.id === s.view)?.icon ?? 'list', 15)}<span class="ax-cmd-l">View</span>
        </button>
        <div class="ax-viewmenu" hidden>${view}</div>
      </div>
      <button class="ax-cmd compact" data-cmd="refresh" title="Refresh">${chromeIcon('refresh', 15)}<span class="ax-cmd-l">Refresh</span></button>
      <button class="ax-cmd compact" data-cmd="full" title="${s.full ? 'Back to the panel (Esc)' : 'Open full window'}">${chromeIcon(s.full ? 'shrink' : 'expand', 15)}<span class="ax-cmd-l">${s.full ? 'Restore' : 'Expand'}</span></button>
    </div>`;
}

/** Back / up / breadcrumb / search — the navigation row above the commands. */
export function navRow(s: ViewState): string {
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
  const up = s.folder ? s.folder.split('/').slice(0, -1).join('/') : null;
  return `
    <div class="ax-nav">
      <button class="ax-navbtn ax-places" data-cmd="places" title="Projects and shared library" aria-label="Places">${chromeIcon('layers', 15)}</button>
      <button class="ax-navbtn" data-cmd="back" ${s.canBack ? '' : 'disabled'} title="Back">${chromeIcon('arrow-left', 15)}</button>
      <button class="ax-navbtn" data-cmd="up" ${up === null ? 'disabled' : ''} data-nav-up="${up === null ? '' : `${s.scope}:${esc(up)}`}" title="Up one level">${chromeIcon('arrow-up', 15)}</button>
      <div class="ax-crumb-path">${parts.join('')}</div>
      <input class="ax-search" type="search" placeholder="Search all assets…" value="${esc(s.query)}" aria-label="Search assets">
    </div>`;
}

/**
 * The tree: projects in one branch, the shared library in another.
 *
 * Projects are NOT folders and are not listed as if they were. A project is a
 * container you switch between — the equivalent of a drive — so it gets its own
 * branch with its own create verb, and only the open one expands to show the
 * asset folders inside it.
 */
export function tree(s: ViewState): string {
  // The open project always appears, even if the listing has not caught up with
  // it — a project created a moment ago, or one opened from a design link,
  // would otherwise show no folders at all and look empty.
  const known = s.project && !s.projects.some(p => p.name === s.project)
    ? [{ name: s.project, designs: 0, assets: 0 }, ...s.projects]
    : s.projects;
  const projects = known.map(p => {
    const open = p.name === s.project;
    const active = open && s.scope === 'project' && !s.folder && !s.query;
    const kids = open
      ? s.folders.map(f => folderNode(f, 'project', s)).join('')
      : '';
    return `<button class="ax-node project${active ? ' active' : ''}${open ? ' open' : ''}" data-nav="project:" data-project="${esc(p.name)}" title="${esc(p.name)} · ${p.assets} assets">
      <span class="ax-node-i">${chromeIcon('layers', 13)}</span>
      <span class="ax-node-l">${esc(p.name)}</span>
      <span class="ax-node-n">${p.assets || ''}</span>
    </button>${kids}`;
  }).join('');

  const libActive = s.scope === 'library' && !s.folder && !s.query;
  const lib = `<button class="ax-node root${libActive ? ' active' : ''}" data-nav="library:" title="Shared library">
      <span class="ax-node-i">${chromeIcon('library', 13)}</span><span class="ax-node-l">Shared library</span>
    </button>${s.libraryFolders.map(f => folderNode(f, 'library', s)).join('')}`;

  const projectBranch = `<div class="ax-tree-h">Projects<button class="ax-tree-add" data-cmd="newproject" title="New project">${chromeIcon('plus', 12)}</button></div>
    ${projects}`;
  const libraryBranch = `<div class="ax-tree-h">Shared with every project</div>
    ${lib}`;

  // Whichever store you are IN comes first. With two hundred projects the
  // second branch is hundreds of rows down, so a fixed order means half the
  // time the tree opens showing a list you are not looking at and the place
  // you ARE is below the fold. This is also why the Design Library mounts on
  // the shared store: it belongs to everything, and no one project is the
  // right answer there.
  const order = s.scope === 'library' ? [libraryBranch, projectBranch] : [projectBranch, libraryBranch];

  return `<nav class="ax-tree" aria-label="Places">
    ${order.join('\n    ')}
  </nav>`;
}

function folderNode(folder: string, scope: 'project' | 'library', s: ViewState): string {
  const active = s.scope === scope && s.folder === folder && !s.query;
  const depth = folder.split('/').length;
  return `<button class="ax-node${active ? ' active' : ''}" data-nav="${scope}:${esc(folder)}" style="--d:${depth}" title="${esc(folder)}">
    <span class="ax-node-i">${chromeIcon('folder', 13)}</span>
    <span class="ax-node-l">${esc(folder.split('/').pop() ?? folder)}</span></button>`;
}

export function status(s: ViewState): string {
  const files = s.entries.filter(e => e.type === 'file').length;
  const folders = s.entries.length - files;
  const bytes = s.entries.reduce((n, e) => n + (e.type === 'file' ? e.asset.bytes : 0), 0);
  const bits = [
    `${folders ? `${folders} folder${folders === 1 ? '' : 's'}, ` : ''}${files} file${files === 1 ? '' : 's'}`,
    s.selected.size ? `${s.selected.size} selected` : '',
    files ? fmtBytesLocal(bytes) : '',
    s.clip,
  ].filter(Boolean);
  return `<div class="ax-status"><span>${esc(bits.join(' · '))}</span><span class="ax-status-r">${s.totalProject} in project · ${s.totalShared} shared</span></div>`;
}

function fmtBytesLocal(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Drop-to-upload on the whole panel.
 *
 * The overlay is driven by a COUNTER, not a boolean: dragenter and dragleave
 * fire again for every child element the pointer crosses, so a boolean flickers
 * the overlay off the moment the drag passes over a row.
 */
export function wireDropOverlay(
  root: HTMLElement,
  overlay: HTMLElement,
  onFiles: (files: File[]) => void,
): void {
  let depth = 0;
  const show = (on: boolean): void => { overlay.hidden = !on; };
  root.addEventListener('dragenter', ev => {
    if (!ev.dataTransfer?.types.includes('Files')) return;
    depth++;
    show(true);
  });
  root.addEventListener('dragover', ev => { if (ev.dataTransfer?.types.includes('Files')) ev.preventDefault(); });
  root.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) show(false); });
  root.addEventListener('drop', ev => {
    depth = 0;
    show(false);
    const files = ev.dataTransfer?.files;
    if (!files?.length) return;
    ev.preventDefault();
    onFiles(Array.from(files));
  });
}

/** Everything a command-bar button can ask the panel to do. */
export interface CommandHost {
  back(): void;
  navigate(nav: string): void;
  pickFiles(): void;
  newFolder(): void;
  newProject(): void;
  write(): void;
  cut(): void;
  copy(): void;
  paste(): void;
  rename(): void;
  move(): void;
  remove(): void;
  refresh(): void;
  toggleFull(): void;
  toggleViewMenu(): void;
  togglePlaces(): void;
}

/**
 * Dispatch one command-bar click.
 *
 * A table rather than a listener per button: the bar is generated from
 * `commands()`, so hand-wiring each one would drift from that list the first
 * time a verb is added.
 */
export function runCommand(cmd: string, el: HTMLElement, host: CommandHost): void {
  switch (cmd) {
    case 'back': host.back(); return;
    case 'up': { const to = el.dataset['navUp']; if (to) host.navigate(to); return; }
    case 'upload': host.pickFiles(); return;
    case 'newfolder': host.newFolder(); return;
    case 'newproject': host.newProject(); return;
    case 'write': host.write(); return;
    case 'cut': host.cut(); return;
    case 'copy': host.copy(); return;
    case 'paste': host.paste(); return;
    case 'rename': host.rename(); return;
    case 'moveto': host.move(); return;
    case 'delete': host.remove(); return;
    case 'refresh': host.refresh(); return;
    case 'full': host.toggleFull(); return;
    case 'viewmenu': host.toggleViewMenu(); return;
    case 'places': host.togglePlaces(); return;
    default: return;
  }
}

/** What the frame's controls report back to the panel. */
export interface ChromeHost {
  runCommand(cmd: string, el: HTMLElement): void;
  setView(mode: string): void;
  setQuery(q: string): void;
  openProject(name: string): void;
  navigate(nav: string): void;
  dropOn(ev: DragEvent, nav: string): void;
  sortBy(key: string): void;
  currentProject(): string | null;
  upload(files: File[]): void;
  /** Right-click on a tree node — the same verbs the file pane offers. */
  treeMenu(ev: MouseEvent, nav: string, project: string | null): void;
  accept: string;
}

/**
 * Wire the frame: file input, command bar, view menu, search, tree, columns.
 *
 * Everything is bound by data attribute rather than by hand, so the markup
 * stays the single source of what exists — adding a command to `commands()`
 * makes it work with no wiring change.
 */
export function wireChrome(container: HTMLElement, host: ChromeHost): void {
  const file = container.querySelector<HTMLInputElement>('.ax-file');
  if (file) {
    file.accept = host.accept;
    file.addEventListener('change', () => {
      const picked = file.files;
      if (picked?.length) host.upload(Array.from(picked));
      file.value = '';
    });
  }

  container.querySelectorAll<HTMLElement>('[data-cmd]').forEach(el => {
    el.addEventListener('click', ev => { ev.stopPropagation(); host.runCommand(el.dataset['cmd'] ?? '', el); });
  });
  container.querySelectorAll<HTMLElement>('[data-view]').forEach(el => {
    el.addEventListener('click', () => host.setView(el.dataset['view'] ?? 'details'));
  });

  const search = container.querySelector<HTMLInputElement>('.ax-search');
  search?.addEventListener('input', () => host.setQuery(search.value));

  container.querySelectorAll<HTMLElement>('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      // A project row switches project AND navigates to its root; a folder row
      // just navigates. Projects are containers, not folders.
      const project = el.dataset['project'];
      if (project && project !== host.currentProject()) { host.openProject(project); return; }
      host.navigate(el.dataset['nav'] ?? 'project:');
    });
    // The tree is where a file manager expects folders to be MANAGED, not just
    // walked: right-clicking one used to open an empty menu, so the only route
    // to deleting a folder was to find it again in the file pane.
    if (el.classList.contains('ax-node')) {
      el.addEventListener('contextmenu', ev => {
        ev.preventDefault();
        host.treeMenu(ev, el.dataset['nav'] ?? '', el.dataset['project'] ?? null);
      });
    }
    // A folder in the tree is a drop target: dragging files onto it moves them,
    // which is how anyone expects to file things.
    el.addEventListener('dragover', ev => { ev.preventDefault(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', ev => {
      el.classList.remove('drop');
      ev.preventDefault();
      host.dropOn(ev, el.dataset['nav'] ?? 'project:');
    });
  });

  container.querySelectorAll<HTMLElement>('[data-sort]').forEach(el => {
    el.addEventListener('click', () => host.sortBy(el.dataset['sort'] ?? 'name'));
  });
}

/** Below this the tree pane costs more than it gives — Places opens it instead. */
const WIDE_PX = 520;

/**
 * Mark the panel wide enough for a docked tree, and keep up as it is resized.
 *
 * The first measurement is the one that matters; the observer only tracks a
 * panel being dragged wider. Where ResizeObserver does not exist (jsdom) the
 * layout is still correct for the width it opened at.
 */
export function trackWidth(container: HTMLElement, previous: ResizeObserver | null): ResizeObserver | null {
  const root = container.querySelector<HTMLElement>('.ax');
  if (!root) return previous;
  const apply = (w: number): void => { root.classList.toggle('is-wide', w >= WIDE_PX); };
  apply(container.clientWidth);
  if (typeof ResizeObserver === 'undefined') return previous;
  previous?.disconnect();
  const next = new ResizeObserver(es => { for (const e of es) apply(e.contentRect.width); });
  next.observe(container);
  return next;
}
