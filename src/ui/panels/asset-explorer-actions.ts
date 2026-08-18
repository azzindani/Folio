// Asset explorer — the right-click menu, and the two leaf actions that need
// nothing from the panel but a path.
//
// The menu mirrors the command bar rather than offering a second, different set
// of verbs. Two menus with different contents is how people learn to distrust
// both; the bar is for discovery, the menu is for reach.
import type { Entry } from './asset-explorer-view';
import type { AssetRow, ManageBody, ManageResult, Scope } from './asset-explorer-io';
import { openMenu, type MenuItem } from './asset-explorer-menu';
import { getClip } from './asset-explorer-clipboard';

export interface MenuHandlers {
  open(nav: string): void;
  uploadInto(folder: string): void;
  newFolderIn(folder: string): void;
  renameFolder(folder: string): void;
  moveFolder(folder: string): void;
  deleteFolders(folders: string[]): void;
  place(): void;
  editDoc(a: AssetRow): void;
  openTab(a: AssetRow): void;
  cut(): void;
  copy(): void;
  paste(): void;
  rename(a: AssetRow): void;
  move(): void;
  copyPath(): void;
  download(a: AssetRow): void;
  remove(): void;
}

export interface MenuContext {
  scope: Scope;
  selectedFolders: string[];
  selectedFiles: number;
  /** How many of the selected files can actually go on the canvas. */
  placeable: number;
  on: MenuHandlers;
}

export function entryMenu(entry: Entry, ctx: MenuContext): MenuItem[] {
  const { on } = ctx;
  if (entry.type === 'folder') {
    const folders = ctx.selectedFolders;
    const many = folders.length > 1;
    return [
      { label: 'Open', run: () => on.open(`${ctx.scope}:${entry.folder}`) },
      { label: 'Upload into this folder', run: () => on.uploadInto(entry.folder) },
      { label: 'New folder inside', run: () => on.newFolderIn(entry.folder) },
      ...(getClip() ? [{ label: 'Paste into this folder', run: () => { on.open(`${ctx.scope}:${entry.folder}`); on.paste(); } }] : []),
      { separator: true, label: '' },
      { label: 'Rename', accel: 'F2', disabled: many, run: () => on.renameFolder(entry.folder) },
      { label: 'Move to folder…', disabled: many, run: () => on.moveFolder(entry.folder) },
      {
        label: many ? `Delete ${folders.length} folders` : 'Delete folder',
        accel: 'Del', danger: true,
        run: () => on.deleteFolders(many ? folders : [entry.folder]),
      },
    ];
  }

  const a = entry.asset;
  const many = ctx.selectedFiles > 1;
  const placeable = a.kind === 'images' || a.kind === 'icons';
  return [
    // Count what CAN be placed, not what is selected — a font or a brief in the
    // selection is skipped, and "Place 3" that places 2 is a small lie.
    ...(placeable ? [{ label: ctx.placeable > 1 ? `Place ${ctx.placeable} on canvas` : 'Place on canvas', run: () => on.place() }] : []),
    ...(a.kind === 'docs' ? [{ label: 'Edit text', run: () => on.editDoc(a) }] : []),
    { label: 'Open in new tab', run: () => on.openTab(a) },
    { separator: true, label: '' },
    { label: 'Cut', accel: 'Ctrl+X', run: () => on.cut() },
    { label: 'Copy', accel: 'Ctrl+C', run: () => on.copy() },
    { label: 'Paste', accel: 'Ctrl+V', disabled: !getClip(), run: () => on.paste() },
    { separator: true, label: '' },
    { label: 'Rename', accel: 'F2', disabled: many, run: () => on.rename(a) },
    { label: 'Move to folder…', run: () => on.move() },
    { label: 'Copy path', run: () => on.copyPath() },
    { label: 'Download', run: () => on.download(a) },
    { separator: true, label: '' },
    { label: many ? `Delete ${ctx.selectedFiles} items` : 'Delete', accel: 'Del', danger: true, run: () => on.remove() },
  ];
}

