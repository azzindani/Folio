// Folio editor — right-click context menu on the canvas.
// Reuses the shared layer-actions so it always matches the keyboard shortcuts.
import { StateManager } from './state';
import { flipHorizontal, flipVertical } from './interactions';
import * as actions from './layer-actions';
import { sc } from '../utils/shortcut';

interface MenuItem {
  label: string;
  hint?: string;
  enabled: boolean;
  run: () => void;
}

const SEP = null;

export class CanvasContextMenu {
  private state: StateManager;
  private menu: HTMLElement | null = null;

  constructor(state: StateManager, canvasSection: HTMLElement) {
    this.state = state;
    canvasSection.addEventListener('contextmenu', (e) => {
      // Let inline text editing keep the native menu (spellcheck etc.)
      const t = e.target as HTMLElement;
      if (t.closest('textarea, input, [contenteditable="true"]')) return;
      e.preventDefault();
      // canvas-interactions selects the layer under the cursor on right-click
      // before this listener runs; give it a tick to settle the selection.
      setTimeout(() => this.open(e.clientX, e.clientY), 0);
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.menu && !this.menu.contains(e.target as Node)) this.close();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  private items(): (MenuItem | typeof SEP)[] {
    const sel = this.state.getSelectedLayers();
    const n = sel.length;
    const hasGroup = sel.some(l => l.type === 'group');
    const anyUnlocked = sel.some(l => !(l as { locked?: boolean }).locked);
    const s = this.state;
    return [
      { label: 'Duplicate', hint: sc('⌘D'), enabled: n > 0, run: () => actions.duplicateSelected(s) },
      { label: 'Copy', hint: sc('⌘C'), enabled: n > 0, run: () => actions.copySelected(s) },
      { label: 'Paste', hint: sc('⌘V'), enabled: true, run: () => actions.pasteFromClipboard(s) },
      SEP,
      { label: 'Group', hint: sc('⌘G'), enabled: n >= 2, run: () => actions.groupSelected(s) },
      { label: 'Ungroup', hint: sc('⌘⇧G'), enabled: hasGroup, run: () => actions.ungroupSelected(s) },
      SEP,
      { label: 'Bring forward', hint: sc('⌘]'), enabled: n > 0, run: () => actions.adjustZ(s, 1) },
      { label: 'Send backward', hint: sc('⌘['), enabled: n > 0, run: () => actions.adjustZ(s, -1) },
      SEP,
      { label: 'Flip horizontal', hint: sc('⇧H'), enabled: n > 0, run: () => flipHorizontal(s) },
      { label: 'Flip vertical', hint: sc('⇧V'), enabled: n > 0, run: () => flipVertical(s) },
      { label: anyUnlocked || n === 0 ? 'Lock' : 'Unlock', enabled: n > 0, run: () => actions.toggleLockSelected(s) },
      SEP,
      { label: 'Delete', hint: 'Del', enabled: n > 0, run: () => actions.deleteSelected(s) },
    ];
  }

  private open(x: number, y: number): void {
    this.close();
    const menu = document.createElement('div');
    menu.className = 'canvas-context-menu';
    for (const item of this.items()) {
      if (item === SEP) {
        const hr = document.createElement('div');
        hr.className = 'ccm-sep';
        menu.appendChild(hr);
        continue;
      }
      const btn = document.createElement('button');
      btn.className = 'ccm-item';
      btn.disabled = !item.enabled;
      const lbl = document.createElement('span');
      lbl.textContent = item.label;
      btn.appendChild(lbl);
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'ccm-hint';
        hint.textContent = item.hint;
        btn.appendChild(hint);
      }
      btn.addEventListener('click', () => { this.close(); item.run(); });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    // Keep the menu on-screen (flip near right/bottom edges)
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
    this.menu = menu;
  }

  close(): void {
    this.menu?.remove();
    this.menu = null;
  }
}
