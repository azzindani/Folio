import { StateManager } from './state';
import type { EditorApp } from './app';
import { smartDuplicate } from '../utils/smart-duplicate';
import { flipHorizontal, flipVertical } from './interactions';
import * as actions from './layer-actions';

interface ShortcutDef {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

export class KeyboardManager {
  private state: StateManager;
  private app: EditorApp;
  private shortcuts: ShortcutDef[] = [];

  constructor(state: StateManager, app: EditorApp) {
    this.state = state;
    this.app = app;
    this.registerDefaults();
    document.addEventListener('keydown', this.onKeyDown.bind(this));
  }

  private registerDefaults(): void {
    this.shortcuts = [
      {
        key: 'z', ctrl: true,
        action: () => this.state.undo(),
        description: 'Undo',
      },
      {
        key: 'z', ctrl: true, shift: true,
        action: () => this.state.redo(),
        description: 'Redo',
      },
      {
        key: 'Escape',
        action: () => this.state.set('selectedLayerIds', []),
        description: 'Deselect all',
      },
      {
        key: 'g',
        action: () => {
          const { gridVisible } = this.state.get();
          this.state.set('gridVisible', !gridVisible, false);
        },
        description: 'Toggle grid',
      },
      {
        key: '0', ctrl: true,
        action: () => this.app.canvas.fitToScreen(),
        description: 'Fit canvas to screen',
      },
      {
        key: '1', ctrl: true,
        action: () => this.state.set('zoom', 1, false),
        description: '100% zoom',
      },
      {
        key: 'Delete',
        action: () => this.deleteSelected(),
        description: 'Delete selected layers',
      },
      {
        key: 'Backspace',
        action: () => this.deleteSelected(),
        description: 'Delete selected layers',
      },
      {
        key: 'd', ctrl: true,
        action: () => this.duplicateSelected(),
        description: 'Duplicate selected',
      },
      {
        key: 'd', ctrl: true, shift: true,
        action: () => this.smartDuplicateSelected(),
        description: 'Smart duplicate (grid)',
      },
      {
        key: '[', ctrl: true,
        action: () => this.adjustZ(-1),
        description: 'Send backward',
      },
      {
        key: ']', ctrl: true,
        action: () => this.adjustZ(1),
        description: 'Bring forward',
      },
      // File shortcuts
      { key: 'n', ctrl: true, alt: true, action: () => this.app.newDesignDialog(), description: 'New blank design' },
      { key: 'o', ctrl: true, action: () => this.app.fileTree?.triggerOpen(), description: 'Open file' },
      { key: 's', ctrl: true, action: () => this.app.fileTree?.triggerSave(), description: 'Save file' },
      // Clipboard
      { key: 'c', ctrl: true, action: () => this.copySelected(), description: 'Copy selected layers' },
      { key: 'v', ctrl: true, action: () => this.pasteFromClipboard(), description: 'Paste layers' },
      // Group
      { key: 'g', ctrl: true, action: () => this.groupSelected(), description: 'Group selected layers' },
      { key: 'g', ctrl: true, shift: true, action: () => this.ungroupSelected(), description: 'Ungroup selected' },
      // Flip transforms (Shift+H mirrors horizontally, Shift+V mirrors vertically).
      // e.key is uppercase when Shift is held without Ctrl, hence 'H' / 'V'.
      { key: 'H', shift: true, action: () => this.flipSelectedH(), description: 'Flip selection horizontally' },
      { key: 'V', shift: true, action: () => this.flipSelectedV(), description: 'Flip selection vertically' },
      // Presentation
      { key: 'F5', action: () => this.app.presentation?.open(), description: 'Start presentation (F5)' },
      // Print
      { key: 'p', ctrl: true, action: () => this.app.printDesign?.(), description: 'Print design (Ctrl+P)' },
      // Tool shortcuts
      { key: 'v', action: () => this.state.set('activeTool', 'select', false), description: 'Select tool' },
      { key: 'r', action: () => this.state.set('activeTool', 'rect',   false), description: 'Rectangle tool' },
      { key: 'c', action: () => this.state.set('activeTool', 'circle', false), description: 'Circle tool' },
      { key: 't', action: () => this.state.set('activeTool', 'text',   false), description: 'Text tool' },
      { key: 'l', action: () => this.state.set('activeTool', 'line',   false), description: 'Line tool' },
    ];
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Don't capture when typing in inputs
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    for (const shortcut of this.shortcuts) {
      const ctrlMatch = (shortcut.ctrl ?? false) === (e.ctrlKey || e.metaKey);
      const shiftMatch = (shortcut.shift ?? false) === e.shiftKey;
      const altMatch = (shortcut.alt ?? false) === e.altKey;

      if (e.key === shortcut.key && ctrlMatch && shiftMatch && altMatch) {
        e.preventDefault();
        shortcut.action();
        return;
      }
    }
  }

  private deleteSelected(): void { actions.deleteSelected(this.state); }

  private duplicateSelected(): void { actions.duplicateSelected(this.state); }

  private smartDuplicateSelected(): void {
    const layers = this.state.getSelectedLayers();
    if (layers.length === 0) return;
    const dupes = smartDuplicate(layers, { mode: 'grid', cols: 3, rows: 3, colGap: 10, rowGap: 10 });
    for (const d of dupes) this.state.addLayer(d);
  }

  private adjustZ(delta: number): void { actions.adjustZ(this.state, delta); }

  private copySelected(): void { actions.copySelected(this.state); }

  private pasteFromClipboard(): void { actions.pasteFromClipboard(this.state); }

  private flipSelectedH(): void { flipHorizontal(this.state); }
  private flipSelectedV(): void { flipVertical(this.state); }

  private groupSelected(): void { actions.groupSelected(this.state); }

  private ungroupSelected(): void { actions.ungroupSelected(this.state); }

  getShortcuts(): ShortcutDef[] {
    return this.shortcuts;
  }
}
