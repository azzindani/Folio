import type { StateManager, EditorState } from '../../editor/state';
import type { Layer, GroupLayer } from '../../schema/types';
import { renderDesign } from '../../renderer/renderer';

const STORAGE_KEY = 'folio:components';

export interface ComponentDef {
  id: string;
  name: string;
  layers: Layer[];
  thumbnail: string; // SVG markup
  createdAt: string;
}

function loadComponents(): ComponentDef[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as ComponentDef[];
  } catch {
    return [];
  }
}

function saveComponents(defs: ComponentDef[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defs));
  } catch { /* quota exceeded — ignore */ }
}

function buildThumbnail(layers: Layer[]): string {
  try {
    const fakeSpec = {
      _protocol: 'design/v1' as const,
      meta: { id: '__thumb', name: '', type: 'poster' as const, created: '', modified: '' },
      document: { width: 120, height: 120, unit: 'px' as const, dpi: 96 },
      layers,
    };
    const svg = renderDesign(fakeSpec as Parameters<typeof renderDesign>[0]);
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return '';
  }
}

let idCounter = Date.now();
function newId(): string { return `comp-${++idCounter}`; }

export class ComponentLibraryManager {
  private container: HTMLElement;
  private state: StateManager;
  private defs: ComponentDef[] = [];

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.defs = loadComponents();
    this.render();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private onStateChange(_s: EditorState, keys: (keyof EditorState)[]): void {
    if (keys.includes('selectedLayerIds') || keys.includes('design')) {
      this.render();
    }
  }

  /** Save selected layers from active design as a new named component. */
  saveSelected(name: string): ComponentDef | null {
    const { design, selectedLayerIds } = this.state.get();
    if (!design || !selectedLayerIds.length) return null;

    const allLayers = this.state.getCurrentLayers();
    const selected = allLayers.filter(l => selectedLayerIds.includes(l.id));
    if (!selected.length) return null;

    const def: ComponentDef = {
      id: newId(),
      name: name.trim() || `Component ${this.defs.length + 1}`,
      layers: selected,
      thumbnail: buildThumbnail(selected),
      createdAt: new Date().toISOString(),
    };
    this.defs = [def, ...this.defs];
    saveComponents(this.defs);
    this.render();
    return def;
  }

  /** Insert a component into the current design as a group layer. */
  insertComponent(id: string): void {
    const def = this.defs.find(d => d.id === id);
    if (!def || !this.state.get().design) return;

    const allLayers = this.state.getCurrentLayers();
    const maxZ = allLayers.reduce((m, l) => Math.max(m, l.z), 0);
    const offset = 20;

    const movedLayers = def.layers.map((l, i) => ({
      ...l,
      id: `${l.id}-${newId()}`,
      x: (l.x ?? 0) + offset,
      y: (l.y ?? 0) + offset,
      z: maxZ + i + 1,
    }));

    if (movedLayers.length === 1) {
      this.state.addLayer(movedLayers[0]);
      this.state.set('selectedLayerIds', [movedLayers[0].id]);
    } else {
      const group: GroupLayer = {
        id: `${def.name.replace(/\s+/g, '-')}-${newId()}`,
        type: 'group',
        z: maxZ + movedLayers.length + 1,
        x: 0, y: 0,
        width: 0, height: 0,
        layers: movedLayers as Layer[],
      };
      this.state.addLayer(group as unknown as Layer);
      this.state.set('selectedLayerIds', [group.id]);
    }
  }

  /** Delete a component definition by id. */
  deleteComponent(id: string): void {
    this.defs = this.defs.filter(d => d.id !== id);
    saveComponents(this.defs);
    this.render();
  }

  getComponents(): ComponentDef[] {
    return [...this.defs];
  }

  render(): void {
    const { selectedLayerIds } = this.state.get();
    const hasSelection = selectedLayerIds.length > 0;

    this.container.innerHTML = `
      <div class="comp-panel">
        <div class="comp-toolbar">
          <span class="comp-toolbar-title">Components</span>
          ${hasSelection ? `
            <button class="btn btn-sm comp-save-btn" id="comp-save" title="Save selection as component">
              + Save selection
            </button>` : ''}
        </div>
        ${this.defs.length === 0
          ? `<div class="comp-empty">No components yet.<br>Select layers and click <strong>+ Save selection</strong>.</div>`
          : `<div class="comp-grid">${this.defs.map(d => this.renderCard(d)).join('')}</div>`
        }
      </div>`;

    this.container.querySelector('#comp-save')?.addEventListener('click', () => {
      const name = prompt('Component name:') ?? '';
      this.saveSelected(name);
    });

    this.container.querySelectorAll<HTMLElement>('.comp-card').forEach(card => {
      const id = card.dataset.compId!;
      card.querySelector('.comp-insert')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.insertComponent(id);
      });
      card.querySelector('.comp-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Delete this component?')) this.deleteComponent(id);
      });
    });
  }

  private renderCard(def: ComponentDef): string {
    const thumb = def.thumbnail
      ? `<div class="comp-thumb">${def.thumbnail}</div>`
      : `<div class="comp-thumb comp-thumb-empty">⊞</div>`;

    return `
      <div class="comp-card" data-comp-id="${def.id}" title="${def.name}">
        ${thumb}
        <div class="comp-card-name">${def.name}</div>
        <div class="comp-card-actions">
          <button class="comp-insert" title="Insert into canvas">Insert</button>
          <button class="comp-delete" title="Delete component">&times;</button>
        </div>
      </div>`;
  }
}
