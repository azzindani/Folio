// Folio editor — the quick inspector, anchored to the selection.
//
// The properties sheet is a long form, and long forms belong in a sheet. But
// the four things you change constantly — colour, opacity, text size, order —
// were behind that same trip to the bottom of the screen and back. Those live
// here instead, beside the object, and the sheet keeps the long tail.
//
// Swatches are the colours ALREADY IN THE DESIGN. A generic rainbow invites a
// palette that drifts; the colours you have chosen are the ones you almost
// always want again.
import type { StateManager } from './state';
import type { Layer } from '../schema/types';
import { AnchoredSurface } from './anchored-surface';

const MAX_SWATCHES = 8;

type Rec = Record<string, unknown>;

/** Read a layer's effective colour, whichever shape it is stored in. */
export function colorOf(layer: Layer): string | undefined {
  const l = layer as unknown as Rec;
  const style = l['style'] as Rec | undefined;
  if (typeof style?.['color'] === 'string') return style['color'] as string;
  const fill = l['fill'];
  if (typeof fill === 'string') return fill;
  if (fill && typeof fill === 'object') {
    const c = (fill as Rec)['color'];
    if (typeof c === 'string') return c;
  }
  if (typeof l['color'] === 'string') return l['color'] as string;
  return undefined;
}

/** Build the patch that recolours a layer without changing how it stores it. */
export function colorPatch(layer: Layer, hex: string): Partial<Layer> {
  const l = layer as unknown as Rec;
  if (layer.type === 'text' || l['style'] !== undefined && l['fill'] === undefined) {
    const style = (l['style'] ?? {}) as Rec;
    return { style: { ...style, color: hex } } as unknown as Partial<Layer>;
  }
  const fill = l['fill'];
  if (typeof fill === 'string') return { fill: hex } as unknown as Partial<Layer>;
  const base = (fill && typeof fill === 'object' ? fill : {}) as Rec;
  return { fill: { ...base, type: base['type'] ?? 'solid', color: hex } } as unknown as Partial<Layer>;
}

