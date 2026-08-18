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
import type { Layer } from '../../schema/types';
import { AssetIO, storeOf, type AssetRow, type ProjectRow, type Scope } from './asset-explorer-io';
import {
  shell, entryKey, fmtType,
  type Entry, type SortKey, type TreeNode, type ViewMode, type ViewState,
} from './asset-explorer-view';
import { Selection, openMenu, closeMenu, type MenuItem } from './asset-explorer-menu';
import { openDocEditor } from './asset-explorer-doc';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,font/ttf,font/otf,font/woff2,font/woff,.ttf,.otf,.woff,.woff2,.md,.markdown,.txt,.csv,.json,.yaml,.yml,text/markdown,text/plain,text/csv,application/json';
/** Below this the tree pane costs more than it gives — the breadcrumb navigates. */
const WIDE_PX = 520;

let insertCounter = 0;

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
  private full = false;
  private bootId = 0;
  private observer: ResizeObserver | null = null;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
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

  private subfolders(): Entry[] {
    const here = this.folder;
    const names = this.scope === 'library'
      ? this.libraryFolders.filter(f => parentOf(f) === here)
      // The project store is one level deep, so subfolders exist at the root only.
      : here ? [] : this.folders;
    return names
      .map(full => ({
        type: 'folder' as const,
        name: full.slice(here ? here.length + 1 : 0),
        folder: full,
        count: this.countIn(full),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private countIn(folder: string): number {
    const files = this.rows.filter(r => storeOf(r) === this.scope && (r.folder ?? '') === folder).length;
    const subs = this.scope === 'library' ? this.libraryFolders.filter(f => parentOf(f) === folder).length : 0;
    return files + subs;
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

  private treeNodes(): TreeNode[] {
    const out: TreeNode[] = [
      { label: this.io.projectName ?? 'Project', scope: 'project', folder: '', depth: 0, root: true },
      ...this.folders.map(f => ({ label: f, scope: 'project' as Scope, folder: f, depth: 1 })),
      { label: 'Shared library', scope: 'library', folder: '', depth: 0, root: true },
    ];
    for (const f of this.libraryFolders) {
      out.push({ label: f.split('/').pop() ?? f, scope: 'library', folder: f, depth: f.split('/').length });
    }
    return out;
  }

  private viewState(entries: Entry[]): ViewState {
    return {
      project: this.io.projectName,
      projects: this.projects,
      scope: this.scope,
      folder: this.folder,
      entries,
      tree: this.treeNodes(),
      selected: this.sel.keys,
      view: this.view,
      sort: this.sort,
      desc: this.desc,
      query: this.query,
      totalProject: this.rows.filter(r => storeOf(r) === 'project').length,
      totalShared: this.rows.filter(r => storeOf(r) === 'library').length,
      full: this.full,
    };
  }

  /**
   * Fill the window instead of the sidebar.
   *
   * The left panel tops out around 600px and sits at ~280 by default, which is
   * a column, not a file manager — the folder tree has nowhere to go. This
   * gives the same view a real window, which is what "like Explorer" means in
   * practice. Escape brings it back.
   */
  private toggleFull(on = !this.full): void {
    this.full = on;
    this.container.classList.toggle('ax-full', on);
    document.body.classList.toggle('ax-full-open', on);
    if (on) document.addEventListener('keydown', this.escapeFull, true);
    else document.removeEventListener('keydown', this.escapeFull, true);
    this.render();
  }

  /** Escape clears a selection first, and only then leaves full window — so
   *  the key never closes the manager out from under an in-progress action. */
  private escapeFull = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || !this.full) return;
    if (this.sel.size) { this.sel.clear(); this.paintSelection(); return; }
    ev.stopPropagation();
    this.toggleFull(false);
  };

  private renderMessage(msg: string): void {
    this.container.innerHTML = `<div class="ax-message">${msg.replace(/[<>&]/g, '')}</div>`;
  }

  private render(): void {
    // A menu left open across a re-render would act on rows that no longer
    // exist — the refresh after a delete is exactly when that happens.
    closeMenu();
    const entries = this.entries();
    this.order = entries.map(entryKey);
    this.sel.retain(this.order);
    this.container.innerHTML = shell(this.viewState(entries), a => this.io.url(a));
    this.wire(entries);
    this.trackWidth();
  }

  // ── Wiring ──────────────────────────────────────────────────────

  private wire(entries: Entry[]): void {
    const q = <T extends HTMLElement>(sel: string): T | null => this.container.querySelector<T>(sel);
    const file = q<HTMLInputElement>('.ax-file');
    if (file) file.accept = ACCEPT;

    file?.addEventListener('change', () => {
      const picked = file.files;
      if (picked?.length) void this.upload(Array.from(picked));
      file.value = '';
    });

    q('[data-act="upload"]')?.addEventListener('click', () => file?.click());
    q('[data-act="newfolder"]')?.addEventListener('click', () => void this.newFolder());
    q('[data-act="write"]')?.addEventListener('click', () => this.writeDoc());
    q('[data-act="refresh"]')?.addEventListener('click', () => void this.refresh());
    q('[data-act="view"]')?.addEventListener('click', () => {
      this.view = this.view === 'details' ? 'icons' : 'details';
      this.render();
    });
    q('[data-act="full"]')?.addEventListener('click', () => this.toggleFull());

    q<HTMLSelectElement>('.ax-project')?.addEventListener('change', (ev) => {
      const name = (ev.target as HTMLSelectElement).value;
      this.io.setContext(name, this.readToken());
      this.scope = 'project';
      this.folder = '';
      this.sel.clear();
      void this.refresh();
    });

    const search = q<HTMLInputElement>('.ax-search');
    search?.addEventListener('input', () => {
      this.query = search.value;
      this.render();
      // Re-focus: the whole panel is re-rendered on every keystroke, so the
      // caret would otherwise land back in the canvas after one letter.
      const next = this.container.querySelector<HTMLInputElement>('.ax-search');
      next?.focus();
      next?.setSelectionRange(next.value.length, next.value.length);
    });

    this.container.querySelectorAll<HTMLElement>('[data-nav]').forEach(el => {
      el.addEventListener('click', () => this.navigate(el.dataset['nav'] ?? 'project:'));
      // A folder in the tree is a drop target: dragging files onto it moves
      // them, which is how anyone expects to file things.
      el.addEventListener('dragover', ev => { ev.preventDefault(); el.classList.add('drop'); });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', ev => {
        el.classList.remove('drop');
        ev.preventDefault();
        void this.handleDrop(ev, el.dataset['nav'] ?? 'project:');
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-sort]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset['sort'] as SortKey;
        if (this.sort === key) this.desc = !this.desc; else { this.sort = key; this.desc = false; }
        this.render();
      });
    });

    this.wireItems(entries);
    this.wireDropZone();
    this.wireKeys();
  }

  private wireItems(entries: Entry[]): void {
    this.container.querySelectorAll<HTMLElement>('[data-key]').forEach(el => {
      const key = el.dataset['key'] ?? '';
      const entry = entries[Number(el.dataset['idx'])];
      if (!entry) return;

      el.addEventListener('click', ev => {
        this.sel.click(key, this.order, { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey });
        this.paintSelection();
      });
      el.addEventListener('dblclick', () => this.open(entry));
      el.addEventListener('contextmenu', ev => {
        ev.preventDefault();
        if (!this.sel.has(key)) { this.sel.selectOnly(key); this.paintSelection(); }
        openMenu(ev.clientX, ev.clientY, this.menuFor(entry));
      });
      el.addEventListener('dragstart', ev => {
        if (!this.sel.has(key)) { this.sel.selectOnly(key); this.paintSelection(); }
        ev.dataTransfer?.setData('application/x-folio-assets', JSON.stringify(this.selectedPaths()));
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
      });
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
    const bar = this.container.querySelector<HTMLElement>('.ax-status span');
    if (bar) {
      const files = this.order.length;
      bar.textContent = `${files} item${files === 1 ? '' : 's'}${this.sel.size ? ` · ${this.sel.size} selected` : ''}`;
    }
  }

  private navigate(nav: string): void {
    const i = nav.indexOf(':');
    this.scope = nav.slice(0, i) === 'library' ? 'library' : 'project';
    this.folder = nav.slice(i + 1);
    this.query = '';
    this.sel.clear();
    this.render();
  }

  private selectedAssets(): AssetRow[] {
    const byPath = new Map(this.rows.map(r => [r.path, r]));
    return this.sel.values().map(k => byPath.get(k)).filter((a): a is AssetRow => Boolean(a));
  }

  private selectedPaths(): string[] {
    return this.selectedAssets().map(a => a.path);
  }

  // ── Drag, drop and keys ─────────────────────────────────────────

  /** Files from the OS land in the folder you are looking at. The overlay is
   *  driven by a counter because dragenter/leave also fire for every child. */
  private wireDropZone(): void {
    const root = this.container.querySelector<HTMLElement>('.ax');
    const overlay = this.container.querySelector<HTMLElement>('.ax-drop');
    if (!root || !overlay) return;
    let depth = 0;
    const show = (on: boolean): void => { overlay.hidden = !on; };
    root.addEventListener('dragenter', ev => {
      if (!ev.dataTransfer?.types.includes('Files')) return;
      depth++; show(true);
    });
    root.addEventListener('dragover', ev => { if (ev.dataTransfer?.types.includes('Files')) ev.preventDefault(); });
    root.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) show(false); });
    root.addEventListener('drop', ev => {
      depth = 0; show(false);
      const files = ev.dataTransfer?.files;
      if (!files?.length) return;
      ev.preventDefault();
      void this.upload(Array.from(files));
    });
  }

  /** A drop onto a tree node or crumb: OS files upload there, dragged rows move. */
  private async handleDrop(ev: DragEvent, nav: string): Promise<void> {
    const i = nav.indexOf(':');
    const scope: Scope = nav.slice(0, i) === 'library' ? 'library' : 'project';
    const folder = nav.slice(i + 1);
    const files = ev.dataTransfer?.files;
    if (files?.length) { await this.upload(Array.from(files), folder, scope); return; }
    const moved = ev.dataTransfer?.getData('application/x-folio-assets');
    if (!moved) return;
    const paths = JSON.parse(moved) as string[];
    await this.runBatch(paths.map(p => ({ op: 'move' as const, asset_path: p, folder })), `Moved to ${folder || 'the root'}`);
  }

  private wireKeys(): void {
    const list = this.container.querySelector<HTMLElement>('.ax-list');
    list?.setAttribute('tabindex', '0');
    list?.addEventListener('keydown', ev => {
      if (ev.key === 'a' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault(); this.sel.all(this.order); this.paintSelection(); return;
      }
      if (ev.key === 'Escape') { this.sel.clear(); this.paintSelection(); return; }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (this.sel.size) { ev.preventDefault(); void this.deleteSelection(); }
        return;
      }
      if (ev.key === 'F2') {
        const one = this.selectedAssets();
        if (one.length === 1 && one[0]) { ev.preventDefault(); void this.rename(one[0]); }
        return;
      }
      if (ev.key === 'Enter') {
        const first = this.sel.values()[0];
        const entry = this.entries().find(e => entryKey(e) === first);
        if (entry) { ev.preventDefault(); this.open(entry); }
      }
    });
  }

  // ── Actions ─────────────────────────────────────────────────────

  private open(entry: Entry): void {
    if (entry.type === 'folder') { this.navigate(`${this.scope}:${entry.folder}`); return; }
    if (entry.asset.kind === 'docs') { this.writeDoc(entry.asset); return; }
    this.place(entry.asset);
  }

  private menuFor(entry: Entry): MenuItem[] {
    if (entry.type === 'folder') {
      return [
        { label: 'Open', run: () => this.navigate(`${this.scope}:${entry.folder}`) },
        { label: 'Upload into this folder', run: () => this.pickInto(entry.folder) },
        { separator: true, label: '' },
        { label: 'Delete folder', danger: true, run: () => void this.removeFolder(entry.folder) },
      ];
    }
    const a = entry.asset;
    const many = this.sel.size > 1;
    // Count what CAN be placed, not what is selected — a font or a brief in the
    // selection is skipped, and "Place 3" that places 2 is a small lie.
    const canPlace = this.selectedAssets().filter(s => s.kind === 'images' || s.kind === 'icons').length;
    const placeable = a.kind === 'images' || a.kind === 'icons';
    return [
      ...(placeable ? [{ label: canPlace > 1 ? `Place ${canPlace} on canvas` : 'Place on canvas', run: () => this.placeSelection() }] : []),
      ...(a.kind === 'docs' ? [{ label: 'Edit text', run: () => this.writeDoc(a) }] : []),
      { label: 'Open in new tab', run: () => window.open(this.io.url(a), '_blank', 'noopener') },
      { separator: true, label: '' },
      { label: 'Rename', accel: 'F2', disabled: many, run: () => void this.rename(a) },
      { label: 'Move to folder…', run: () => void this.moveSelection() },
      { label: 'Copy path', run: () => void this.copyPath() },
      { label: 'Download', run: () => this.download(a) },
      { separator: true, label: '' },
      { label: many ? `Delete ${this.sel.size} items` : 'Delete', accel: 'Del', danger: true, run: () => void this.deleteSelection() },
    ];
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
    if (this.busy) return;
    this.busy = true;
    const { showToast } = await import('../../utils/toast');
    let ok = 0;
    for (const f of files) {
      const res = await this.io.upload(f, f.name, folder, scope);
      if (res.ok) ok++; else showToast(`${f.name}: ${res.error ?? 'failed'}`, 'warning');
    }
    this.busy = false;
    if (ok) showToast(`Uploaded ${ok} file${ok === 1 ? '' : 's'}`, 'success');
    await this.refresh();
  }

  private async newFolder(): Promise<void> {
    const hint = this.scope === 'library' ? 'e.g. "microsoft/logos"' : 'e.g. "screenshots"';
    const name = window.prompt(`New folder name (${hint}):`, '');
    if (!name?.trim()) return;
    const res = await this.io.manage({ op: 'mkdir', folder: name, scope: this.scope });
    if (!res.ok) { await this.toast(`${res.error ?? 'Could not create it'}${res.hint ? ` — ${res.hint}` : ''}`, 'warning'); return; }
    await this.refresh();
  }

  private async removeFolder(folder: string): Promise<void> {
    if (!window.confirm(`Delete the folder "${folder}"?`)) return;
    const res = await this.io.manage({ op: 'rmdir', folder, scope: this.scope });
    if (!res.ok) { await this.toast(`${res.error ?? 'Could not delete it'}${res.hint ? ` — ${res.hint}` : ''}`, 'warning'); return; }
    if (this.folder === folder) this.folder = '';
    await this.refresh();
  }

  private async rename(a: AssetRow): Promise<void> {
    const current = a.path.split('/').pop() ?? a.path;
    const next = window.prompt('Rename (keep the extension):', current);
    if (!next || next === current) return;
    await this.runBatch([{ op: 'move', asset_path: a.path, new_name: next }], `Renamed to ${next}`);
  }

  private async moveSelection(): Promise<void> {
    const picked = this.selectedAssets();
    if (!picked.length) return;
    const to = window.prompt('Move to folder (blank = root):', picked[0]?.folder ?? '');
    if (to === null) return;
    await this.runBatch(picked.map(a => ({ op: 'move' as const, asset_path: a.path, folder: to })),
      `Moved ${picked.length} to ${to || 'the root'}`);
  }

  private async deleteSelection(): Promise<void> {
    const picked = this.selectedAssets();
    if (!picked.length) return;
    const what = picked.length === 1 ? (picked[0]?.path.split('/').pop() ?? '') : `${picked.length} files`;
    if (!window.confirm(`Delete ${what}? They move to .trash, and any layer using them shows a placeholder.`)) return;
    await this.runBatch(picked.map(a => ({ op: 'delete' as const, asset_path: a.path })), `Deleted ${what}`);
  }

  /** Run manage ops in sequence and report once — a per-file toast storm on a
   *  20-file move buries the one line that mattered. */
  private async runBatch(
    ops: Array<{ op: 'move' | 'delete'; asset_path: string; folder?: string; new_name?: string }>,
    okMessage: string,
  ): Promise<void> {
    const failures: string[] = [];
    for (const body of ops) {
      const res = await this.io.manage(body);
      if (!res.ok) failures.push(`${body.asset_path.split('/').pop() ?? ''}: ${res.error ?? 'failed'}`);
    }
    if (failures.length) await this.toast(failures.slice(0, 3).join(' · '), 'warning');
    else await this.toast(okMessage, 'success');
    this.sel.clear();
    await this.refresh();
  }

  private async copyPath(): Promise<void> {
    const paths = this.selectedPaths();
    if (!paths.length) return;
    try {
      await navigator.clipboard.writeText(paths.join('\n'));
      await this.toast(paths.length === 1 ? 'Path copied' : `${paths.length} paths copied`, 'success');
    } catch {
      await this.toast('Clipboard blocked by the browser', 'warning');
    }
  }

  private download(a: AssetRow): void {
    const link = document.createElement('a');
    link.href = this.io.url(a);
    link.download = a.path.split('/').pop() ?? 'asset';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  private placeSelection(): void {
    for (const a of this.selectedAssets()) this.place(a, true);
  }

  /** Drop an asset on the canvas, scaled to fit and centred. */
  private place(a: AssetRow, quiet = false): void {
    if (a.kind === 'fonts' || a.kind === 'docs') return;
    const design = this.state.get().design;
    if (!design) return;
    const docW = design.document.width, docH = design.document.height;
    const w = a.width ?? 600, h = a.height ?? 400;
    const scale = Math.min(1, (docW * 0.6) / w, (docH * 0.6) / h);
    const lw = Math.round(w * scale), lh = Math.round(h * scale);
    const maxZ = Math.max(0, ...this.state.getCurrentLayers().map(l => l.z));
    const id = `${a.id}-${++insertCounter}`;
    this.state.addLayer({
      id, type: 'image', z: maxZ + 1,
      x: Math.round((docW - lw) / 2), y: Math.round((docH - lh) / 2),
      width: lw, height: lh,
      src: a.path, fit: 'cover',
      ...(a.alt ? { alt: a.alt } : {}),
    } as unknown as Layer);
    this.state.set('selectedLayerIds', [id]);
    if (!quiet) void this.toast(`Placed ${a.path.split('/').pop() ?? a.path}`, 'success');
  }

  private async toast(msg: string, kind: 'success' | 'warning'): Promise<void> {
    const { showToast } = await import('../../utils/toast');
    showToast(msg, kind);
  }

  /** The tree needs room; below WIDE_PX the breadcrumb does the navigating. */
  private trackWidth(): void {
    const root = this.container.querySelector<HTMLElement>('.ax');
    if (!root) return;
    const apply = (w: number): void => { root.classList.toggle('is-wide', w >= WIDE_PX); };
    apply(this.container.clientWidth);
    // The measurement above is the one that matters; the observer only keeps up
    // with a panel being dragged wider. Where it does not exist the layout is
    // still correct for the width it opened at.
    if (typeof ResizeObserver === 'undefined') return;
    this.observer?.disconnect();
    this.observer = new ResizeObserver(es => { for (const e of es) apply(e.contentRect.width); });
    this.observer.observe(this.container);
  }
}

/** '' for a top-level folder, else everything before the last segment. */
function parentOf(folder: string): string {
  const i = folder.lastIndexOf('/');
  return i < 0 ? '' : folder.slice(0, i);
}
