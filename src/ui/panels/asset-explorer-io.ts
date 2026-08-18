// Asset explorer — everything that talks to the project server.
//
// Split from the panel so the UI file stays about interaction. Every call
// lands on a route that shares its engine function with the matching MCP asset
// op, so a file uploaded here is one an MCP call can immediately resolve by
// path — there is no second store and no sync step.

/** One stored asset. Library rows are recognisable by a "lib/" path. */
export interface AssetRow {
  id: string;
  path: string;
  kind: 'images' | 'icons' | 'fonts' | 'docs';
  folder?: string;
  bytes: number;
  width?: number;
  height?: number;
  luminance?: string;
  alt?: string;
  added?: string;
}

export interface Listing {
  assets: AssetRow[];
  folders: string[];
  libraryFolders: string[];
}

export interface ProjectRow {
  name: string;
  designs: number;
  assets: number;
}

export type Scope = 'project' | 'library';

export interface ManageBody {
  op: 'move' | 'copy' | 'delete' | 'mkdir' | 'rmdir';
  asset_path?: string;
  folder?: string;
  new_name?: string;
  scope?: Scope;
  /** Source project for a cross-project copy. */
  from_project?: string;
}

export interface ManageResult {
  ok: boolean;
  /** Where a copy landed. */
  path?: string;
  error?: string;
  hint?: string;
}

/** Shared-library assets are recognisable by their path alone. */
export function isShared(p: string): boolean {
  return p.startsWith('lib/');
}

/** Which store a row lives in. */
export function storeOf(a: AssetRow): Scope {
  return isShared(a.path) ? 'library' : 'project';
}

/** The kind folder an uploaded file belongs in, decided by extension — the
 *  same rule the server's ingest applies, so the client can show the
 *  destination before the upload starts. */
export function kindForFile(name: string): AssetRow['kind'] {
  if (/\.(ttf|otf|woff2?)$/i.test(name)) return 'fonts';
  if (/\.(md|markdown|txt|csv|json|ya?ml)$/i.test(name)) return 'docs';
  return 'images';
}

export class AssetIO {
  private project: string | null = null;
  private token: string | null = null;

  setContext(project: string | null, token: string | null): void {
    this.project = project;
    this.token = token;
  }

  get projectName(): string | null { return this.project; }

  base(): string { return `/__project_files/${encodeURIComponent(this.project ?? '')}`; }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}`, ...extra } : extra;
  }

  /** Public URL of a stored asset — also what a download link points at. */
  url(a: AssetRow): string {
    return `${this.base()}/${a.path.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** Every project on the server. Lets the manager open with no design loaded. */
  async projects(): Promise<ProjectRow[]> {
    try {
      const r = await fetch('/__project_files/__projects', { credentials: 'include', headers: this.headers() });
      if (!r.ok) return [];
      const j = await r.json() as { projects?: ProjectRow[] };
      return j.projects ?? [];
    } catch { return []; }
  }

  async list(): Promise<Listing | { error: string }> {
    if (!this.project) return { error: 'No project selected.' };
    try {
      const r = await fetch(`${this.base()}/__assets`, { credentials: 'include', headers: this.headers() });
      if (!r.ok) return { error: `Could not list assets (${r.status}).` };
      const j = await r.json() as { assets?: AssetRow[]; folders?: string[]; library_folders?: string[] };
      return { assets: j.assets ?? [], folders: j.folders ?? [], libraryFolders: j.library_folders ?? [] };
    } catch {
      return { error: 'Could not reach the project server.' };
    }
  }

  /**
   * Upload one file. Sequential at the call site on purpose: the size cap is
   * per file, and a phone upload over mobile data should fail loudly on the
   * file that broke rather than lose the whole batch.
   */
  async upload(file: Blob, name: string, folder: string, scope: Scope): Promise<{ ok: boolean; error?: string }> {
    const kind = kindForFile(name);
    // The library takes its folder as a query param: it nests
    // ("microsoft/logos") and a URL path segment cannot carry the slash.
    const seg = scope === 'library' || !folder ? '' : `${encodeURIComponent(folder)}/`;
    const qs = scope === 'library' ? `?scope=library&folder=${encodeURIComponent(folder)}` : '';
    try {
      const r = await fetch(`${this.base()}/assets/${kind}/${seg}${encodeURIComponent(name)}${qs}`, {
        method: 'POST',
        credentials: 'include',
        headers: this.headers({ 'Content-Type': file.type || 'application/octet-stream' }),
        body: file,
      });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      return r.ok && j.ok ? { ok: true } : { ok: false, error: j.error ?? `HTTP ${r.status}` };
    } catch {
      return { ok: false, error: 'upload failed' };
    }
  }

  /** rename · move · copy · delete · mkdir · rmdir — one shell over the route. */
  async manage(body: ManageBody): Promise<ManageResult> {
    return this.manageIn(this.project, body);
  }

  /**
   * Run a manage op against a NAMED project rather than the open one.
   *
   * Needed by paste: cutting an asset from project A into project B copies it
   * into B and then deletes the original — and that delete has to be addressed
   * to A, or the paste removes the file it just created.
   */
  async manageIn(project: string | null, body: ManageBody): Promise<ManageResult> {
    if (!project) return { ok: false, error: 'No project selected.' };
    try {
      const r = await fetch(`/__project_files/${encodeURIComponent(project)}/__assets/manage`, {
        method: 'POST',
        credentials: 'include',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; hint?: string; path?: string };
      if (!r.ok || !j.ok) return { ok: false, error: j.error ?? `Failed (${r.status})`, hint: j.hint ?? '' };
      return { ok: true, ...(j.path ? { path: j.path } : {}) };
    } catch {
      return { ok: false, error: 'Could not reach the project server.' };
    }
  }

  /** Create a project. Projects are containers, not files — their own verb. */
  async createProject(name: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await fetch('/__project_files/__projects', {
        method: 'POST',
        credentials: 'include',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name }),
      });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      return r.ok && j.ok ? { ok: true } : { ok: false, error: j.error ?? `Failed (${r.status})` };
    } catch {
      return { ok: false, error: 'Could not reach the project server.' };
    }
  }

  /** Read a text asset (the doc editor's Open). */
  async readText(a: AssetRow): Promise<string | null> {
    try {
      const r = await fetch(this.url(a), { credentials: 'include', headers: this.headers() });
      return r.ok ? await r.text() : null;
    } catch { return null; }
  }
}
