import type { DesignSpec, ThemeSpec, Layer } from '../schema/types';

export interface EditorState {
  design: DesignSpec | null;
  theme: ThemeSpec | null;
  selectedLayerIds: string[];
  zoom: number;
  panX: number;
  panY: number;
  mode: 'visual' | 'payload';
  currentPageIndex: number;
  gridVisible: boolean;
  yamlSource: string;
  dirty: boolean;
}

export type StateChangeListener = (state: EditorState, changedKeys: (keyof EditorState)[]) => void;

const MAX_UNDO_STACK = 100;

export class StateManager {
  private state: EditorState;
  private listeners: StateChangeListener[] = [];
  private undoStack: EditorState[] = [];
  private redoStack: EditorState[] = [];
  private batchingDepth = 0;
  private batchedKeys = new Set<keyof EditorState>();

  constructor() {
    this.state = {
      design: null,
      theme: null,
      selectedLayerIds: [],
      zoom: 1,
      panX: 0,
      panY: 0,
      mode: 'visual',
      currentPageIndex: 0,
      gridVisible: false,
      yamlSource: '',
      dirty: false,
    };
  }

  get(): EditorState {
    return this.state;
  }

  set<K extends keyof EditorState>(key: K, value: EditorState[K], recordUndo = true): void {
    if (this.state[key] === value) return;

    if (recordUndo && key === 'design') {
      this.pushUndo();
    }

    this.state = { ...this.state, [key]: value };

    if (this.batchingDepth > 0) {
      this.batchedKeys.add(key);
    } else {
      this.notify([key]);
    }
  }

  batch(fn: () => void): void {
    this.batchingDepth++;
    fn();
    this.batchingDepth--;
    if (this.batchingDepth === 0 && this.batchedKeys.size > 0) {
      const keys = [...this.batchedKeys];
      this.batchedKeys.clear();
      this.notify(keys as (keyof EditorState)[]);
    }
  }

  subscribe(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(keys: (keyof EditorState)[]): void {
    for (const listener of this.listeners) {
      listener(this.state, keys);
    }
  }

  // ── Undo / Redo ─────────────────────────────────────────
  private pushUndo(): void {
    this.undoStack.push({ ...this.state });
    if (this.undoStack.length > MAX_UNDO_STACK) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push({ ...this.state });
    this.state = prev;
    this.notify(['design', 'selectedLayerIds']);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push({ ...this.state });
    this.state = next;
    this.notify(['design', 'selectedLayerIds']);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ── Layer Helpers ───────────────────────────────────────
  getCurrentLayers(): Layer[] {
    if (!this.state.design) return [];

    if (this.state.design.pages && this.state.design.pages.length > 0) {
      const page = this.state.design.pages[this.state.currentPageIndex];
      return page?.layers ?? [];
    }

    return this.state.design.layers ?? [];
  }

  getSelectedLayers(): Layer[] {
    const layers = this.getCurrentLayers();
    return layers.filter(l => this.state.selectedLayerIds.includes(l.id));
  }

  updateLayer(layerId: string, updates: Partial<Layer>): void {
    if (!this.state.design) return;
    this.pushUndo();

    const updateInArray = (layers: Layer[]): Layer[] =>
      layers.map(l => {
        if (l.id === layerId) {
          return { ...l, ...updates } as Layer;
        }
        if (l.type === 'group' && 'layers' in l) {
          return { ...l, layers: updateInArray(l.layers) } as Layer;
        }
        return l;
      });

    if (this.state.design.pages && this.state.design.pages.length > 0) {
      const pages = this.state.design.pages.map((page, i) => {
        if (i === this.state.currentPageIndex && page.layers) {
          return { ...page, layers: updateInArray(page.layers) };
        }
        return page;
      });
      this.set('design', { ...this.state.design, pages }, false);
    } else if (this.state.design.layers) {
      this.set('design', { ...this.state.design, layers: updateInArray(this.state.design.layers) }, false);
    }
  }

  addLayer(layer: Layer): void {
    if (!this.state.design) return;
    this.pushUndo();

    if (this.state.design.pages && this.state.design.pages.length > 0) {
      const pages = this.state.design.pages.map((page, i) => {
        if (i === this.state.currentPageIndex) {
          return { ...page, layers: [...(page.layers ?? []), layer] };
        }
        return page;
      });
      this.set('design', { ...this.state.design, pages }, false);
    } else {
      this.set('design', {
        ...this.state.design,
        layers: [...(this.state.design.layers ?? []), layer],
      }, false);
    }
  }

  removeLayer(layerId: string): void {
    if (!this.state.design) return;
    this.pushUndo();

    const removeFromArray = (layers: Layer[]): Layer[] =>
      layers.filter(l => l.id !== layerId).map(l => {
        if (l.type === 'group' && 'layers' in l) {
          return { ...l, layers: removeFromArray(l.layers) } as Layer;
        }
        return l;
      });

    if (this.state.design.pages && this.state.design.pages.length > 0) {
      const pages = this.state.design.pages.map((page, i) => {
        if (i === this.state.currentPageIndex && page.layers) {
          return { ...page, layers: removeFromArray(page.layers) };
        }
        return page;
      });
      this.set('design', { ...this.state.design, pages }, false);
    } else if (this.state.design.layers) {
      this.set('design', { ...this.state.design, layers: removeFromArray(this.state.design.layers) }, false);
    }
  }
}
