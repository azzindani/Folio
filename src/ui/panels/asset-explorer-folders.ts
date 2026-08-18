// Asset explorer — folder verbs: make, rename, move, delete.
//
// The store has no "rename a directory" or "move a directory" call, because a
// folder there is not an object — it is the shape of the paths inside it. So
// each of these is: make the destination, walk the files across, drop the old
// one. Kept in one place so that sequence is written once and every entry point
// (menu, keyboard, drag) gets the same behaviour.
import type { AssetIO, AssetRow, Scope } from './asset-explorer-io';
import { storeOf } from './asset-explorer-io';
import { promptDialog, confirmDialog, renameDialog } from './asset-explorer-dialog';

export interface FolderCtx {
  io: AssetIO;
  scope: Scope;
  /** The folder currently open — where a new one is created. */
  folder: string;
  rows: AssetRow[];
  /** Every folder path in the store being shown. */
  folders: string[];
  toast(message: string, kind: 'success' | 'warning'): Promise<void>;
}

/** '' for a top-level folder, else everything before the last segment. */
export function parentOf(folder: string): string {
  const i = folder.lastIndexOf('/');
  return i < 0 ? '' : folder.slice(0, i);
}

const leafOf = (folder: string): string => folder.split('/').pop() ?? folder;
const isUnder = (folder: string, root: string): boolean =>
  folder === root || folder.startsWith(`${root}/`);

