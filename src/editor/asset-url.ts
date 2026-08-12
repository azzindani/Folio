// One rule for turning a design's asset src into a URL the editor can fetch.
//
// Both stores go through the SAME project-scoped mount: a "lib/…" src is
// requested as /__project_files/<project>/lib/… and the server falls back to
// the shared library when the project doesn't hold that path. That keeps the
// editor's lookup order identical to the server-side render resolver's
// (project first, library second) — so a project that shadows a shared asset
// shows the same file on canvas as it does in the exported PNG.
const enc = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

export function assetUrl(project: string, src: string): string {
  return `/__project_files/${encodeURIComponent(project)}/${enc(String(src ?? ''))}`;
}