/** Every colour the design already uses, most-recent first, deduped. */
export function designColors(layers: readonly Layer[]): string[] {
  const seen: string[] = [];
  const walk = (list: readonly Layer[]): void => {
    for (const l of list) {
      const c = colorOf(l);
      if (c && /^#[0-9a-f]{3,8}$/i.test(c) && !seen.includes(c.toLowerCase())) seen.push(c.toLowerCase());
      const kids = (l as unknown as Rec)['layers'];
      if (Array.isArray(kids)) walk(kids as Layer[]);
    }
  };
  walk(layers);
  return seen.slice(0, MAX_SWATCHES);
}

export class QuickEdit {
  private surface: AnchoredSurface;
  private state: StateManager;
  private open = false;
  /** Called when the inspector closes, so the bar can come back. */
  onClose: (() => void) | null = null;

  constructor(container: HTMLElement, state: StateManager) {
    this.state = state;
    this.surface = new AnchoredSurface(container, state, {
      className: 'quick-edit',
      visible: () => this.open,
      render: (el) => this.render(el),
    });
    this.surface.el.addEventListener('click', e => this.onClick(e));
    this.surface.el.addEventListener('input', e => this.onInput(e));
  }

  get isOpen(): boolean { return this.open; }

  toggle(): void { this.open ? this.close() : this.show(); }

  show(): void { this.open = true; this.surface.refresh(); }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.surface.refresh();
    this.onClose?.();
  }

  private first(): Layer | undefined { return this.state.getSelectedLayers()[0]; }

  private render(el: HTMLElement): void {
    const sel = this.state.getSelectedLayers();
    const layer = sel[0];
    if (!layer) return;
    // Rebuild only when the SELECTION changed. A refresh runs on every state
    // change, including the ones this panel itself causes — re-writing the
    // markup then would rip the range input out from under the finger holding
    // it, ending the drag after one pixel. Live values are patched in place.
    const sig = sel.map(l => `${l.id}:${l.type}`).join(',');
    if (el.dataset['sig'] === sig) return;
    el.dataset['sig'] = sig;
    const isText = layer.type === 'text';
    const current = colorOf(layer) ?? '#000000';
    const swatches = designColors(this.state.getCurrentLayers());
    const opacity = Math.round(((layer.opacity ?? 1) as number) * 100);
    const size = Math.round(((layer as unknown as Rec)['style'] as Rec | undefined)?.['font_size'] as number ?? 0);

    el.innerHTML = `
      <div class="qe-head">
        <span class="qe-title">${sel.length > 1 ? `${sel.length} layers` : layer.type}</span>
        <button type="button" class="qe-close" data-qe="close" aria-label="Close">✕</button>
      </div>
      <div class="qe-row qe-swatches" role="group" aria-label="Colour">
        ${swatches.map(c => `<button type="button" class="qe-swatch${c === current.toLowerCase() ? ' active' : ''}"
          data-qe="color" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
        <label class="qe-swatch qe-custom" aria-label="Custom colour">
          <input type="color" data-qe="custom" value="${/^#[0-9a-f]{6}$/i.test(current) ? current : '#000000'}">
        </label>
      </div>
      ${isText && size > 0 ? `<div class="qe-row qe-size">
        <button type="button" class="qe-step" data-qe="size" data-delta="-2" aria-label="Smaller">A−</button>
        <span class="qe-size-val">${size}</span>
        <button type="button" class="qe-step" data-qe="size" data-delta="2" aria-label="Bigger">A+</button>
      </div>` : ''}
      <div class="qe-row qe-opacity">
        <span class="qe-lbl">Opacity</span>
        <input type="range" min="0" max="100" value="${opacity}" data-qe="opacity" aria-label="Opacity">
        <span class="qe-opacity-val">${opacity}%</span>
      </div>
      <button type="button" class="qe-more" data-qe="all">All properties →</button>`;
  }

  private each(patch: (l: Layer) => Partial<Layer>): void {
    const sel = this.state.getSelectedLayers();
    this.state.batch(() => { for (const l of sel) this.state.updateLayer(l.id, patch(l)); });
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-qe]');
    const kind = t?.dataset['qe'];
    if (!kind) return;
    if (kind === 'close') { this.close(); return; }
    if (kind === 'color') {
      const hex = t?.dataset['color'];
      if (hex) { this.each(l => colorPatch(l, hex)); this.markColor(hex); }
      return;
    }
    if (kind === 'size') {
      const delta = Number(t?.dataset['delta'] ?? 0);
      let shown = 0;
      this.each(l => {
        const style = ((l as unknown as Rec)['style'] ?? {}) as Rec;
        const base = typeof style['font_size'] === 'number' ? style['font_size'] : 16;
        shown = Math.max(4, base + delta);
        return { style: { ...style, font_size: shown } } as unknown as Partial<Layer>;
      });
      const out = this.surface.el.querySelector('.qe-size-val');
      if (out && shown) out.textContent = String(Math.round(shown));
      return;
    }
    if (kind === 'all') {
      // The long tail stays in the sheet — this is the handoff, not a dead end.
      this.close();
      document.querySelector<HTMLElement>('.mob-nav-btn[data-mob="props"]')?.click();
    }
  }

  /** Move the "current" ring without a rebuild. */
  private markColor(hex: string): void {
    for (const s of this.surface.el.querySelectorAll<HTMLElement>('.qe-swatch')) {
      s.classList.toggle('active', s.dataset['color']?.toLowerCase() === hex.toLowerCase());
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    const kind = t.dataset['qe'];
    if (kind === 'opacity') {
      const v = Math.max(0, Math.min(100, Number(t.value))) / 100;
      this.each(() => ({ opacity: v }));
      const out = this.surface.el.querySelector('.qe-opacity-val');
      if (out) out.textContent = `${Math.round(v * 100)}%`;
    } else if (kind === 'custom' && this.first()) {
      this.each(l => colorPatch(l, t.value));
      this.markColor(t.value);
    }
  }

  destroy(): void { this.surface.destroy(); }
}
