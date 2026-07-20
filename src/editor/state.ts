import type { DesignSpec, ThemeSpec, Layer, PaletteSpec, TypePackSpec, EffectsPackSpec } from '../schema/types';
import type { AnimationSpec } from '../animation/types';
import { addBlankPage, duplicatePage, deletePage, movePage as movePageOp } from './state-pages';

export type ToolId =
  | 'select' | 'text' | 'rect' | 'circle' | 'line'
  | 'polygon' | 'star' | 'arrow' | 'pen' | 'image' | 'eyedropper' | 'hand' | 'frame';

export type RulerUnit = 'px' | 'mm' | 'cm' | 'in';

export interface Guide {
  id: string;
  axis: 'h' | 'v'; // h = horizontal line at fixed y; v = vertical line at fixed x
  position: number; // design-space px
}

export interface EditorState {
  design: DesignSpec | null;
  theme: ThemeSpec | null;
  // Style overlay picks — composed on top of `theme` at render time via
  // composeTheme(). Null when no overlay is active.
  palette: PaletteSpec | null;
  typePack: TypePackSpec | null;
  effectsPack: EffectsPackSpec | null;
  selectedLayerIds: string[];
  zoom: number;
  panX: number;
  panY: number;
  /**
   * visual  = SVG canvas (layout editing)
   * payload = Monaco YAML
   * preview = the real exported interactive HTML, live in an iframe
   */
  mode: 'visual' | 'payload' | 'preview';
  currentPageIndex: number;
  gridVisible: boolean;
  snapEnabled: boolean;
  yamlSource: string;
  dirty: boolean;
  activeTool: ToolId;
  rulerUnit: RulerUnit;
  guides: Guide[];
  animations: Record<string, AnimationSpec>;
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
  /** Monotonic counter making generated page/layer ids unique within a session. */
  private pageOpSeq = 0;

