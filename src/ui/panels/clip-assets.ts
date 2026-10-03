// The open design's project, and the assets in it — what the Clip inspector offers to pick from (LUT files,
// footage). The editor resolves a design's asset paths through /__project_files/<project>/…, so the project
// is read back from where an asset URL points; nothing has to be handed to the panel.

import { resolveAssetUrl } from '../../renderer/render-context';

export interface ProjectAsset { path: string; kind: string }

/** The server project the open design lives in; null for a design that has none (a local file). */
export function openProject(): string | null {
  const m = /\/__project_files\/([^/]+)\//.exec(resolveAssetUrl('assets/x'));
  if (!m?.[1]) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** The editor's token, as app.ts reads it: the URL's, else the one kept for the session. */
export function editorToken(): string | undefined {
  try {
    return new URLSearchParams(location.search).get('token') ?? sessionStorage.getItem('folio_editor_token') ?? undefined;
  } catch { return undefined; }
}

export const authHeaders = (): HeadersInit => { const t = editorToken(); return t ? { Authorization: `Bearer ${t}` } : {}; };

const listed = new Map<string, Promise<ProjectAsset[]>>();

/** The project's assets (cached for the session of the page; `fresh` asks again). Empty when it cannot be listed. */
export function projectAssets(fresh = false): Promise<ProjectAsset[]> {
  const project = openProject();
  if (!project) return Promise.resolve([]);
  if (fresh) listed.delete(project);
  let p = listed.get(project);
  if (!p) {
    p = fetch(`/__project_files/${encodeURIComponent(project)}/__assets`, { credentials: 'include', headers: authHeaders() })
      .then(r => (r.ok ? r.json() as Promise<{ assets?: ProjectAsset[] }> : { assets: [] }))
      .then(j => j.assets ?? [], () => []);
    listed.set(project, p);
  }
  return p;
}
