// Folio editor — the server-backed project's assets.
//
// A design opened from the library lives inside a PROJECT, and its images and
// fonts live beside it under `assets/`. Two things follow from that, and both
// are here rather than in app.ts (which is at its line budget): relative image
// srcs resolve through the authed `/__project_files` mount, and an image
// dropped on the canvas becomes a file in the project rather than a base64
// blob inside the YAML.
import { setAssetUrlResolver } from '../renderer/render-context';
import { loadProjectFonts as registerFonts } from '../styles/font-loader';
import { assetUrl } from './asset-url';
import type { ImageImportHandler } from './image-import-handler';

/** What the app lends this module: a token reader and the drop handler. */
export interface ProjectAssetHost {
  readToken(): string | undefined;
  imageImport: ImageImportHandler;
  openAssetPanel(project: string, token: string | null): void;
}

const authed = (token: string | undefined): HeadersInit =>
  token ? { Authorization: `Bearer ${token}` } : {};

/**
 * Point the renderer, the asset panel and image drops at `designRel`'s project.
 *
 * `designRel` is the design's path relative to the projects dir, so its first
 * segment names the project.
 */
export function wireProjectAssets(host: ProjectAssetHost, designRel: string): void {
  const project = designRel.split('/')[0];
  if (!project) return;
  setAssetUrlResolver((src) => assetUrl(project, src));
  host.openAssetPanel(project, host.readToken() ?? null);
  void loadFonts(host, project);
  host.imageImport.setUploader(async (name, blob) => {
    try {
      const r = await fetch(`/__project_files/${encodeURIComponent(project)}/assets/images/${encodeURIComponent(name)}`, {
        method: 'POST', credentials: 'include', body: blob,
        headers: authed(host.readToken()),
      });
      if (!r.ok) return null;
      const j = await r.json() as { ok?: boolean; asset?: { path?: string } };
      return j.ok && j.asset?.path ? j.asset.path : null;
    } catch { return null; }
  });
}

/**
 * Register the project's uploaded TTF/OTF families with the FontFace API so the
 * live editor renders them — matching resvg raster and vector PDF, which read
 * the same files server-side. Best-effort: a listing failure just leaves the
 * editor on fallback fonts.
 */
export async function loadFonts(host: ProjectAssetHost, project: string): Promise<void> {
  try {
    const r = await fetch(`/__project_files/${encodeURIComponent(project)}/__assets`, {
      credentials: 'include', headers: authed(host.readToken()),
    });
    if (!r.ok) return;
    const j = await r.json() as { ok?: boolean; assets?: Array<{ path: string; kind: string }> };
    const fonts = (j.assets ?? []).filter(a => a.kind === 'fonts');
    if (fonts.length === 0) return;
    registerFonts(fonts, (p) => assetUrl(project, p));
  } catch { /* offline / unauthed — fallback fonts are fine */ }
}
