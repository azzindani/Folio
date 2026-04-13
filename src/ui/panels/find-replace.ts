import { type StateManager } from '../../editor/state';
import type { Layer, TextLayer } from '../../schema/types';

interface Match {
  layerId: string;
  layerLabel: string;
  preview: string;
}

export class FindReplaceManager {
  private container: HTMLElement;
  private state: StateManager;
  private findInput!: HTMLInputElement;
  private replaceInput!: HTMLInputElement;
  private resultsList!: HTMLElement;
  private statusEl!: HTMLElement;
  private matches: Match[] = [];

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.build();
    this.state.subscribe((_, keys) => {
      if (keys.includes('design')) this.runFind();
    });
  }

  private build(): void {
    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;padding:8px;gap:6px">

        <div style="font-size:11px;color:var(--color-text-muted);font-weight:600;
                    text-transform:uppercase;letter-spacing:.05em">Find &amp; Replace</div>

        <div style="display:flex;align-items:center;gap:4px">
          <input class="fr-find" type="search" placeholder="Find text…"
            style="flex:1;background:var(--color-bg);border:1px solid var(--color-border);
                   border-radius:4px;padding:4px 8px;color:var(--color-text);font-size:11px;outline:none">
          <button class="fr-btn fr-find-btn" title="Find" style="${BTN_STYLE}">↵</button>
        </div>

        <div style="display:flex;align-items:center;gap:4px">
          <input class="fr-replace" type="text" placeholder="Replace with…"
            style="flex:1;background:var(--color-bg);border:1px solid var(--color-border);
                   border-radius:4px;padding:4px 8px;color:var(--color-text);font-size:11px;outline:none">
          <button class="fr-btn fr-replace-one" title="Replace selected" style="${BTN_STYLE}">1</button>
          <button class="fr-btn fr-replace-all" title="Replace all" style="${BTN_STYLE}">All</button>
        </div>

        <div style="display:flex;gap:6px;align-items:center">
          <label style="font-size:10px;color:var(--color-text-muted);display:flex;gap:3px;align-items:center">
            <input class="fr-case" type="checkbox"> Case
          </label>
          <label style="font-size:10px;color:var(--color-text-muted);display:flex;gap:3px;align-items:center">
            <input class="fr-regex" type="checkbox"> Regex
          </label>
          <span class="fr-status" style="font-size:10px;color:var(--color-text-muted);margin-left:auto"></span>
        </div>

        <div class="fr-results"
          style="flex:1;overflow-y:auto;border-top:1px solid var(--color-border);padding-top:6px"></div>
      </div>`;

    this.findInput    = this.container.querySelector('.fr-find')!;
    this.replaceInput = this.container.querySelector('.fr-replace')!;
    this.resultsList  = this.container.querySelector('.fr-results')!;
    this.statusEl     = this.container.querySelector('.fr-status')!;

    this.findInput.addEventListener('input', () => this.runFind());
    this.container.querySelector('.fr-find-btn')!.addEventListener('click', () => this.runFind());
    this.container.querySelector('.fr-replace-one')!.addEventListener('click', () => this.replaceSelected());
    this.container.querySelector('.fr-replace-all')!.addEventListener('click', () => this.replaceAll());
    this.container.querySelector('.fr-case')!.addEventListener('change', () => this.runFind());
    this.container.querySelector('.fr-regex')!.addEventListener('change', () => this.runFind());
  }

  private buildRegex(): RegExp | null {
    const term = this.findInput.value;
    if (!term) return null;
    const useRegex = (this.container.querySelector('.fr-regex') as HTMLInputElement).checked;
    const caseSensitive = (this.container.querySelector('.fr-case') as HTMLInputElement).checked;
    const flags = caseSensitive ? 'g' : 'gi';
    try {
      return new RegExp(useRegex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch {
      return null;
    }
  }

  private runFind(): void {
    this.matches = [];
    const rx = this.buildRegex();
    if (!rx) {
      this.resultsList.innerHTML = '';
      this.statusEl.textContent = '';
      return;
    }

    const layers = this.state.getCurrentLayers();
    for (const layer of layers) {
      const text = extractText(layer);
      if (!text) continue;
      if (rx.test(text)) {
        this.matches.push({
          layerId: layer.id,
          layerLabel: `${layer.type} / ${layer.id}`,
          preview: text.slice(0, 60) + (text.length > 60 ? '…' : ''),
        });
      }
      rx.lastIndex = 0; // reset stateful regex
    }

    this.statusEl.textContent = `${this.matches.length} match${this.matches.length !== 1 ? 'es' : ''}`;
    this.renderResults();
  }

  private renderResults(): void {
    if (this.matches.length === 0) {
      this.resultsList.innerHTML =
        '<div style="font-size:11px;color:var(--color-text-muted);padding:4px">No matches</div>';
      return;
    }

    const selectedIds = this.state.get().selectedLayerIds ?? [];
    this.resultsList.innerHTML = this.matches.map(m => `
      <div class="fr-result-item" data-layer-id="${m.layerId}"
        style="padding:4px 6px;border-radius:4px;cursor:pointer;margin-bottom:2px;
               background:${selectedIds.includes(m.layerId) ? 'var(--color-primary)' : 'transparent'}">
        <div style="font-size:10px;color:var(--color-text-muted);font-family:var(--font-mono)">${m.layerLabel}</div>
        <div style="font-size:11px;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(m.preview)}</div>
      </div>`).join('');

    this.resultsList.querySelectorAll<HTMLElement>('.fr-result-item').forEach(el => {
      el.addEventListener('mouseenter', () => {
        if (!this.state.get().selectedLayerIds?.includes(el.dataset.layerId!)) {
          el.style.background = 'var(--color-surface)';
        }
      });
      el.addEventListener('mouseleave', () => {
        if (!this.state.get().selectedLayerIds?.includes(el.dataset.layerId!)) {
          el.style.background = 'transparent';
        }
      });
      el.addEventListener('click', () => {
        this.state.set('selectedLayerIds', [el.dataset.layerId!]);
      });
    });
  }

  private replaceSelected(): void {
    const selectedId = this.state.get().selectedLayerIds?.[0];
    if (!selectedId) return;
    const match = this.matches.find(m => m.layerId === selectedId);
    if (!match) return;
    this.applyReplace([match.layerId]);
  }

  private replaceAll(): void {
    this.applyReplace(this.matches.map(m => m.layerId));
  }

  private applyReplace(layerIds: string[]): void {
    const rx = this.buildRegex();
    const replacement = this.replaceInput.value;
    if (!rx) return;

    for (const id of layerIds) {
      const layers = this.state.getCurrentLayers();
      const layer = layers.find(l => l.id === id);
      if (!layer) continue;
      replaceTextInLayer(layer, rx, replacement, (updated) => {
        this.state.updateLayer(id, updated as Partial<Layer>);
      });
      rx.lastIndex = 0;
    }
    this.runFind();
  }
}

// ── Helpers ──────────────────────────────────────────────────

function extractText(layer: Layer): string | null {
  if (layer.type === 'text') {
    const tl = layer as TextLayer;
    if (tl.content.type === 'plain' || tl.content.type === 'markdown') {
      return tl.content.value;
    }
  }
  return null;
}

function replaceTextInLayer(
  layer: Layer,
  rx: RegExp,
  replacement: string,
  commit: (partial: Partial<Layer>) => void,
): void {
  if (layer.type !== 'text') return;
  const tl = layer as TextLayer;
  if (tl.content.type !== 'plain' && tl.content.type !== 'markdown') return;
  const newValue = tl.content.value.replace(rx, replacement);
  commit({ content: { ...tl.content, value: newValue } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BTN_STYLE =
  'padding:3px 8px;background:var(--color-surface);border:1px solid var(--color-border);' +
  'border-radius:4px;color:var(--color-text);font-size:11px;cursor:pointer';
