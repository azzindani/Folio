// Folio editor — Asset manager: a file manager over the project's asset store
// and the shared library (the same set the MCP asset ops see).
//
// Tree, breadcrumb, sortable columns, multi-select, right-click menu, drag to
// upload, drag to move. It behaves like the file manager on the machine you
// came from, because filing a folder of screenshots is a chore and a chore
// should not also be a puzzle.
//
// It opens on its OWN: pick a project from the toolbar. It used to initialise
// only as a side effect of opening a design from the Library, which left
// anyone who came to upload first staring at an empty pane with no controls.
import { type StateManager } from '../../editor/state';
import { AssetIO, storeOf, type AssetRow, type ManageBody, type ProjectRow, type Scope } from './asset-explorer-io';
import {
  shell, entryKey, fmtType, wireDropOverlay,
  type Entry, type SortKey, type ViewMode, type ViewState,
} from './asset-explorer-view';
import { getClip, setClip, clipSummary, paste } from './asset-explorer-clipboard';
import { commands, runCommand, wireChrome, trackWidth } from './asset-explorer-chrome';
import { entryMenu, treeNodeMenu, copyPaths, downloadAsset, uploadFiles, runBatch } from './asset-explorer-actions';
import { wireKeys } from './asset-explorer-keys';
import { Selection, closeMenu, type MenuItem } from './asset-explorer-menu';
import { wireCells } from './asset-explorer-cells';
import { openDocEditor } from './asset-explorer-doc';
import { placeAsset } from './asset-explorer-place';
import { promptDialog, confirmDialog, renameDialog } from './asset-explorer-dialog';
import { FullWindow } from './asset-explorer-full';
import {
  parentOf, createFolder, deleteFolders, renameFolder,
  promptMoveFolder, moveFolderInto, type FolderCtx,
} from './asset-explorer-folders';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,font/ttf,font/otf,font/woff2,font/woff,.ttf,.otf,.woff,.woff2,.md,.markdown,.txt,.csv,.json,.yaml,.yml,text/markdown,text/plain,text/csv,application/json';

export class AssetPanelManager {
  private container: HTMLElement;
  private state: StateManager;
  private io = new AssetIO();

  private rows: AssetRow[] = [];
  private folders: string[] = [];
  private libraryFolders: string[] = [];
  private projects: ProjectRow[] = [];

  private scope: Scope = 'project';
  private folder = '';
  private query = '';
  private view: ViewMode = 'details';
  private sort: SortKey = 'name';
  private desc = false;

  private sel = new Selection();
  private order: string[] = [];
  private busy = false;
  private bootId = 0;
  /** Places visited, for Back. Not the browser's history. */
  private history: string[] = [];
  private observer: ResizeObserver | null = null;