  constructor() {
    this.state = {
      design: null,
      theme: null,
      palette: null,
      typePack: null,
      effectsPack: null,
      selectedLayerIds: [],
      zoom: 1,
      panX: 0,
      panY: 0,
      mode: 'visual',
      currentPageIndex: 0,
      gridVisible: false,
      snapEnabled: true,
      yamlSource: '',
      dirty: false,
      activeTool: 'select',
      rulerUnit: 'px',
      guides: [],
      animations: {},
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

  /**
   * Take an undo snapshot at the start of an interaction (drag/resize/rotate).
   * Subsequent `updateLayer(..., false)` calls during the interaction will
   * mutate the design without polluting the undo stack.
   */
  beginInteraction(): void {
    this.pushUndo();
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

  /** Find a layer by id anywhere in the current page tree (recurses into groups).
   *  Top-level-only `getCurrentLayers().find(...)` silently misses layers nested
   *  in a group — and presets ship the whole poster as one group, so editing any
   *  of its children did nothing. */
  findLayer(id: string): Layer | undefined {
    const walk = (layers: Layer[]): Layer | undefined => {
      for (const l of layers) {
        if (l.id === id) return l;
        const kids = (l as unknown as { layers?: Layer[] }).layers;
        if (Array.isArray(kids)) { const f = walk(kids); if (f) return f; }
      }
      return undefined;
    };
    return walk(this.getCurrentLayers());
  }

  getSelectedLayers(): Layer[] {
    const ids = new Set(this.state.selectedLayerIds);
    if (ids.size === 0) return [];
    // Recurse into groups: a click on the canvas resolves to the INNERMOST
    // data-layer-id (a child of a group), and presets ship the whole poster as
    // ONE group — so a top-level-only filter returned nothing for every nested
    // item, making the canvas feel unselectable (no selection box, blank
    // properties). Walk the tree so nested ids resolve too.
    const found: Layer[] = [];
    const walk = (layers: Layer[]): void => {
      for (const l of layers) {
        if (ids.has(l.id)) found.push(l);
        const kids = (l as unknown as { layers?: Layer[] }).layers;
        if (Array.isArray(kids)) walk(kids);
      }
    };
    walk(this.getCurrentLayers());
    return found;
  }

  updateLayer(layerId: string, updates: Partial<Layer>, recordUndo = true): void {
    if (!this.state.design) return;
    if (recordUndo) this.pushUndo();

    const updateInArray = (layers: Layer[]): Layer[] =>
      layers.map(l => {
        if (l.id === layerId) {
          return { ...l, ...updates } as Layer;
        }
        const kids = (l as Layer & { layers?: Layer[] }).layers;
        if (Array.isArray(kids)) {
          return { ...l, layers: updateInArray(kids) } as Layer;
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

  renameLayer(layerId: string, newId: string): void {
    if (!this.state.design) return;
    this.pushUndo();

    const renameInArray = (layers: Layer[]): Layer[] =>
      layers.map(l => {
        if (l.id === layerId) return { ...l, id: newId } as Layer;
        const kids = (l as Layer & { layers?: Layer[] }).layers;
        if (Array.isArray(kids)) {
          return { ...l, layers: renameInArray(kids) } as Layer;
        }
        return l;
      });

    const selectedLayerIds = this.state.selectedLayerIds.map(id => id === layerId ? newId : id);

    if (this.state.design.pages && this.state.design.pages.length > 0) {
      const pages = this.state.design.pages.map((page, i) => {
        if (i === this.state.currentPageIndex && page.layers) {
          return { ...page, layers: renameInArray(page.layers) };
        }
        return page;
      });
      this.batch(() => {
        this.set('design', { ...this.state.design!, pages }, false);
        this.set('selectedLayerIds', selectedLayerIds);
      });
    } else if (this.state.design.layers) {
      const layers = renameInArray(this.state.design.layers);
      this.batch(() => {
        this.set('design', { ...this.state.design!, layers }, false);
        this.set('selectedLayerIds', selectedLayerIds);
      });
    }
  }

  /**
   * Move a top-level layer to a new index within the current page (flow-report
   * reordering). `targetIndex` is the desired position among the OTHER layers
   * (i.e. after the dragged layer is removed); clamped to the valid range.
   * No-op if the layer isn't top-level or the position is unchanged.
   */
  reorderLayer(layerId: string, targetIndex: number): void {
    if (!this.state.design) return;

    const reorder = (layers: Layer[]): Layer[] | null => {
      const from = layers.findIndex(l => l.id === layerId);
      if (from === -1) return null;
      const next = layers.slice();
      const [moved] = next.splice(from, 1);
      const to = Math.max(0, Math.min(next.length, targetIndex));
      if (to === from) return null; // unchanged
      next.splice(to, 0, moved);
      return next;
    };

    if (this.state.design.pages && this.state.design.pages.length > 0) {
      const page = this.state.design.pages[this.state.currentPageIndex];
      const reordered = page?.layers ? reorder(page.layers) : null;
      if (!reordered) return;
      this.pushUndo();
      const pages = this.state.design.pages.map((p, i) =>
        i === this.state.currentPageIndex ? { ...p, layers: reordered } : p);
      this.set('design', { ...this.state.design, pages }, false);
    } else if (this.state.design.layers) {
      const reordered = reorder(this.state.design.layers);
      if (!reordered) return;
      this.pushUndo();
      this.set('design', { ...this.state.design, layers: reordered }, false);
    }
  }

  removeLayer(layerId: string): void {
    if (!this.state.design) return;
    this.pushUndo();

    const removeFromArray = (layers: Layer[]): Layer[] =>
      layers.filter(l => l.id !== layerId).map(l => {
        const kids = (l as Layer & { layers?: Layer[] }).layers;
        if (Array.isArray(kids)) {
          return { ...l, layers: removeFromArray(kids) } as Layer;
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

  // ── Page operations ─────────────────────────────────────
  // Single source of truth for paging — the toolbar, page strip, command
  // palette and keyboard all route here. Each converts a single-page design to
  // pages[] on first use (via the pure helpers) so paging works from any design.

  /** Append a blank page after the current one and switch to it. */
  addPage(): void {
    if (!this.state.design) return;
    this.pushUndo();
    const { design, index } = addBlankPage(this.state.design, this.state.currentPageIndex, ++this.pageOpSeq);
    this.set('design', design, false);
    this.set('currentPageIndex', index, false);
  }

  /** Duplicate the current page (fresh layer ids) and switch to the copy. */
  duplicateCurrentPage(): void {
    if (!this.state.design) return;
    this.pushUndo();
    const { design, index } = duplicatePage(this.state.design, this.state.currentPageIndex, ++this.pageOpSeq);
    this.set('design', design, false);
    this.set('currentPageIndex', index, false);
  }

  /** Delete the current page (never the last one). */
  deleteCurrentPage(): void {
    if (!this.state.design) return;
    this.pushUndo();
    const { design, index } = deletePage(this.state.design, this.state.currentPageIndex);
    this.set('design', design, false);
    this.set('currentPageIndex', index, false);
  }

  /** Move the current page one slot left (-1) or right (+1). */
  movePage(direction: -1 | 1): void {
    if (!this.state.design) return;
    const from = this.state.currentPageIndex;
    this.pushUndo();
    const { design, index } = movePageOp(this.state.design, from, from + direction);
    this.set('design', design, false);
    this.set('currentPageIndex', index, false);
  }

  /** Switch to a page by index (clamped to the page range). */
  goToPage(index: number): void {
    const d = this.state.design;
    if (!d) return;
    const len = d.pages && d.pages.length > 0 ? d.pages.length : 1;
    this.set('currentPageIndex', Math.max(0, Math.min(index, len - 1)), false);
  }
}
