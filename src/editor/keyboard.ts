import { StateManager } from './state';
import type { EditorApp } from './app';

let duplicateCounter = 0;

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
      { key: 'o', ctrl: true, action: () => this.app.fileTree?.triggerOpen(), description: 'Open file' },
      { key: 's', ctrl: true, action: () => this.app.fileTree?.triggerSave(), description: 'Save file' },
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

  private deleteSelected(): void {
    const ids = this.state.get().selectedLayerIds;
    for (const id of ids) {
      this.state.removeLayer(id);
    }
    this.state.set('selectedLayerIds', []);
  }

  private duplicateSelected(): void {
    const layers = this.state.getSelectedLayers();
    for (const layer of layers) {
      const clone = {
        ...layer,
        id: `${layer.id}-copy-${++duplicateCounter}`,
        x: (layer.x ?? 0) + 20,
        y: (layer.y ?? 0) + 20,
        z: layer.z + 1,
      };
      this.state.addLayer(clone);
    }
  }

  private adjustZ(delta: number): void {
    const ids = this.state.get().selectedLayerIds;
    for (const id of ids) {
      const layers = this.state.getCurrentLayers();
      const layer = layers.find(l => l.id === id);
      if (layer) {
        this.state.updateLayer(id, { z: layer.z + delta * 10 });
      }
    }
  }

  getShortcuts(): ShortcutDef[] {
    return this.shortcuts;
  }
}