/** Put the selected paths on the system clipboard — the form an MCP call wants. */
export async function copyPaths(
  paths: string[],
  toast: (message: string, kind: 'success' | 'warning') => Promise<void>,
): Promise<void> {
  if (!paths.length) return;
  try {
    await navigator.clipboard.writeText(paths.join('\n'));
    await toast(paths.length === 1 ? 'Path copied' : `${paths.length} paths copied`, 'success');
  } catch {
    await toast('Clipboard blocked by the browser', 'warning');
  }
}

/** Save a stored asset to the machine. */
export function downloadAsset(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Upload a batch, one file at a time, and report once.
 *
 * Sequential on purpose: the size cap is per file, so a phone upload over
 * mobile data should fail loudly on the file that broke rather than lose the
 * whole batch. Failures are named individually; success is a single line.
 */
export async function uploadFiles(
  io: { upload(file: Blob, name: string, folder: string, scope: Scope): Promise<{ ok: boolean; error?: string }> },
  files: File[],
  folder: string,
  scope: Scope,
  toast: (message: string, kind: 'success' | 'warning') => Promise<void>,
): Promise<number> {
  let ok = 0;
  for (const f of files) {
    const res = await io.upload(f, f.name, folder, scope);
    if (res.ok) ok++; else await toast(`${f.name}: ${res.error ?? 'failed'}`, 'warning');
  }
  if (ok) await toast(`Uploaded ${ok} file${ok === 1 ? '' : 's'}`, 'success');
  return ok;
}

/**
 * Run manage ops in sequence and report once.
 *
 * A per-file toast on a twenty-file move buries the one line that mattered, so
 * only the first few failures are shown — the rest are still counted.
 */
export async function runBatch(
  io: { manage(body: ManageBody): Promise<ManageResult> },
  ops: ManageBody[],
  okMessage: string,
  toast: (message: string, kind: 'success' | 'warning') => Promise<void>,
): Promise<void> {
  const failures: string[] = [];
  for (const body of ops) {
    const res = await io.manage(body);
    if (!res.ok) failures.push(`${(body.asset_path ?? '').split('/').pop() ?? ''}: ${res.error ?? 'failed'}`);
  }
  if (failures.length) await toast(failures.slice(0, 3).join(' · '), 'warning');
  else await toast(okMessage, 'success');
}

/** What the tree's right-click menu needs from the panel. */
export interface TreeMenuCtx {
  currentProject: string | null;
  openProject(name: string): void;
  navigate(nav: string): void;
  newFolder(): void;
  uploadInto(folder: string): void;
  setScope(scope: Scope): void;
  selectFolder(folder: string): void;
  menuFor(entry: Entry): MenuItem[];
  countIn(folder: string): number;
}

/**
 * Right-click on a node in the folder tree.
 *
 * The tree is where a file manager expects folders to be MANAGED, not merely
 * walked. This used to open nothing at all, so the only route to deleting a
 * folder was to navigate to its parent and find the row again — which is how
 * someone ends up asking how folders get deleted in the first place.
 */
export function treeNodeMenu(
  ev: MouseEvent, nav: string, project: string | null, ctx: TreeMenuCtx,
): void {
  const [rawScope, ...rest] = nav.split(':');
  const scope: Scope = rawScope === 'library' ? 'library' : 'project';
  const folder = rest.join(':');

  // A project or a store root is a container, not a folder: no Rename, no
  // Delete — only the verbs that make sense on a place.
  if (!folder) {
    const other = Boolean(project) && project !== ctx.currentProject;
    openMenu(ev.clientX, ev.clientY, [
      { label: 'Open', run: () => (other && project ? ctx.openProject(project) : ctx.navigate(nav)) },
      ...(other ? [] : [
        { label: 'New folder', run: () => { ctx.navigate(nav); ctx.newFolder(); } },
        { label: 'Upload files…', run: () => { ctx.navigate(nav); ctx.uploadInto(''); } },
      ]),
    ]);
    return;
  }

  // Act on what was pointed at: without selecting it first, "Delete" would
  // describe whatever happened to be selected over in the file pane.
  ctx.setScope(scope);
  ctx.selectFolder(folder);
  openMenu(ev.clientX, ev.clientY, ctx.menuFor({
    type: 'folder',
    name: folder.split('/').pop() ?? folder,
    folder,
    count: ctx.countIn(folder),
  }));
}
