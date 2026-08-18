// Asset explorer — standalone mount.
//
// Folio used to ship TWO asset managers: this one, in the editor's panel, and a
// second, hand-rolled drawer on the Design Library page. They shared only the
// HTTP endpoints, so a fix in one was invisible in the other — which is how the
// Library ended up with a "New folder" button that never created a folder and
// no way to delete one at all, while the editor's manager was rebuilt around it
// three times over.
//
// This entry point makes the explorer mountable anywhere: the editor imports
// AssetPanelManager directly, and the Library loads the bundle built from this
// file and calls mount(). One implementation, two front doors.
import '../../styles/asset-explorer.css';
import { AssetPanelManager } from './asset-panel';

export interface MountOptions {
  /**
   * Which store to open on.
   *
   * 'library' is the right default away from a design: the Design Library is
   * cross-project, so arriving there onto one project's folder — chosen for you
   * out of two hundred — answers a question nobody asked. The shared store is
   * the one that belongs to everything.
   */
  scope?: 'project' | 'library';
  /** Project to open. Null asks the server which projects exist and picks one. */
  project?: string | null;
  /** Token for the asset routes. Null reads it from the URL or the session. */
  token?: string | null;
  /** Start in full-window mode. The Library's drawer is already a big frame,
   *  so it mounts docked and lets its own chrome own the size. */
  full?: boolean;
}

/**
 * Put a working file manager inside `el`.
 *
 * No StateManager: there is no canvas outside the editor, so "Place on canvas"
 * stands down and opening a file previews it instead.
 */
export function mount(el: HTMLElement, opts: MountOptions = {}): AssetPanelManager {
  const panel = new AssetPanelManager(el, null);
  // A named project means someone asked for that project (a deep link), so it
  // wins over the default store.
  const scope = opts.project ? 'project' : (opts.scope ?? 'library');
  panel.setProject(opts.project ?? null, opts.token ?? null, scope);
  if (opts.full) panel.openForBrowsing();
  return panel;
}

export { AssetPanelManager };