/** Files anywhere below a folder, with the sub-path they sit at. */
function contents(ctx: FolderCtx, root: string): Array<{ row: AssetRow; rest: string }> {
  return ctx.rows
    .filter(r => storeOf(r) === ctx.scope && isUnder(r.folder ?? '', root))
    .map(row => ({ row, rest: (row.folder ?? '').slice(root.length).replace(/^\//, '') }));
}

/** Everything at ANY depth below a folder — what a delete will actually take. */
export function countUnder(ctx: FolderCtx, folder: string): number {
  return contents(ctx, folder).length
    + ctx.folders.filter(f => f.startsWith(`${folder}/`)).length;
}

/**
 * Create a folder INSIDE the one that is open, and return where to go next.
 *
 * The name is joined to the current folder rather than used as an absolute
 * path. Sending it absolute is what made "New folder" look intermittent: it
 * worked at the root and, from anywhere deeper, created the folder somewhere
 * else and showed nothing.
 */
export async function createFolder(ctx: FolderCtx): Promise<string | null> {
  const name = await promptDialog({
    title: 'New folder',
    label: `Inside ${ctx.folder || (ctx.scope === 'library' ? 'the shared library' : 'the project root')}`,
    placeholder: 'screenshots',
    confirm: 'Create',
  });
  if (!name) return null;
  const folder = ctx.folder ? `${ctx.folder}/${name.trim()}` : name.trim();
  const res = await ctx.io.manage({ op: 'mkdir', folder, scope: ctx.scope });
  if (!res.ok) {
    await ctx.toast(`${res.error ?? 'Could not create it'}${res.hint ? ` — ${res.hint}` : ''}`, 'warning');
    return null;
  }
  return folder;
}

/** Delete folders and everything under them. Returns where to navigate, if the
 *  place you were standing is one of the things that just went away. */
export async function deleteFolders(ctx: FolderCtx, folders: string[]): Promise<{ ok: boolean; goTo?: string }> {
  if (!folders.length) return { ok: false };
  const held = folders.reduce((n, f) => n + countUnder(ctx, f), 0);
  const what = folders.length === 1 ? `the folder "${leafOf(folders[0] ?? '')}"` : `${folders.length} folders`;
  const confirmed = await confirmDialog({
    title: folders.length === 1 ? 'Delete folder' : 'Delete folders',
    body: held
      ? `Delete ${what} and the ${held} item${held === 1 ? '' : 's'} inside? Everything moves to .trash.`
      : `Delete ${what}?`,
    confirm: 'Delete',
    danger: true,
  });
  if (!confirmed) return { ok: false };

  for (const folder of folders) {
    const res = await ctx.io.manage({ op: 'rmdir', folder, scope: ctx.scope });
    if (!res.ok) {
      await ctx.toast(`${res.error ?? 'Could not delete it'}${res.hint ? ` — ${res.hint}` : ''}`, 'warning');
      return { ok: false };
    }
  }
  const stranded = folders.find(f => isUnder(ctx.folder, f));
  return { ok: true, ...(stranded ? { goTo: parentOf(stranded) } : {}) };
}

export async function renameFolder(ctx: FolderCtx, folder: string): Promise<string | null> {
  const next = await renameDialog(leafOf(folder));
  if (!next || next === leafOf(folder)) return null;
  const parent = parentOf(folder);
  return relocate(ctx, folder, parent ? `${parent}/${next.trim()}` : next.trim());
}

/** Ask where to move a folder, then move it. */
export async function promptMoveFolder(ctx: FolderCtx, folder: string): Promise<string | null> {
  const to = await promptDialog({
    title: `Move "${leafOf(folder)}"`,
    label: 'Destination folder — blank is the root',
    value: parentOf(folder),
    placeholder: 'clients/acme',
    confirm: 'Move',
  });
  if (to === null) return null;
  return moveFolderInto(ctx, folder, to.trim().replace(/^\/+|\/+$/g, ''));
}

/** Move a folder so it sits inside `parent`. Returns its new path, or null. */
export async function moveFolderInto(ctx: FolderCtx, folder: string, parent: string): Promise<string | null> {
  const target = parent ? `${parent}/${leafOf(folder)}` : leafOf(folder);
  if (target === folder) return null;
  // Dropping a folder inside itself would move its own contents underneath the
  // path being deleted — the classic way a file manager eats your work.
  if (isUnder(parent, folder)) {
    await ctx.toast('A folder cannot be moved inside itself', 'warning');
    return null;
  }
  return relocate(ctx, folder, target);
}

/**
 * The shared mechanic behind rename and move: make the destination, carry every
 * file across at the same relative depth, then drop the old tree.
 *
 * Files move one at a time through the same op the model uses, so a half-done
 * move leaves real files in real places rather than a corrupt half-state.
 */
async function relocate(ctx: FolderCtx, from: string, to: string): Promise<string | null> {
  if (ctx.folders.includes(to)) {
    await ctx.toast(`"${leafOf(to)}" already exists here`, 'warning');
    return null;
  }
  const made = await ctx.io.manage({ op: 'mkdir', folder: to, scope: ctx.scope });
  if (!made.ok) {
    await ctx.toast(made.error ?? 'Could not create the destination', 'warning');
    return null;
  }
  // Recreate the subfolder structure BEFORE moving anything. Moving files alone
  // rebuilds only the folders that happen to contain one, so an empty subfolder
  // silently disappeared when its parent was renamed — the folder was there
  // before the rename and gone after it, with nothing said.
  for (const sub of ctx.folders.filter(f => f.startsWith(`${from}/`)).sort()) {
    await ctx.io.manage({ op: 'mkdir', folder: `${to}${sub.slice(from.length)}`, scope: ctx.scope });
  }
  const items = contents(ctx, from);
  for (const { row, rest } of items) {
    const dest = rest ? `${to}/${rest}` : to;
    const res = await ctx.io.manage({ op: 'move', asset_path: row.path, folder: dest });
    if (!res.ok) {
      await ctx.toast(`${row.path.split('/').pop() ?? ''}: ${res.error ?? 'move failed'}`, 'warning');
      return null;
    }
  }
  // Only now is the source safe to remove: everything that was in it is
  // somewhere else, so this deletes empty directories, not work.
  await ctx.io.manage({ op: 'rmdir', folder: from, scope: ctx.scope });
  await ctx.toast(`Moved to ${to}`, 'success');
  return to;
}
