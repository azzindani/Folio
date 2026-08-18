// Asset explorer — per-cell interaction: click, double-click, right-click, drag.
//
// One function wires every cell in the pane whatever the view mode, because a
// row in Details and a tile in Large icons are the same object with different
// clothes: selecting, opening and dragging must behave identically or the view
// switcher becomes a mode switch, which is exactly what a file manager is not.
import type { Entry } from './asset-explorer-view';
import { openMenu, type MenuItem } from './asset-explorer-menu';

export interface CellHost {
  /** Selection key of every visible cell, in display order — shift-click needs it. */
  order(): string[];
  isSelected(key: string): boolean;
  click(key: string, mods: { ctrl: boolean; shift: boolean }): void;
  selectOnly(key: string): void;
  repaint(): void;
  open(entry: Entry): void;
  menuFor(entry: Entry): MenuItem[];
  /** Paths being dragged: files and folders travel on separate MIME types. */
  draggedFiles(): string[];
  draggedFolders(): string[];
  /** A drop landed on a folder cell; `nav` is "<scope>:<folder>". */
  drop(ev: DragEvent, nav: string): void;
  scope(): string;
}

export function wireCells(container: HTMLElement, entries: Entry[], host: CellHost): void {
  container.querySelectorAll<HTMLElement>('[data-key]').forEach(el => {
    const key = el.dataset['key'] ?? '';
    const entry = entries[Number(el.dataset['idx'])];
    if (!entry) return;

    el.addEventListener('click', ev => {
      host.click(key, { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey });
      host.repaint();
    });
    el.addEventListener('dblclick', () => host.open(entry));

    el.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      // Right-clicking something outside the selection selects it first, so the
      // menu's verbs always describe what you just pointed at.
      if (!host.isSelected(key)) { host.selectOnly(key); host.repaint(); }
      openMenu(ev.clientX, ev.clientY, host.menuFor(entry));
    });

    if (entry.type === 'folder') {
      el.addEventListener('dragover', ev => { ev.preventDefault(); el.classList.add('drop'); });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', ev => {
        el.classList.remove('drop');
        ev.preventDefault();
        // Stop the panel-wide drop handler from ALSO treating this as an upload
        // into the folder currently open.
        ev.stopPropagation();
        host.drop(ev, `${host.scope()}:${entry.folder}`);
      });
    }

    el.addEventListener('dragstart', ev => {
      if (!host.isSelected(key)) { host.selectOnly(key); host.repaint(); }
      ev.dataTransfer?.setData('application/x-folio-assets', JSON.stringify(host.draggedFiles()));
      ev.dataTransfer?.setData('application/x-folio-folders', JSON.stringify(host.draggedFolders()));
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    });
  });
}
