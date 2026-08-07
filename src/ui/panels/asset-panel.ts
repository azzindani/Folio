// Folio editor — Asset library: a file manager over the current project's
// asset store (the same set the MCP asset_list op sees).
//
// Upload from a phone, keep a shoot in a folder, search, rename, move, delete,
// and tap to place. Everything rides the authed /__project_files mount, and
// every mutation goes through the same engine ops the model uses — so what you
// upload here is immediately what an MCP call can pull by path.
import { type StateManager } from '../../editor/state';
import type { Layer } from '../../schema/types';

interface AssetRow {
  id: string;
  path: string;
  kind: 'images' | 'icons' | 'fonts' | 'docs';
  folder?: string;
  bytes: number;
  width?: number;
  height?: number;
  luminance?: string;
  alt?: string;
}

type View = 'grid' | 'list';
/** null = every folder; '' = the root (unfoldered) assets. */
type FolderFilter = string | null;

let insertCounter = 0;

const KIND_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,font/ttf,font/otf,font/woff2,font/woff,.ttf,.otf,.woff,.woff2,.md,.markdown,.txt,.csv,.json,.yaml,.yml,text/markdown,text/plain,text/csv,application/json';

export class AssetPanelManager {
  private container: HTMLElement;
  private state: StateManager;
  private project: string | null = null;
  private token: string | null = null;
  private rows: AssetRow[] = [];
  private folders: string[] = [];
  private view: View = 'grid';
  private folder: FolderFilter = null;
  private query = '';
  private busy = false;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.renderEmpty('Open a design from the Library to browse its project assets.');
  }

  setProject(project: string | null, token: string | null): void {
    this.project = project;
    this.token = token;
    this.folder = null;
    this.query = '';
    void this.refresh();
  }

  // ── Server I/O ────────────────────────────────────────────────
  private base(): string { return `/__project_files/${encodeURIComponent(this.project ?? '')}`; }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}`, ...extra } : extra;
  }

  async refresh(): Promise<void> {
    if (!this.project) {
      this.renderEmpty('Open a design from the Library to browse its project assets.');
      return;
    }
    try {
      const r = await fetch(`${this.base()}/__assets`, { credentials: 'include', headers: this.headers() });
      if (!r.ok) { this.renderEmpty(`Could not list assets (${r.status}).`); return; }
      const j = await r.json() as { ok?: boolean; assets?: AssetRow[]; folders?: string[] };
      this.rows = j.assets ?? [];
      this.folders = j.folders ?? [];
      this.render();
    } catch {
      this.renderEmpty('Could not reach the project server.');
    }
  }

  /** Upload one or more files, optionally into a folder. Sequential: the size
   *  cap is per-file and a phone upload over mobile data should fail loudly on
   *  the file that broke, not on the batch. */
  private async upload(files: FileList | File[], folder: string): Promise<void> {
    if (!this.project || this.busy) return;
    this.busy = true;
    const { showToast } = await import('../../utils/toast');
    let ok = 0;
    for (const file of Array.from(files)) {
      const seg = folder ? `${encodeURIComponent(folder)}/` : '';
      const kind = /\.(ttf|otf|woff2?)$/i.test(file.name) ? 'fonts'
        : /\.(md|markdown|txt|csv|json|ya?ml)$/i.test(file.name) ? 'docs' : 'images';
      try {
        const r = await fetch(`${this.base()}/assets/${kind}/${seg}${encodeURIComponent(file.name)}`, {
          method: 'POST', credentials: 'include',
          headers: this.headers({ 'Content-Type': file.type || 'application/octet-stream' }),
          body: file,
        });
        const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; hint?: string };
        if (r.ok && j.ok) { ok++; } else { showToast(`${file.name}: ${j.error ?? r.status}`, 'warning'); }
      } catch {
        showToast(`${file.name}: upload failed`, 'warning');
      }
    }
    this.busy = false;
    if (ok) showToast(`Uploaded ${ok} asset${ok === 1 ? '' : 's'}`, 'success');
    await this.refresh();
  }

  /** Rename / move / delete — one shell over the server's manage endpoint. */
  private async manage(body: { op: 'move' | 'delete'; asset_path: string; folder?: string; new_name?: string }): Promise<boolean> {
    if (!this.project) return false;
    const { showToast } = await import('../../utils/toast');
    try {
      const r = await fetch(`${this.base()}/__assets/manage`, {
        method: 'POST', credentials: 'include',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; hint?: string };
      if (!r.ok || !j.ok) { showToast(j.error ?? `Failed (${r.status})`, 'warning'); return false; }
      await this.refresh();
      return true;
    } catch {
      showToast('Could not reach the project server.', 'warning');
      return false;
    }
  }

  // ── Placement ─────────────────────────────────────────────────
  private insert(a: AssetRow | undefined): void {
    if (!a || a.kind === 'fonts' || a.kind === 'docs') return;
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
    void import('../../utils/toast').then(({ showToast }) => showToast(`Inserted ${a.path}`, 'success'));
  }

  /** Rows after the folder filter and the search box.
   *  Placeable art sorts above fonts — you open this panel to drop an image far
   *  more often than to check which typeface is loaded. */
  private visible(): AssetRow[] {
    const q = this.query.trim().toLowerCase();
    const rank = (r: AssetRow): number => (r.kind === 'images' || r.kind === 'icons' ? 0 : 1);
    return this.rows
      .filter(r => this.folder === null || (r.folder ?? '') === this.folder)
      .filter(r => !q || r.path.toLowerCase().includes(q) || (r.alt ?? '').toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  }

  private url(a: AssetRow): string {
    return `${this.base()}/${a.path.split('/').map(encodeURIComponent).join('/')}`;
  }

  private renderEmpty(msg: string): void {
    this.container.innerHTML = `<div class="asset-lib-empty">${msg}</div>`;
  }

  // ── Render ────────────────────────────────────────────────────
  private render(): void {
    const rows = this.visible();
    const chips = [
      this.chip('All', this.folder === null, 'all'),
      this.chip('Root', this.folder === '', ''),
      ...this.folders.map(f => this.chip(f, this.folder === f, f)),
    ].join('');

    this.container.innerHTML = `
      <div class="asset-lib">
        <div class="asset-lib-bar">
          <button class="asset-lib-btn asset-lib-primary" data-act="upload">＋ Upload</button>
          <button class="asset-lib-btn" data-act="write" title="Write a markdown or text file into this project">✎ Write</button>
          <button class="asset-lib-btn" data-act="newfolder" title="Upload into a new folder">New folder</button>
          <button class="asset-lib-btn asset-lib-icon" data-act="view" title="${this.view === 'grid' ? 'List view' : 'Grid view'}">${this.view === 'grid' ? '☰' : '▦'}</button>
          <button class="asset-lib-btn asset-lib-icon" data-act="refresh" title="Refresh">↻</button>
        </div>
        <input class="asset-lib-search" type="search" placeholder="Search assets…" value="${esc(this.query)}" data-act="search">
        <div class="asset-lib-chips">${chips}</div>
        <div class="asset-lib-body ${this.view}">
          ${rows.length ? rows.map((a, i) => this.cell(a, i)).join('') : `<div class="asset-lib-empty">${this.rows.length ? 'Nothing matches that filter.' : 'No assets yet. Upload one — or drop an image on the canvas.'}</div>`}
        </div>
        <div class="asset-lib-foot">${this.rows.length} asset${this.rows.length === 1 ? '' : 's'} · ${esc(this.project ?? '')}</div>
        <input type="file" multiple accept="${KIND_ACCEPT}" class="asset-lib-file" hidden>
      </div>`;

    this.wire(rows);
  }

  private chip(label: string, active: boolean, value: string): string {
    return `<button class="asset-lib-chip${active ? ' active' : ''}" data-folder="${esc(value)}">${esc(label)}</button>`;
  }

  private cell(a: AssetRow, i: number): string {
    const dims = a.width ? `${a.width}×${a.height}` : '';
    const name = a.path.split('/').pop() ?? a.path;
    const kb = `${Math.max(1, Math.round(a.bytes / 1024))} KB`;
    const meta = [dims, kb, a.folder ?? ''].filter(Boolean).join(' · ');
    const thumb = a.kind === 'docs'
      ? `<div class="asset-lib-thumb asset-lib-font">\u{1F4C4}</div>`
      : a.kind === 'fonts'
      ? `<div class="asset-lib-thumb asset-lib-font">Aa</div>`
      : `<img class="asset-lib-thumb" src="${this.url(a)}" alt="${esc(a.alt ?? name)}" loading="lazy">`;
    return `
      <div class="asset-lib-item" data-idx="${i}">
        <button class="asset-lib-place" data-act="insert" data-idx="${i}" title="Place ${esc(name)}">
          ${thumb}
          <span class="asset-lib-name">${esc(name)}</span>
          <span class="asset-lib-meta">${esc(meta)}</span>
        </button>
        <div class="asset-lib-actions">
          ${a.kind === 'docs' ? `<button class="asset-lib-act" data-act="editdoc" data-idx="${i}" title="Edit text">Edit</button>` : ''}
          <button class="asset-lib-act" data-act="rename" data-idx="${i}" title="Rename">Rename</button>
          <button class="asset-lib-act" data-act="movefolder" data-idx="${i}" title="Move to folder">Move</button>
          <button class="asset-lib-act danger" data-act="delete" data-idx="${i}" title="Delete">Delete</button>
        </div>
      </div>`;
  }

  private wire(rows: AssetRow[]): void {
    const q = <T extends HTMLElement>(sel: string): T | null => this.container.querySelector<T>(sel);
    const fileInput = q<HTMLInputElement>('.asset-lib-file');

    // A folder chosen by "New folder" applies to the NEXT upload only — the
    // picker is the moment the operator is thinking about where it goes.
    let pendingFolder: string | null = null;
    fileInput?.addEventListener('change', () => {
      const files = fileInput.files;
      if (files && files.length) void this.upload(files, pendingFolder ?? (this.folder ?? ''));
      pendingFolder = null;
      fileInput.value = '';
    });

    q('[data-act="upload"]')?.addEventListener('click', () => fileInput?.click());
    q('[data-act="newfolder"]')?.addEventListener('click', () => {
      const name = window.prompt('Upload into which folder?', this.folder || 'screenshots');
      if (name === null) return;
      pendingFolder = name;
      fileInput?.click();
    });
    q('[data-act="write"]')?.addEventListener('click', () => this.openEditor());
    q('[data-act="view"]')?.addEventListener('click', () => { this.view = this.view === 'grid' ? 'list' : 'grid'; this.render(); });
    q('[data-act="refresh"]')?.addEventListener('click', () => void this.refresh());

    const search = q<HTMLInputElement>('.asset-lib-search');
    search?.addEventListener('input', () => {
      this.query = search.value;
      const body = q('.asset-lib-body');
      const visible = this.visible();
      if (body) body.innerHTML = visible.length ? visible.map((a, i) => this.cell(a, i)).join('') : `<div class="asset-lib-empty">Nothing matches that filter.</div>`;
      this.wireItems(visible);
    });

    this.container.querySelectorAll<HTMLElement>('.asset-lib-chip').forEach(el => {
      el.addEventListener('click', () => {
        const v = el.dataset['folder'] ?? '';
        this.folder = v === 'all' ? null : v;
        this.render();
      });
    });

    this.wireItems(rows);
  }

  private wireItems(rows: AssetRow[]): void {
    this.container.querySelectorAll<HTMLElement>('[data-act][data-idx]').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const a = rows[Number(el.dataset['idx'])];
        if (!a) return;
        const act = el.dataset['act'];
        if (act === 'insert') { this.insert(a); return; }
        if (act === 'editdoc') { this.openEditor(a); return; }
        if (act === 'rename') { void this.promptRename(a); return; }
        if (act === 'movefolder') { void this.promptMove(a); return; }
        if (act === 'delete') { void this.promptDelete(a); return; }
      });
    });
  }

  // ── Write / edit a text asset ─────────────────────────────────
  // A brief does not have to arrive as a file: type it here and it lands in
  // assets/docs/ exactly as an upload would, ready for an MCP asset_read.
  // Saving posts plain text to the upload route — the server ingests by
  // filename, so the extension alone decides where it goes.
  private openEditor(a?: AssetRow): void {
    if (!this.project) return;
    const name = a ? (a.path.split('/').pop() ?? '') : '';
    const folder = a ? (a.folder ?? '') : (this.folder ?? '');
    this.container.innerHTML = `
      <div class="asset-lib asset-lib-editor">
        <div class="asset-lib-bar">
          <input class="asset-lib-fname" type="text" placeholder="brief.md" value="${esc(name)}" ${a ? 'readonly' : ''} aria-label="File name">
          <button class="asset-lib-btn asset-lib-primary" data-act="dsave">Save</button>
          <button class="asset-lib-btn" data-act="dcancel">Cancel</button>
        </div>
        <textarea class="asset-lib-text" spellcheck="false" placeholder="# Brief&#10;&#10;Paste the copy, links and notes the design should be built from."></textarea>
        <div class="asset-lib-foot">${folder ? `assets/docs/${esc(folder)}/` : 'assets/docs/'} · md, txt, csv, json, yaml</div>
      </div>`;

    const fname = this.container.querySelector<HTMLInputElement>('.asset-lib-fname');
    const text = this.container.querySelector<HTMLTextAreaElement>('.asset-lib-text');
    this.container.querySelector('[data-act="dcancel"]')?.addEventListener('click', () => this.render());
    this.container.querySelector('[data-act="dsave"]')?.addEventListener('click', () => {
      void this.saveDoc(fname?.value ?? '', folder, text?.value ?? '');
    });
    if (a && text) {
      text.value = 'Loading…';
      text.disabled = true;
      void fetch(this.url(a), { credentials: 'include', headers: this.headers() })
        .then(r => r.ok ? r.text() : Promise.reject(new Error(String(r.status))))
        .then(t => { text.value = t; text.disabled = false; })
        .catch(() => { text.value = ''; text.disabled = false; void import('../../utils/toast').then(({ showToast }) => showToast('Could not read that file.', 'warning')); });
    } else {
      fname?.focus();
    }
  }

  private async saveDoc(name: string, folder: string, text: string): Promise<void> {
    const { showToast } = await import('../../utils/toast');
    const clean = name.trim();
    if (!/\.(md|markdown|txt|csv|json|ya?ml)$/i.test(clean)) {
      showToast('Text files only: .md, .markdown, .txt, .csv, .json, .yaml', 'warning');
      return;
    }
    if (!text) { showToast('The file is empty — write something first.', 'warning'); return; }
    const seg = folder ? `${encodeURIComponent(folder)}/` : '';
    try {
      const r = await fetch(`${this.base()}/assets/docs/${seg}${encodeURIComponent(clean)}`, {
        method: 'POST', credentials: 'include',
        headers: this.headers({ 'Content-Type': 'text/plain;charset=utf-8' }),
        body: text,
      });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) { showToast(j.error ?? `Save failed (${r.status})`, 'warning'); return; }
      showToast(`Saved ${clean}`, 'success');
      await this.refresh();
    } catch {
      showToast('Could not reach the project server.', 'warning');
    }
  }

  private async promptRename(a: AssetRow): Promise<void> {
    const current = a.path.split('/').pop() ?? a.path;
    const next = window.prompt('Rename asset (keep the extension):', current);
    if (!next || next === current) return;
    await this.manage({ op: 'move', asset_path: a.path, new_name: next });
  }

  private async promptMove(a: AssetRow): Promise<void> {
    const next = window.prompt('Move to folder (blank = project root):', a.folder ?? '');
    if (next === null) return;
    await this.manage({ op: 'move', asset_path: a.path, folder: next });
  }

  private async promptDelete(a: AssetRow): Promise<void> {
    const name = a.path.split('/').pop() ?? a.path;
    if (!window.confirm(`Delete ${name}? It moves to .trash and any layer using it shows a placeholder.`)) return;
    await this.manage({ op: 'delete', asset_path: a.path });
  }
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