  private readonly window: FullWindow;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.window = new FullWindow({
      container,
      render: () => this.render(),
      hasSelection: () => this.sel.size > 0,
      clearSelection: () => { this.sel.clear(); this.paintSelection(); },
    });
    this.renderMessage('Loading assets…');
    void this.boot(null, null);
  }

  /** Called when a server-backed design opens, and on first use with nulls. */
  setProject(project: string | null, token: string | null): void {
    this.scope = 'project';
    this.folder = '';
    this.query = '';
    this.sel.clear();
    void this.boot(project, token);
  }

  /**
   * Establish which project we are looking at, then list it.
   *
   * A null project is the normal case now — the panel is reachable from the
   * activity bar with nothing open — so it asks the server what projects exist
   * and takes the one with the most assets rather than giving up.
   */
  private async boot(project: string | null, token: string | null): Promise<void> {
    // Two boots can be in flight at once: the panel opens with no project and
    // starts looking one up, then a design finishes loading and names the real
    // one. Without this guard the slower lookup wins and the manager lists
    // whichever project the server happened to return first.
    const id = ++this.bootId;
    this.io.setContext(project, token ?? this.readToken());
    const projects = await this.io.projects();
    if (id !== this.bootId) return;
    this.projects = projects;
    if (!project) {
      const first = projects[0]?.name ?? null;
      if (!first) {
        this.renderMessage('No projects yet. Create one from the Library, then upload assets here.');
        return;
      }
      this.io.setContext(first, token ?? this.readToken());
    }
    await this.refresh();
  }

  /** The editor's own token: the URL carries it once, the session keeps it. */
  private readToken(): string | null {
    try {
      const fromUrl = new URLSearchParams(location.search).get('token');
      if (fromUrl) return fromUrl;
      return sessionStorage.getItem('folio_editor_token');
    } catch { return null; }
  }

  async refresh(): Promise<void> {
    const res = await this.io.list();
    if ('error' in res) { this.renderMessage(res.error); return; }
    this.rows = res.assets;
    this.folders = res.folders;
    this.libraryFolders = res.libraryFolders;
    this.render();
  }

  // ── Deriving what the pane shows ────────────────────────────────

  /** Direct children of the current location: folders first, then files. */
  private entries(): Entry[] {
    if (this.query.trim()) return this.searchEntries();
    const files = this.rows
      .filter(r => storeOf(r) === this.scope && (r.folder ?? '') === this.folder)
      .map(a => ({ type: 'file', asset: a } as Entry));
    return [...this.subfolders(), ...this.sortFiles(files)];
  }

  /** Search spans BOTH stores and every folder — a file manager's search box
   *  is how you find something when you have forgotten where you put it. */
  private searchEntries(): Entry[] {
    const q = this.query.trim().toLowerCase();
    return this.sortFiles(this.rows
      .filter(r => r.path.toLowerCase().includes(q) || (r.alt ?? '').toLowerCase().includes(q))
      .map(a => ({ type: 'file', asset: a } as Entry)));
  }

  /** Folder paths in the store we are looking at. Both stores nest now. */
  private allFolders(): string[] {
    return this.scope === 'library' ? this.libraryFolders : this.folders;
  }

  private subfolders(): Entry[] {
    const here = this.folder;
    return this.allFolders()
      .filter(f => parentOf(f) === here)
      .map(full => ({
        type: 'folder' as const,
        name: full.slice(here ? here.length + 1 : 0),
        folder: full,
        count: this.countIn(full),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Direct children — what a file manager shows in the size column of a row. */
  private countIn(folder: string): number {
    const files = this.rows.filter(r => storeOf(r) === this.scope && (r.folder ?? '') === folder).length;
    return files + this.allFolders().filter(f => parentOf(f) === folder).length;
  }


  /** Where a new folder or upload goes: inside whatever is open. */
  private childPath(name: string): string {
    const clean = name.trim().replace(/^\/+|\/+$/g, '');
    return this.folder ? `${this.folder}/${clean}` : clean;
  }

  private sortFiles(entries: Entry[]): Entry[] {
    const dir = this.desc ? -1 : 1;
    const val = (e: Entry): string | number => {
      if (e.type !== 'file') return '';
      const a = e.asset;
      if (this.sort === 'size') return a.bytes;
      if (this.sort === 'type') return fmtType(a);
      if (this.sort === 'added') return a.added ?? '';
      return (a.path.split('/').pop() ?? a.path).toLowerCase();
    };
    return entries.sort((a, b) => {
      const x = val(a), y = val(b);
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }

  private viewState(entries: Entry[]): ViewState {
    const clip = getClip();
    return {
      project: this.io.projectName,
      projects: this.projects,
      scope: this.scope,
      folder: this.folder,
      entries,
      folders: this.folders,
      libraryFolders: this.libraryFolders,
      selected: this.sel.keys,
      selectedFiles: this.selectedAssets().length,
      selectedFolders: this.selectedFolders().length,
      view: this.view,
      sort: this.sort,
      desc: this.desc,
      query: this.query,
      totalProject: this.rows.filter(r => storeOf(r) === 'project').length,
      totalShared: this.rows.filter(r => storeOf(r) === 'library').length,
      full: this.window.active,
      clip: clipSummary(),
      canPaste: Boolean(clip),
      canBack: this.history.length > 0,
    };
  }

  /** Fill the window instead of the sidebar — see asset-explorer-full.ts. */
  private toggleFull(on = !this.window.active): void {
    this.window.toggle(on);
  }

  /** Open it as a window, which is what clicking "Project assets" asks for. */
  openForBrowsing(): void {
    this.window.openForBrowsing();
  }

  private renderMessage(msg: string): void {
    this.container.innerHTML = `<div class="ax-message">${msg.replace(/[<>&]/g, '')}</div>`;
  }

  private render(): void {
    // A menu left open across a re-render would act on rows that no longer
    // exist — the refresh after a delete is exactly when that happens.
    closeMenu();
    // Every render replaces the panel's DOM, which drops focus to <body> — and
    // the keyboard shortcuts are bound to the panel, so after one navigation
    // Ctrl+V would silently do nothing. Put focus back where it was.
    const hadFocus = this.container.contains(document.activeElement)
      && document.activeElement?.tagName !== 'INPUT';

    const entries = this.entries();
    this.order = entries.map(entryKey);
    this.sel.retain(this.order);
    this.container.innerHTML = shell(this.viewState(entries), a => this.io.url(a));
    this.wire(entries);
    this.trackWidth();
    if (hadFocus) this.container.querySelector<HTMLElement>('.ax-list')?.focus();
  }

  // ── Wiring ──────────────────────────────────────────────────────

  private wire(entries: Entry[]): void {
    wireChrome(this.container, {
      accept: ACCEPT,
      upload: (files) => void this.upload(files),
      runCommand: (cmd, el) => this.runCommand(cmd, el),
      setView: (mode) => { this.view = mode as ViewMode; this.render(); },
      setQuery: (q) => {
        this.query = q;
        this.render();
        // Re-focus: the whole panel is re-rendered on every keystroke, so the
        // caret would otherwise land back in the canvas after one letter.
        const next = this.container.querySelector<HTMLInputElement>('.ax-search');
        next?.focus();
        next?.setSelectionRange(next.value.length, next.value.length);
      },
      currentProject: () => this.io.projectName,
      treeMenu: (ev, nav, project) => this.treeMenu(ev, nav, project),
      openProject: (name) => void this.openProject(name),
      navigate: (nav) => this.navigate(nav),
      dropOn: (ev, nav) => void this.handleDrop(ev, nav),
      sortBy: (key) => {
        const k = key as SortKey;
        if (this.sort === k) this.desc = !this.desc; else { this.sort = k; this.desc = false; }
        this.render();
      },
    });
    this.wireItems(entries);
    this.wireDropZone();
    this.wireKeys();
  }

  private wireItems(entries: Entry[]): void {
    wireCells(this.container, entries, {
      order: () => this.order,
      isSelected: (k) => this.sel.has(k),
      click: (k, mods) => this.sel.click(k, this.order, mods),
      selectOnly: (k) => this.sel.selectOnly(k),
      repaint: () => this.paintSelection(),
      open: (e) => this.open(e),
      menuFor: (e) => this.menuFor(e),
      draggedFiles: () => this.selectedPaths(),
      draggedFolders: () => this.selectedFolders(),
      drop: (ev, nav) => void this.handleDrop(ev, nav),
      scope: () => this.scope,
    });
  }

  /** Repaint selection without a full re-render — clicking through a long list
   *  should not rebuild every thumbnail (and restart every image request). */
  private paintSelection(): void {
    this.container.querySelectorAll<HTMLElement>('[data-key]').forEach(el => {
      const on = this.sel.has(el.dataset['key'] ?? '');
      el.classList.toggle('selected', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    // The command bar is the point of having one: its enabled states have to
    // follow the selection, and they cannot wait for a full re-render because
    // that would restart every thumbnail request on each click.
    const state = this.viewState(this.entries());
    for (const c of commands(state)) {
      const btn = this.container.querySelector<HTMLButtonElement>(`.ax-cmd[data-cmd="${c.id}"]`);
      if (btn) btn.disabled = Boolean(c.disabled);
    }
    const bar = this.container.querySelector<HTMLElement>('.ax-status span');
    if (bar) {
      const files = this.order.length;
      bar.textContent = [
        `${files} item${files === 1 ? '' : 's'}`,
        this.sel.size ? `${this.sel.size} selected` : '',
        clipSummary(),
      ].filter(Boolean).join(' · ');
    }
  }

  private navigate(nav: string, record = true): void {
    const i = nav.indexOf(':');
    // Back is a stack of places, not a browser history: it should retrace where
    // you went in the manager without touching the page's own history.
    if (record) this.history.push(`${this.scope}:${this.folder}`);
    this.scope = nav.slice(0, i) === 'library' ? 'library' : 'project';
    this.folder = nav.slice(i + 1);
    this.query = '';
    this.sel.clear();
    this.render();
  }

  private back(): void {
    const prev = this.history.pop();
    if (prev !== undefined) this.navigate(prev, false);
  }

  /** Switch project. Projects are containers, not folders — changing one
   *  re-lists from scratch rather than navigating within the current tree. */
  private async openProject(name: string): Promise<void> {
    this.history.push(`${this.scope}:${this.folder}`);
    this.io.setContext(name, this.readToken());
    this.scope = 'project';
    this.folder = '';
    this.query = '';
    this.sel.clear();
    await this.refresh();
  }

  private async newProject(): Promise<void> {
    const name = await promptDialog({
      title: 'New project',
      label: 'A project holds its own designs and assets',
      placeholder: 'client-campaign',
      confirm: 'Create',
    });
    if (!name) return;
    const res = await this.io.createProject(name);
    if (!res.ok) { await this.toast(res.error ?? 'Could not create it', 'warning'); return; }
    this.projects = await this.io.projects();
    const made = this.projects.find(p => p.name.toLowerCase() === name.trim().toLowerCase().replace(/\s+/g, '-'));
    await this.openProject(made?.name ?? name);
    await this.toast(`Created ${made?.name ?? name}`, 'success');
  }

  /** Every command-bar button lands here. */
  private runCommand(cmd: string, el: HTMLElement): void {
    runCommand(cmd, el, {
      back: () => this.back(),
      navigate: (nav) => this.navigate(nav),
      pickFiles: () => this.container.querySelector<HTMLInputElement>('.ax-file')?.click(),
      newFolder: () => void this.newFolder(),
      newProject: () => void this.newProject(),
      write: () => this.writeDoc(),
      cut: () => this.clip('cut'),
      copy: () => this.clip('copy'),
      paste: () => void this.pasteHere(),
      rename: () => void this.renameSelection(),
      move: () => void this.moveSelection(),
      remove: () => void this.deleteSelection(),
      refresh: () => void this.refresh(),
      toggleFull: () => this.toggleFull(),
      toggleViewMenu: () => {
        const menu = this.container.querySelector<HTMLElement>('.ax-viewmenu');
        if (menu) menu.hidden = !menu.hidden;
      },
      // Below the tree's width the tree is hidden, and without this there
      // would be no way at all to reach another project — which is most of
      // what the panel is for on a phone.
      togglePlaces: () => this.container.querySelector('.ax-tree')?.classList.toggle('open'),
    });
  }

  /** Mark the selected FILES for a cut or a copy. Folders are excluded: moving
   *  a folder rebuilds a tree, which is drag or Move-to, not the clipboard. */
  private clip(mode: 'cut' | 'copy'): void {
    const paths = this.selectedPaths();
    if (!paths.length) return;
    setClip({ mode, project: this.io.projectName, scope: this.scope, paths });
    this.render();
  }

  private async pasteHere(): Promise<void> {
    const report = await paste({ io: this.io, folder: this.folder, scope: this.scope });
    if (!report) return;
    if (report.failures.length) await this.toast(report.failures.slice(0, 3).join(' · '), 'warning');
    else {
      const n = report.moved + report.copied;
      await this.toast(`${report.moved ? 'Moved' : 'Copied'} ${n} item${n === 1 ? '' : 's'} here`, 'success');
    }
    this.sel.clear();
    await this.refresh();
  }

  /** Rename whichever single thing is selected, folder or file. */
  private async renameSelection(): Promise<void> {
    const folders = this.selectedFolders();
    const files = this.selectedAssets();
    if (folders.length === 1 && !files.length && folders[0]) { await this.renameFolder(folders[0]); return; }
    if (files.length === 1 && !folders.length && files[0]) await this.rename(files[0]);
  }

  private selectedAssets(): AssetRow[] {
    const byPath = new Map(this.rows.map(r => [r.path, r]));
    return this.sel.values().map(k => byPath.get(k)).filter((a): a is AssetRow => Boolean(a));
  }

  private selectedPaths(): string[] {
    return this.selectedAssets().map(a => a.path);
  }

  /** Folder paths in the selection. Folder keys are "folder:<path>", so they
   *  never resolve through the asset list — which is why Delete used to do
   *  nothing at all when a folder was the thing selected. */
  private selectedFolders(): string[] {
    return this.sel.values()
      .filter(k => k.startsWith('folder:'))
      .map(k => k.slice('folder:'.length));
  }

  // ── Drag, drop and keys ─────────────────────────────────────────

  private wireDropZone(): void {
    const root = this.container.querySelector<HTMLElement>('.ax');
    const overlay = this.container.querySelector<HTMLElement>('.ax-drop');
    if (root && overlay) wireDropOverlay(root, overlay, files => void this.upload(files));
  }

  /** A drop onto a tree node or crumb: OS files upload there, dragged rows move. */
  private async handleDrop(ev: DragEvent, nav: string): Promise<void> {
    const i = nav.indexOf(':');
    const scope: Scope = nav.slice(0, i) === 'library' ? 'library' : 'project';
    const folder = nav.slice(i + 1);
    const files = ev.dataTransfer?.files;
    if (files?.length) { await this.upload(Array.from(files), folder, scope); return; }
    // Folders first: dragging a folder moves the files inside it, so doing the
    // loose files afterwards cannot collide with paths that just changed.
    const draggedFolders = ev.dataTransfer?.getData('application/x-folio-folders');
    for (const f of (draggedFolders ? JSON.parse(draggedFolders) as string[] : [])) {
      await this.afterRelocate(f, await moveFolderInto(this.folderCtx(), f, folder));
    }
    const moved = ev.dataTransfer?.getData('application/x-folio-assets');
    const paths = moved ? JSON.parse(moved) as string[] : [];
    if (!paths.length) { if (draggedFolders) await this.refresh(); return; }
    await this.runBatch(paths.map(p => ({ op: 'move' as const, asset_path: p, folder })), `Moved to ${folder || 'the root'}`);
  }

  private wireKeys(): void {
    wireKeys(
      this.container.querySelector<HTMLElement>('.ax'),
      this.container.querySelector<HTMLElement>('.ax-list'),
      {
        selectAll: () => { this.sel.all(this.order); this.paintSelection(); },
        clearSelection: () => { this.sel.clear(); this.paintSelection(); },
        hasSelection: () => this.sel.size > 0,
        canPaste: () => Boolean(getClip()),
        remove: () => void this.deleteSelection(),
        rename: () => void this.renameSelection(),
        cut: () => this.clip('cut'),
        copy: () => this.clip('copy'),
        paste: () => void this.pasteHere(),
        openSelected: () => {
          const first = this.sel.values()[0];
          const entry = this.entries().find(e => entryKey(e) === first);
          if (entry) this.open(entry);
        },
      },
    );
  }

  // ── Actions ─────────────────────────────────────────────────────

  private open(entry: Entry): void {
    if (entry.type === 'folder') { this.navigate(`${this.scope}:${entry.folder}`); return; }
    if (entry.asset.kind === 'docs') { this.writeDoc(entry.asset); return; }
    placeAsset(this.state, entry.asset);
  }


  /** Right-click on a node in the tree — see asset-explorer-actions.ts. */
  private treeMenu(ev: MouseEvent, nav: string, project: string | null): void {
    treeNodeMenu(ev, nav, project, {
      currentProject: this.io.projectName,
      openProject: (p) => this.openProject(p),
      navigate: (n) => this.navigate(n),
      newFolder: () => void this.newFolder(),
      uploadInto: (f) => this.pickInto(f),
      setScope: (sc) => { this.scope = sc; },
      selectFolder: (f) => { this.sel.selectOnly(`folder:${f}`); this.paintSelection(); },
      menuFor: (e) => this.menuFor(e),
      countIn: (f) => this.countIn(f),
    });
  }

  /** Build the right-click menu for whatever was clicked. */
  private menuFor(entry: Entry): MenuItem[] {
    return entryMenu(entry, {
      scope: this.scope,
      selectedFolders: this.selectedFolders(),
      placeable: this.selectedAssets().filter(a => a.kind === 'images' || a.kind === 'icons').length,
      selectedFiles: this.selectedAssets().length,
      on: {
        open: (nav) => this.navigate(nav),
        uploadInto: (f) => this.pickInto(f),
        newFolderIn: (f) => { this.navigate(`${this.scope}:${f}`); void this.newFolder(); },
        renameFolder: (f) => void this.renameFolder(f),
        moveFolder: (f) => void this.moveFolder(f),
        deleteFolders: (fs) => void this.removeFolders(fs),
        place: () => this.placeSelection(),
        editDoc: (a) => this.writeDoc(a),
        openTab: (a) => window.open(this.io.url(a), '_blank', 'noopener'),
        cut: () => this.clip('cut'),
        copy: () => this.clip('copy'),
        paste: () => void this.pasteHere(),
        rename: (a) => void this.rename(a),
        move: () => void this.moveSelection(),
        copyPath: () => void copyPaths(this.selectedPaths(), (m, k) => this.toast(m, k)),
        download: (a) => downloadAsset(this.io.url(a), a.path.split('/').pop() ?? 'asset'),
        remove: () => void this.deleteSelection(),
      },
    });
  }

  private pickInto(folder: string): void {
    this.navigate(`${this.scope}:${folder}`);
    this.container.querySelector<HTMLInputElement>('.ax-file')?.click();
  }

  private writeDoc(asset?: AssetRow): void {
    openDocEditor({
      io: this.io,
      host: this.container,
      folder: asset?.folder ?? this.folder,
      scope: asset ? storeOf(asset) : this.scope,
      ...(asset ? { asset } : {}),
      onClose: () => this.render(),
      onSaved: () => { void this.refresh(); },
    });
  }

  /** Upload, one file at a time so the failing file is the one named. */
  private async upload(files: File[], folder = this.folder, scope = this.scope): Promise<void> {
    if (this.busy) {
      // Silently dropping the second batch is how "I can't upload my files"
      // happens: nothing moves and nothing says why.
      await this.toast('Still uploading the last batch — try again in a moment', 'warning');
      return;
    }
    this.busy = true;
    await uploadFiles(this.io, files, folder, scope, (m, k) => this.toast(m, k));
    this.busy = false;
    await this.refresh();
  }

  /** Context the folder verbs need — they are free functions in their own
   *  module so menu, keyboard and drag all take the same path. */
  private folderCtx(): FolderCtx {
    return {
      io: this.io,
      scope: this.scope,
      folder: this.folder,
      rows: this.rows,
      folders: this.allFolders(),
      toast: (m, k) => this.toast(m, k),
    };
  }

  private async newFolder(): Promise<void> {
    const made = await createFolder(this.folderCtx());
    if (!made) return;
    await this.refresh();
    // Land in what you just made — the reason you made it is to put things in it.
    this.navigate(`${this.scope}:${made}`);
  }

  private async removeFolders(folders: string[]): Promise<void> {
    const res = await deleteFolders(this.folderCtx(), folders);
    if (!res.ok) return;
    if (res.goTo !== undefined) this.folder = res.goTo;
    this.sel.clear();
    await this.refresh();
  }

  /** After a rename or a move, follow the folder if we were standing in it. */
  private async afterRelocate(from: string, to: string | null): Promise<void> {
    if (!to) return;
    if (this.folder === from || this.folder.startsWith(`${from}/`)) {
      this.folder = to + this.folder.slice(from.length);
    }
    this.sel.clear();
    await this.refresh();
  }

  private async rename(a: AssetRow): Promise<void> {
    const current = a.path.split('/').pop() ?? a.path;
    const next = await renameDialog(current);
    if (!next || next === current) return;
    await this.runBatch([{ op: 'move', asset_path: a.path, new_name: next }], `Renamed to ${next}`);
  }

  private async renameFolder(folder: string): Promise<void> {
    await this.afterRelocate(folder, await renameFolder(this.folderCtx(), folder));
  }

  private async moveFolder(folder: string): Promise<void> {
    await this.afterRelocate(folder, await promptMoveFolder(this.folderCtx(), folder));
  }

  private async moveSelection(): Promise<void> {
    const picked = this.selectedAssets();
    if (!picked.length) return;
    const to = await promptDialog({
      title: `Move ${picked.length === 1 ? '1 file' : `${picked.length} files`}`,
      label: 'Folder path — blank is the root',
      value: picked[0]?.folder ?? '',
      placeholder: 'clients/acme',
      confirm: 'Move',
    });
    if (to === null) return;
    await this.runBatch(picked.map(a => ({ op: 'move' as const, asset_path: a.path, folder: to })),
      `Moved ${picked.length} to ${to || 'the root'}`);
  }

  private async deleteSelection(): Promise<void> {
    const folders = this.selectedFolders();
    const picked = this.selectedAssets();
    if (!folders.length && !picked.length) return;
    // Folders first: deleting them may take some of the selected files with
    // them, and a per-file delete afterwards would then fail on a missing path.
    if (folders.length) { await this.removeFolders(folders); if (!picked.length) return; }
    if (!picked.length) return;
    const what = picked.length === 1 ? (picked[0]?.path.split('/').pop() ?? '') : `${picked.length} files`;
    const ok = await confirmDialog({
      title: picked.length === 1 ? 'Delete file' : 'Delete files',
      body: `Delete ${what}? They move to .trash, and any layer using them shows a placeholder.`,
      confirm: 'Delete', danger: true,
    });
    if (!ok) return;
    await this.runBatch(picked.map(a => ({ op: 'delete' as const, asset_path: a.path })), `Deleted ${what}`);
  }

  /** Run manage ops in sequence and report once — a per-file toast storm on a
   *  20-file move buries the one line that mattered. */
  private async runBatch(ops: ManageBody[], okMessage: string): Promise<void> {
    await runBatch(this.io, ops, okMessage, (m, k) => this.toast(m, k));
    this.sel.clear();
    await this.refresh();
  }


  private placeSelection(): void {
    for (const a of this.selectedAssets()) placeAsset(this.state, a, true);
  }


  private async toast(msg: string, kind: 'success' | 'warning'): Promise<void> {
    const { showToast } = await import('../../utils/toast');
    showToast(msg, kind);
  }

  private trackWidth(): void {
    this.observer = trackWidth(this.container, this.observer);
  }
}

