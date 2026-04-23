/**
 * ColorPaletteManager — right-side color palette.
 *
 * Shows:
 *  - Document colors (extracted from the active design)
 *  - Recent colors (last 16 picked, stored in localStorage)
 *  - Preset swatches (common web / material / pastel palettes)
 *
 * Clicking a swatch fires an `onPick(hex)` callback, typically wired
 * to the currently focused property input.
 */

import type { StateManager, EditorState } from '../../editor/state';

type PickCallback = (hex: string) => void;

const PRESET_SWATCHES = [
  // Neutrals
  '#ffffff','#f8f8f8','#e8e8e8','#cccccc','#aaaaaa','#888888','#555555','#333333','#111111','#000000',
  // Primary spectrum
  '#ff0000','#ff6600','#ffcc00','#99cc00','#00cc66','#00cccc','#0066ff','#6600ff','#cc00cc','#ff0066',
  // Pastels
  '#ffb3b3','#ffcc99','#fff5b3','#ccffcc','#b3ffee','#b3e0ff','#ccb3ff','#ffb3ee',
  // Material-ish
  '#f44336','#e91e63','#9c27b0','#3f51b5','#2196f3','#00bcd4','#4caf50','#8bc34a','#ff9800','#ff5722',
];

const RECENT_KEY = 'folio:recent-colors';
const RECENT_MAX = 16;

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function saveRecent(colors: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(colors.slice(0, RECENT_MAX)));
  } catch { /* ignore */ }
}

export function addToRecent(hex: string): void {
  const recent = loadRecent().filter(c => c !== hex);
  recent.unshift(hex);
  saveRecent(recent.slice(0, RECENT_MAX));
}

function extractDocColors(state: StateManager): string[] {
  const design = state.get().design;
  if (!design) return [];
  const colors = new Set<string>();
  const layers = design.layers ?? design.pages?.flatMap(p => p.layers ?? []) ?? [];
  const visit = (layer: unknown): void => {
    const l = layer as Record<string, unknown>;
    const fill = l.fill as Record<string, unknown> | undefined;
    if (fill?.type === 'solid' && typeof fill.color === 'string' && fill.color.startsWith('#')) {
      colors.add(fill.color);
    }
    const stroke = l.stroke as Record<string, unknown> | undefined;
    if (stroke && typeof stroke.color === 'string' && stroke.color.startsWith('#')) {
      colors.add(stroke.color);
    }
    if (Array.isArray(l.layers)) l.layers.forEach(visit);
  };
  (layers as unknown[]).forEach(visit);
  return [...colors].slice(0, 24);
}

export class ColorPaletteManager {
  private container: HTMLElement;
  private state: StateManager;
  private onPick: PickCallback;
  private importedColors: string[] = [];

  constructor(container: HTMLElement, state: StateManager, onPick: PickCallback) {
    this.container = container;
    this.state = state;
    this.onPick = onPick;
    this.render();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  addImportedColors(colors: string[]): void {
    const existing = new Set(this.importedColors);
    colors.forEach(c => existing.add(c));
    this.importedColors = [...existing].slice(0, 24);
    this.render();
  }

  private onStateChange(_s: EditorState, keys: (keyof EditorState)[]): void {
    if (keys.includes('design')) this.render();
  }

  render(): void {
    const recent = loadRecent();
    const docColors = extractDocColors(this.state);

    this.container.innerHTML = `
      <div class="palette-panel">
        ${this.importedColors.length ? this.renderGroup('Imported', this.importedColors) : ''}
        ${docColors.length ? this.renderGroup('Document Colors', docColors) : ''}
        ${recent.length ? this.renderGroup('Recent', recent) : ''}
        ${this.renderGroup('Swatches', PRESET_SWATCHES)}
      </div>`;

    this.container.querySelectorAll<HTMLElement>('.palette-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        const hex = sw.dataset.color!;
        addToRecent(hex);
        this.onPick(hex);
        this.render();
      });
    });
  }

  private renderGroup(title: string, colors: string[]): string {
    const swatches = colors.map(c => `
      <button class="palette-swatch" data-color="${c}" title="${c}"
        style="background:${c}" aria-label="${c}"></button>
    `).join('');
    return `
      <div class="palette-group">
        <div class="palette-group-label">${title}</div>
        <div class="palette-swatch-grid">${swatches}</div>
      </div>`;
  }
}
