// Asset explorer — keyboard.
//
// The same shortcuts the desktop uses, because muscle memory is the whole
// reason to look like a file manager. Anything that mutates goes through the
// panel's own confirm dialogs, so Delete here is no more dangerous than Delete
// from the command bar.
export interface KeyHost {
  selectAll(): void;
  clearSelection(): void;
  /** Delete the selection (asks first). */
  remove(): void;
  /** Rename whichever single thing is selected. */
  rename(): void;
  /** Open the first selected item — a folder navigates, a file opens/places. */
  openSelected(): void;
  cut(): void;
  copy(): void;
  paste(): void;
  hasSelection(): boolean;
  canPaste(): boolean;
}

/**
 * Bind the manager's shortcuts.
 *
 * Bound to the PANEL, not to the file list: after clicking a folder in the tree
 * the focus sits on that button, and a listener on the list alone would silently
 * ignore the Ctrl+V that follows — which is exactly the moment you want to
 * paste. Typing in a field is excluded so Ctrl+A in the search box still selects
 * text rather than every file.
 *
 * The pane keeps its own tabindex so it can take focus and scroll on its own,
 * and so keys reach here instead of the editor's canvas shortcuts — that is how
 * Delete would otherwise remove a LAYER while you are looking at a file list.
 */
export function wireKeys(root: HTMLElement | null, list: HTMLElement | null, host: KeyHost): void {
  if (!root) return;
  list?.setAttribute('tabindex', '0');
  root.addEventListener('keydown', ev => {
    const el = ev.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
    const mod = ev.ctrlKey || ev.metaKey;

    if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); host.selectAll(); return; }
    if (mod && ev.key.toLowerCase() === 'x') {
      if (host.hasSelection()) { ev.preventDefault(); host.cut(); }
      return;
    }
    if (mod && ev.key.toLowerCase() === 'c') {
      if (host.hasSelection()) { ev.preventDefault(); host.copy(); }
      return;
    }
    if (mod && ev.key.toLowerCase() === 'v') {
      if (host.canPaste()) { ev.preventDefault(); host.paste(); }
      return;
    }
    if (ev.key === 'Escape') { host.clearSelection(); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (host.hasSelection()) { ev.preventDefault(); host.remove(); }
      return;
    }
    if (ev.key === 'F2') { ev.preventDefault(); host.rename(); return; }
    if (ev.key === 'Enter') {
      if (host.hasSelection()) { ev.preventDefault(); host.openSelected(); }
    }
  });
}
