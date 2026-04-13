import { StateManager } from './state';
import type { EditorApp } from './app';
import type { Layer } from '../schema/types';
import { serializeYAML, parseYAML } from '../schema/parser';

let duplicateCounter = 0;
let groupCounter = 0;

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
      // Clipboard
      { key: 'c', ctrl: true, action: () => this.copySelected(), description: 'Copy selected layers' },
      { key: 'v', ctrl: true, action: () => this.pasteFromClipboard(), description: 'Paste layers' },
      // Group
      { key: 'g', ctrl: true, action: () => this.groupSelected(), description: 'Group selected layers' },
      { key: 'g', ctrl: true, shift: true, action: () => this.ungroupSelected(), description: 'Ungroup selected' },
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

  private copySelected(): void {
    const layers = this.state.getSelectedLayers();
    if (layers.length === 0) return;
    // Serialize as YAML array so paste can read it back
    const snippet = serializeYAML(layers.length === 1 ? layers[0] : layers);
    navigator.clipboard?.writeText(snippet).catch(() => {/* clipboard not available */});
  }

  private pasteFromClipboard(): void {
    navigator.clipboard?.readText().then(text => {
      try {
        // Clipboard content can be either a layers array or a single layer object
        const parsed = parseYAML<Layer[] | Layer>(text);
        const rawLayers: Layer[] = Array.isArray(parsed) ? parsed : [parsed];
        const newIds: string[] = [];
        for (const layer of rawLayers) {
          if (typeof layer !== 'object' || !layer || !('type' in layer)) continue;
          const newId = `${layer.id}-paste-${++duplicateCounter}`;
          newIds.push(newId);
          this.state.addLayer({ ...layer, id: newId, x: (layer.x ?? 0) + 20, y: (layer.y ?? 0) + 20 } as Layer);
        }
        if (newIds.length > 0) this.state.set('selectedLayerIds', newIds);
      } catch {
        // Invalid clipboard content — ignore
      }
    }).catch(() => {/* clipboard not available */});
  }

  private groupSelected(): void {
    const layers = this.state.getSelectedLayers();
    if (layers.length < 2) return;
    const maxZ = Math.max(...layers.map(l => l.z));
    const groupId = `group-${++groupCounter}`;
    const groupLayer: Layer = {
      id: groupId,
      type: 'group',
      z: maxZ,
      x: Math.min(...layers.map(l => l.x ?? 0)),
      y: Math.min(...layers.map(l => l.y ?? 0)),
      width: 0,
      height: 0,
      layers: layers,
    } as unknown as Layer;

    for (const l of layers) this.state.removeLayer(l.id);
    this.state.addLayer(groupLayer);
    this.state.set('selectedLayerIds', [groupId]);
  }

  private ungroupSelected(): void {
    const selected = this.state.getSelectedLayers();
    const groups = selected.filter(l => l.type === 'group');
    for (const group of groups) {
      const children: Layer[] = (group as unknown as { layers: Layer[] }).layers ?? [];
      this.state.removeLayer(group.id);
      for (const child of children) this.state.addLayer(child);
    }
    if (groups.length > 0) {
      const childIds = groups.flatMap(g => ((g as unknown as { layers: Layer[] }).layers ?? []).map((l: Layer) => l.id));
      this.state.set('selectedLayerIds', childIds);
    }
  }

  getShortcuts(): ShortcutDef[] {
    return this.shortcuts;
  }
}
