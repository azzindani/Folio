import { type StateManager, type EditorState } from '../../editor/state';
import type { Layer, ImageLayer } from '../../schema/types';
import { colorPicker } from '../color-picker/color-picker';
import { recolorSVG } from '../../utils/svg-importer';
import { runPathBoolean } from './properties-fill-ops';
import { removeBackground } from '../../utils/bg-remover';
import { attachWheelAdjustAll } from '../inputs/wheel-adjust';
import { renderReportFields, hasReportFields } from './report-fields';
import { PropertiesPanelBase } from './properties-panel-base';
import {
  alignLeft, alignRight, alignTop, alignBottom,
  alignCenterH, alignCenterV, distributeH, distributeV,
} from '../../editor/interactions';
import { groupSelected, ungroupSelected } from '../../editor/layer-actions';
import { sc, altKey, shiftKey } from '../../utils/shortcut';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


export class PropertiesPanelManager extends PropertiesPanelBase {
  constructor(container: HTMLElement, state: StateManager) {
    super();
    this.container = container;
    this.state = state;
    this.content = container.querySelector('.properties-content') ?? container;
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private onStateChange(state: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.some(k => ['selectedLayerIds', 'design', 'currentPageIndex'].includes(k))) {
      this.render();
    }
  }

  render(): void {
    const selected = this.state.getSelectedLayers();

    if (selected.length === 0) {
      this.renderEmptyState();
      return;
    }

    if (selected.length > 1) {
      this.renderMultiSelect(selected);
      return;
    }

    const layer = selected[0];
    this.renderLayerProperties(layer);
  }

  private renderMultiSelect(selected: Layer[]): void {
    const n = selected.length;
    const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
    const minX = Math.min(...selected.map(l => num(l.x)));
    const minY = Math.min(...selected.map(l => num(l.y)));
    const maxX = Math.max(...selected.map(l => num(l.x) + num(l.width)));
    const maxY = Math.max(...selected.map(l => num(l.y) + num(l.height)));
    const hasGroup = selected.some(l => l.type === 'group');
    const aligns: Array<[string, string, string]> = [
      ['align-left', '⫷', 'Align left edges'], ['align-ch', '⫶', 'Center horizontally'],
      ['align-right', '⫸', 'Align right edges'], ['align-top', '⫯', 'Align top edges'],
      ['align-cv', '⫱', 'Center vertically'], ['align-bottom', '⫰', 'Align bottom edges'],
      ['dist-h', '⇹', 'Distribute horizontally'], ['dist-v', '⇳', 'Distribute vertically'],
    ];
    this.content.innerHTML = `
      <div style="padding:8px">
        <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:10px">${n} layers selected</div>
        <div class="prop-section">
          <div class="prop-section-header">Selection</div>
          <div class="prop-section-body" style="padding:8px">
            <div class="prop-info-row"><span>Bounds</span><span>${Math.round(minX)}, ${Math.round(minY)}</span></div>
            <div class="prop-info-row"><span>Size</span><span>${Math.round(maxX - minX)} × ${Math.round(maxY - minY)}</span></div>
            <div style="display:flex;gap:6px;margin-top:8px">
              <button class="prop-btn" data-multi-action="group" style="flex:1" title="Group selection (Ctrl+G)">⧉ Group</button>
              <button class="prop-btn" data-multi-action="ungroup" style="flex:1" title="Ungroup (Ctrl+Shift+G)" ${hasGroup ? '' : 'disabled'}>⧇ Ungroup</button>
            </div>
          </div>
        </div>
        <div class="prop-section">
          <div class="prop-section-header">Align &amp; distribute</div>
          <div class="prop-section-body" style="padding:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:4px">
            ${aligns.map(([k, icon, title]) => `<button class="prop-btn" data-multi-action="${k}" title="${title}" ${k.startsWith('dist') && n < 3 ? 'disabled' : ''}>${icon}</button>`).join('')}
          </div>
        </div>
        ${n === 2 ? this.renderBooleanOpsSection() : ''}
      </div>`;
    this.bindMultiSelect(selected);
    if (n === 2) this.bindBooleanOps(selected[0], selected[1]);
  }

  private bindMultiSelect(_selected: Layer[]): void {
    const fns: Record<string, (state: StateManager) => void> = {
      'group': groupSelected, 'ungroup': ungroupSelected,
      'align-left': alignLeft, 'align-ch': alignCenterH, 'align-right': alignRight,
      'align-top': alignTop, 'align-cv': alignCenterV, 'align-bottom': alignBottom,
      'dist-h': distributeH, 'dist-v': distributeV,
    };
    this.content.querySelectorAll<HTMLButtonElement>('[data-multi-action]').forEach(btn => {
      btn.addEventListener('click', () => fns[btn.dataset.multiAction!]?.(this.state));
    });
  }

  private renderEmptyState(): void {
    const { design, currentPageIndex } = this.state.get();
    if (!design) {
      this.content.innerHTML = `<div style="padding:16px;color:var(--color-text-muted);font-size:12px">No design loaded</div>`;
      return;
    }
    const layerCount = this.state.getCurrentLayers().length;
    const totalLayers = (design.pages ?? [{ layers: design.layers ?? [] }])
      .reduce((s, p) => s + (p.layers?.length ?? 0), 0);
    const pageCount = design.pages?.length ?? 1;
    const { width, height } = design.document;
    const pageLabel = design.pages?.[currentPageIndex]?.label ?? `Page ${currentPageIndex + 1}`;
    const meta = design.meta;

    this.content.innerHTML = `
      <div class="prop-empty">
        <div class="prop-empty-hero">
          <div class="prop-empty-icon">&#9881;</div>
          <div class="prop-empty-title">No selection</div>
          <div class="prop-empty-hint">Click a layer on the canvas or in the layers panel to edit its properties.</div>
        </div>
        <div class="prop-section">
          <div class="prop-section-header">Document</div>
          <div class="prop-section-body" style="padding:8px">
            <div class="prop-info-row"><span>Name</span><span title="${esc(meta.name)}">${esc(meta.name)}</span></div>
            <div class="prop-info-row"><span>Type</span><span>${esc(meta.type ?? 'design')}</span></div>
            <div class="prop-info-row"><span>Size</span><span>${width} × ${height}</span></div>
            ${pageCount > 1 ? `
              <div class="prop-info-row"><span>Page</span><span>${esc(String(pageLabel))} <span style="color:var(--color-text-dim)">(${currentPageIndex + 1}/${pageCount})</span></span></div>
              <div class="prop-info-row"><span>Layers (page)</span><span>${layerCount}</span></div>
              <div class="prop-info-row"><span>Layers (all)</span><span>${totalLayers}</span></div>
            ` : `
              <div class="prop-info-row"><span>Layers</span><span>${layerCount}</span></div>
            `}
          </div>
        </div>
        <div class="prop-section">
          <div class="prop-section-header">Quick tips</div>
          <div class="prop-section-body" style="padding:8px;color:var(--color-text-muted);font-size:11px;line-height:1.5">
            <div><kbd>V</kbd> Select &middot; <kbd>R</kbd>/<kbd>C</kbd>/<kbd>T</kbd>/<kbd>L</kbd> Tools</div>
            <div><kbd>${sc('⌘K')}</kbd> Command palette</div>
            <div><kbd>${sc('⌘0')}</kbd> Fit canvas &middot; <kbd>${sc('⌘1')}</kbd> 100%</div>
            <div><kbd>${altKey()}</kbd>+drag handle resizes from center</div>
            <div><kbd>${altKey()}</kbd>+click cycles stacked layers</div>
            <div><kbd>${shiftKey()}</kbd>+<kbd>H</kbd>/<kbd>V</kbd> Flip selection</div>
          </div>
        </div>
      </div>`;
    this.bindAccordions();
  }

  private renderLayerProperties(layer: Layer): void {
    // Layer identity strip
    let html = `
      <div style="padding:8px 10px;border-bottom:1px solid var(--color-border);
                  display:flex;gap:8px;align-items:center">
        <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;
                     color:var(--color-text-muted)">${layer.type}</span>
        <span style="font-size:11px;font-family:var(--font-mono);color:var(--color-text);
                     overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${layer.id}</span>
      </div>
    `;

    // Position section
    html += this.section('Position & Size', this.renderPositionFields(layer));

    // Appearance section
    let appearance = '';
    switch (layer.type) {
      case 'rect':        appearance = this.renderRectFields(layer); break;
      case 'circle':      appearance = this.renderCircleFields(layer); break;
      case 'text':        appearance = this.renderTextFields(layer); break;
      case 'line':        appearance = this.renderLineFields(layer); break;
      case 'image':       appearance = this.renderImageFields(layer as ImageLayer); break;
      case 'auto_layout': appearance = this.renderAutoLayoutFields(layer as import('../../schema/types').AutoLayoutLayer); break;
    }
    // Interactive report components (chart/table/kpi/button/tabs/…) get a
    // schema-driven property form keyed off the bound datasets.
    if (!appearance && hasReportFields(layer.type)) {
      appearance = renderReportFields(layer, this.reportDatasets());
    }
    if (appearance) html += this.section('Appearance', appearance);

    // Transform section
    const isLocked = !!(layer as { locked?: boolean }).locked;
    const transform = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
        ${this.renderNumberInput('z', 'Z', layer.z)}
        ${this.renderNumberInput('opacity', 'Opacity', layer.opacity ?? 1)}
        ${this.renderNumberInput('rotation', 'Rotate°', layer.rotation ?? 0)}
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap">
        <button id="pp-lock-btn" title="${isLocked ? 'Unlock layer' : 'Lock layer'}"
          style="display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:var(--radius-sm);
                 border:1px solid var(--color-border);background:${isLocked ? 'var(--color-accent)' : 'transparent'};
                 color:${isLocked ? '#fff' : 'var(--color-text)'};cursor:pointer;font-size:11px">
          ${isLocked ? '🔒 Locked' : '🔓 Unlocked'}
        </button>
        <button id="pp-flip-h-btn" title="Flip horizontal"
          style="padding:4px 8px;border-radius:var(--radius-sm);border:1px solid var(--color-border);
                 background:${(layer as {flip_h?:boolean}).flip_h ? 'var(--color-accent)' : 'transparent'};
                 color:${(layer as {flip_h?:boolean}).flip_h ? '#fff' : 'var(--color-text)'};cursor:pointer;font-size:11px">
          ↔ Flip H
        </button>
        <button id="pp-flip-v-btn" title="Flip vertical"
          style="padding:4px 8px;border-radius:var(--radius-sm);border:1px solid var(--color-border);
                 background:${(layer as {flip_v?:boolean}).flip_v ? 'var(--color-accent)' : 'transparent'};
                 color:${(layer as {flip_v?:boolean}).flip_v ? '#fff' : 'var(--color-text)'};cursor:pointer;font-size:11px">
          ↕ Flip V
        </button>
      </div>
      ${this.renderBlendModeField(layer.effects?.blend_mode)}`;
    html += this.section('Transform', transform);

    // Stroke section (all layers that support stroke)
    if ('stroke' in layer) {
      html += this.section('Stroke', this.renderStrokeFields(layer as Layer & { stroke?: import('../../schema/types').Stroke }), true);
    }

    // Effects section — shadows + blur
    html += this.section('Effects', this.renderEffectsFields(layer), true);

    // The panel re-renders on every design change (incl. the edits it triggers
    // itself), which would clobber the field being typed in. Capture the focused
    // field + caret and restore them after the rebuild so editing stays smooth
    // AND linked pickers (e.g. x/y options after a data_ref change) refresh.
    const focus = this.captureFocus();
    this.content.innerHTML = html;
    this.bindInputs(layer);
    this.bindColorWells(layer);
    this.bindGradientEditor(layer);
    this.bindEffectsButtons(layer);
    this.bindReportArrays(layer);
    this.bindPinControl(layer);
    this.bindAccordions();
    if (layer.type === 'image') this.bindSVGRecolor(layer as ImageLayer);
    this.restoreFocus(focus);
  }

  private captureFocus(): { prop: string; start: number | null; end: number | null } | null {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el || !this.content.contains(el) || !el.dataset?.prop) return null;
    let start: number | null = null, end: number | null = null;
    try { start = el.selectionStart; end = el.selectionEnd; } catch { /* number inputs reject selection API */ }
    return { prop: el.dataset.prop, start, end };
  }

  private restoreFocus(f: { prop: string; start: number | null; end: number | null } | null): void {
    if (!f) return;
    const el = this.content.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-prop="${CSS.escape(f.prop)}"]`);
    if (!el) return;
    el.focus();
    try { if (f.start != null) el.setSelectionRange(f.start, f.end ?? f.start); } catch { /* unsupported input type */ }
  }

  // Add/remove buttons for the report-component array editors (table columns,
  // toggle options, tabs, accordion items). Field-level edits inside each array
  // element flow through the generic .prop-input handler via dotted data-prop.
  private bindReportArrays(layer: Layer): void {
    const defaults: Record<string, { prop: string; make?: () => unknown }> = {
      'add-col': { prop: 'columns', make: () => ({ field: '', title: 'Column', align: 'left' }) },
      'del-col': { prop: 'columns' },
      'add-opt': { prop: 'options', make: () => 'Option' },
      'del-opt': { prop: 'options' },
      'add-tab': { prop: 'tabs', make: () => ({ label: 'Tab', layers: [] }) },
      'del-tab': { prop: 'tabs' },
      'add-acc': { prop: 'items', make: () => ({ title: 'Section', body: '' }) },
      'del-acc': { prop: 'items' },
    };
    this.content.querySelectorAll<HTMLButtonElement>('[data-arr-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = btn.dataset.arrAction!;
        const def = defaults[action];
        if (!def) return;
        const cur = this.state.getCurrentLayers().find(l => l.id === layer.id) as unknown as Record<string, unknown> | undefined;
        const arr = Array.isArray(cur?.[def.prop]) ? [...(cur![def.prop] as unknown[])] : [];
        if (action.startsWith('add-')) {
          arr.push(def.make ? def.make() : null);
        } else {
          const idx = Number(btn.dataset.arrIndex);
          if (Number.isInteger(idx) && idx >= 0 && idx < arr.length) arr.splice(idx, 1);
        }
        this.applyPropertyChange(layer.id, def.prop, arr);
      });
    });
  }

  // WP-4.10 — toggle a pin edge on/off; writes layer.constraints.<edge>.
  private bindPinControl(layer: Layer): void {
    this.content.querySelectorAll<HTMLButtonElement>('.pin-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const edge = btn.dataset.pin;
        if (!edge) return;
        const cur = this.state.getCurrentLayers().find(l => l.id === layer.id) as unknown as
          { constraints?: Record<string, boolean> } | undefined;
        const c = { ...(cur?.constraints ?? {}) };
        if (c[edge]) delete c[edge]; else c[edge] = true;
        this.applyPropertyChange(layer.id, 'constraints', Object.keys(c).length ? c : undefined);
      });
    });
  }

  private bindBooleanOps(layerA: Layer, layerB: Layer): void {
    // Determine top (higher z) and bottom (lower z) layers
    const [top, bottom] = layerA.z > layerB.z ? [layerA, layerB] : [layerB, layerA];
    const BOOL: readonly string[] = ['union', 'subtract', 'intersect', 'exclude'];

    this.content.querySelectorAll<HTMLButtonElement>('.bool-op-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const op = btn.dataset.op;
        if (op === 'clip-mask') {
          // Bottom layer clips to top layer's shape; hide top layer
          this.state.updateLayer(bottom.id, { clip_path_ref: top.id } as Partial<Layer>);
          this.state.updateLayer(top.id, { visible: false } as Partial<Layer>);
        } else if (op === 'release') {
          this.state.updateLayer(bottom.id, { clip_path_ref: undefined } as Partial<Layer>);
          this.state.updateLayer(top.id, { visible: true } as Partial<Layer>);
        } else if (op && BOOL.includes(op)) {
          void runPathBoolean(this.state, top, bottom, op as 'union' | 'subtract' | 'intersect' | 'exclude', btn);
        }
      });
    });
  }

  private bindEffectsButtons(layer: Layer): void {
    this.content.querySelector('[data-action="add-shadow"]')?.addEventListener('click', () => {
      const shadows = [...(layer.effects?.shadows ?? [])];
      shadows.push({ x: 0, y: 4, blur: 8, spread: 0, color: 'rgba(0,0,0,0.3)' });
      this.applyPropertyChange(layer.id, 'effects.shadows', shadows);
    });

    this.content.querySelectorAll('[data-action="remove-shadow"]').forEach(btn => {
      const idx = parseInt((btn as HTMLElement).dataset.shadowIndex ?? '0', 10);
      btn.addEventListener('click', () => {
        const shadows = [...(layer.effects?.shadows ?? [])];
        shadows.splice(idx, 1);
        this.applyPropertyChange(layer.id, 'effects.shadows', shadows);
      });
    });

    // Blend mode select
    this.content.querySelectorAll<HTMLSelectElement>('select[data-prop]').forEach(sel => {
      sel.addEventListener('change', () => {
        this.applyPropertyChange(layer.id, sel.dataset.prop!, sel.value);
      });
    });
  }

  private bindAccordions(): void {
    this.content.querySelectorAll<HTMLElement>('.prop-section-header').forEach(header => {
      header.addEventListener('click', () => {
        header.closest('.prop-section')?.classList.toggle('collapsed');
      });
    });
  }

  // Bound datasets (id + column names) for the report-component field pickers.
  // Columns come from a source's inline rows; file/query sources expose [] (the
  // picker falls back to a free-text current value).
  private bindSVGRecolor(layer: ImageLayer): void {
    this.content.querySelectorAll<HTMLInputElement>('.svg-color-picker').forEach(picker => {
      picker.addEventListener('input', () => {
        const original = picker.dataset.original!;
        const newColor = picker.value;
        const colorMap = new Map([[original, newColor]]);
        const newSrc = recolorSVG(layer.src, colorMap);
        this.applyPropertyChange(layer.id, 'src', newSrc);
        const swatch = this.content.querySelector<HTMLElement>(
          `.svg-color-swatch[data-svg-color-index="${picker.dataset.svgColorIndex}"]`
        );
        if (swatch) swatch.style.background = newColor;
      });
    });

    const bgBtn = this.content.querySelector<HTMLButtonElement>('#bg-remove-btn');
    if (bgBtn) {
      bgBtn.addEventListener('click', () => {
        bgBtn.textContent = 'Removing…';
        bgBtn.disabled = true;
        removeBackground(layer.src).then(newSrc => {
          this.applyPropertyChange(layer.id, 'src', newSrc);
        }).catch(() => {
          bgBtn.textContent = 'Failed';
        }).finally(() => {
          bgBtn.disabled = false;
          bgBtn.textContent = 'Remove Background';
        });
      });
    }
  }

  private bindColorWells(layer: Layer): void {
    this.content.querySelectorAll<HTMLElement>('.cp-trigger').forEach(well => {
      well.addEventListener('click', (e) => {
        e.stopPropagation();
        const prop = well.dataset.prop!;
        const currentHex = well.style.background || '#6c5ce7';
        colorPicker.open(well, currentHex, (hex) => {
          well.style.background = hex;
          // Sync matching text input
          const textInput = this.content.querySelector<HTMLInputElement>(
            `input[type="text"][data-prop="${prop}"]`,
          );
          if (textInput) textInput.value = hex;
          this.applyPropertyChange(layer.id, prop, hex);
        });
      });
    });
  }

  private bindGradientEditor(layer: Layer): void {
    // Fill type switcher tabs
    this.content.querySelectorAll<HTMLButtonElement>('.fill-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchFillType(layer.id, btn.dataset.fillType ?? 'solid');
      });
    });

    const preview = this.content.querySelector<HTMLElement>('.grad-preview');
    const thumbsContainer = this.content.querySelector<HTMLElement>('.grad-thumbs');

    // + add stop button
    const addStopBtn = this.content.querySelector<HTMLButtonElement>('.grad-add-stop-btn');
    if (addStopBtn) {
      addStopBtn.addEventListener('click', () => this.addGradientStop(layer.id, 50));
    }

    if (!preview || !thumbsContainer) return;

    // Click on bar → add new stop at that position
    preview.addEventListener('click', (e) => {
      const rect = preview.getBoundingClientRect();
      const pos = Math.round(((e.clientX - rect.left) / rect.width) * 100);
      this.addGradientStop(layer.id, pos);
    });

    // Drag existing thumbs
    thumbsContainer.querySelectorAll<HTMLElement>('.grad-thumb').forEach(thumb => {
      const idx = parseInt(thumb.dataset.stopIndex ?? '0', 10);

      thumb.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.removeGradientStop(layer.id, idx);
      });

      const onMove = (e: MouseEvent) => {
        const rect = thumbsContainer.getBoundingClientRect();
        const pos = Math.round(
          Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 100,
        );
        thumb.style.left = `${pos}%`;
        this.applyPropertyChange(layer.id, `fill.stops.${idx}.position`, pos);
      };

      thumb.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', () => {
          document.removeEventListener('mousemove', onMove);
        }, { once: true });
      });
    });
  }

  private switchFillType(layerId: string, toType: string): void {
    const layer = this.state.findLayer(layerId);
    if (!layer) return;

    const currentFill = (layer as { fill?: { type: string; color?: string; stops?: { color: string; position: number }[]; angle?: number; cx?: number; cy?: number; radius?: number } }).fill;

    let newFill: unknown;
    switch (toType) {
      case 'solid':
        newFill = { type: 'solid', color: currentFill?.stops?.[0]?.color ?? currentFill?.color ?? '#6c5ce7' };
        break;
      case 'linear':
        newFill = {
          type: 'linear',
          angle: currentFill?.angle ?? 135,
          stops: currentFill?.stops ?? [
            { color: currentFill?.color ?? '#6c5ce7', position: 0 },
            { color: '#a29bfe', position: 100 },
          ],
        };
        break;
      case 'radial':
        newFill = {
          type: 'radial',
          cx: currentFill?.cx ?? 50,
          cy: currentFill?.cy ?? 50,
          radius: currentFill?.radius ?? 70,
          stops: currentFill?.stops ?? [
            { color: currentFill?.color ?? '#6c5ce7', position: 0 },
            { color: '#1a1a2e', position: 100 },
          ],
        };
        break;
      case 'pattern':
        newFill = {
          type: 'pattern',
          pattern: 'dots',
          fg: currentFill?.color ?? currentFill?.stops?.[0]?.color ?? '#1a1a1a',
          bg: '#ffffff',
        };
        break;
      case 'image':
        newFill = { type: 'image', src: '', mode: 'cover' };
        break;
      case 'none':
        newFill = { type: 'none' };
        break;
      default:
        return;
    }
    this.applyPropertyChange(layerId, 'fill', newFill);
  }

  private addGradientStop(layerId: string, position: number): void {
    const layer = this.state.findLayer(layerId);
    if (!layer || !('fill' in layer)) return;
    const fill = (layer as { fill?: { type: string; stops?: unknown[] } }).fill;
    if (!fill || (fill.type !== 'linear' && fill.type !== 'radial')) return;

    const stops = [...(fill.stops ?? [])] as Array<{ color: string; position: number }>;
    stops.push({ color: '#ffffff', position });
    stops.sort((a, b) => a.position - b.position);
    this.applyPropertyChange(layerId, 'fill.stops', stops);
  }

  private removeGradientStop(layerId: string, index: number): void {
    const layer = this.state.findLayer(layerId);
    if (!layer || !('fill' in layer)) return;
    const fill = (layer as { fill?: { type: string; stops?: unknown[] } }).fill;
    if (!fill || !fill.stops || fill.stops.length <= 2) return; // keep ≥ 2 stops

    const stops = [...fill.stops];
    stops.splice(index, 1);
    this.applyPropertyChange(layerId, 'fill.stops', stops);
  }

  private bindInputs(layer: Layer): void {
    this.content.querySelectorAll('.prop-input').forEach(input => {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      const prop = el.dataset.prop!;

      const handler = () => {
        const value = el.type === 'number' ? parseFloat(el.value) : el.value;
        this.applyPropertyChange(layer.id, prop, value);
      };

      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });

    // Boolean checkboxes (report-component forms) write a real boolean.
    this.content.querySelectorAll<HTMLInputElement>('input.prop-check[data-prop]').forEach(cb => {
      cb.addEventListener('change', () => {
        this.applyPropertyChange(layer.id, cb.dataset.prop!, cb.checked);
      });
    });

    // Mouse-wheel adjusts every number field. Shift = ×10, Alt = ×0.1.
    attachWheelAdjustAll(this.content);

    // Lock toggle
    const lockBtn = this.content.querySelector<HTMLButtonElement>('#pp-lock-btn');
    if (lockBtn) {
      lockBtn.addEventListener('click', () => {
        const cur = !!(layer as { locked?: boolean }).locked;
        this.applyPropertyChange(layer.id, 'locked', !cur);
      });
    }

    // Toggle uniform ↔ per-corner radius
    const toggleCornersBtn = this.content.querySelector<HTMLButtonElement>('[data-prop-action="toggle-corners"]');
    if (toggleCornersBtn) {
      toggleCornersBtn.addEventListener('click', () => {
        const cur = (layer as { radius?: number | { tl: number; tr: number; br: number; bl: number } }).radius;
        if (typeof cur === 'object' && cur) {
          // Per-corner → uniform: collapse to max corner value
          const max = Math.max(cur.tl ?? 0, cur.tr ?? 0, cur.br ?? 0, cur.bl ?? 0);
          this.applyPropertyChange(layer.id, 'radius', max);
        } else {
          // Uniform → per-corner: expand the single value to all 4 corners
          const v = typeof cur === 'number' ? cur : 0;
          this.applyPropertyChange(layer.id, 'radius', { tl: v, tr: v, br: v, bl: v });
        }
      });
    }

    // Flip toggles
    const flipHBtn = this.content.querySelector<HTMLButtonElement>('#pp-flip-h-btn');
    if (flipHBtn) {
      flipHBtn.addEventListener('click', () => {
        const cur = !!(layer as { flip_h?: boolean }).flip_h;
        this.applyPropertyChange(layer.id, 'flip_h', !cur);
      });
    }
    const flipVBtn = this.content.querySelector<HTMLButtonElement>('#pp-flip-v-btn');
    if (flipVBtn) {
      flipVBtn.addEventListener('click', () => {
        const cur = !!(layer as { flip_v?: boolean }).flip_v;
        this.applyPropertyChange(layer.id, 'flip_v', !cur);
      });
    }

    // Auto-layout special inputs
    const wrapCb = this.content.querySelector<HTMLInputElement>('input[data-prop="wrap"]');
    if (wrapCb) {
      wrapCb.addEventListener('change', () => {
        this.applyPropertyChange(layer.id, 'wrap', wrapCb.checked);
      });
    }

    const padInput = this.content.querySelector<HTMLInputElement>('input[data-prop="al-padding"]');
    if (padInput) {
      padInput.addEventListener('change', () => {
        this.applyPropertyChange(layer.id, 'padding', parseFloat(padInput.value));
      });
    }

    const gapInput = this.content.querySelector<HTMLInputElement>('input[data-prop="gap"]');
    if (gapInput) {
      gapInput.addEventListener('change', () => {
        this.applyPropertyChange(layer.id, 'gap', parseFloat(gapInput.value));
      });
    }
  }

  private applyPropertyChange(layerId: string, path: string, value: unknown): void {
    const parts = path.split('.');

    if (parts.length === 1) {
      this.state.updateLayer(layerId, { [parts[0]]: value } as Partial<Layer>);
      return;
    }

    // Nested property updates (supports array indices, e.g. fill.stops.0.color)
    const layer = this.state.findLayer(layerId);
    if (!layer) return;

    const update = deepClone(layer) as unknown as Record<string, unknown>;
    let current = update;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const nextKey = parts[i + 1];
      const isNextNumeric = /^\d+$/.test(nextKey);
      const existing = (current as Record<string, unknown>)[key];
      if (isNextNumeric) {
        // Next level is an array index — ensure current[key] is an array
        (current as Record<string, unknown>)[key] = Array.isArray(existing) ? [...existing] : [];
      } else {
        (current as Record<string, unknown>)[key] = typeof existing === 'object' && existing !== null && !Array.isArray(existing)
          ? { ...existing as Record<string, unknown> }
          : {};
      }
      current = (current as Record<string, unknown>)[key] as Record<string, unknown>;
    }
    (current as Record<string, unknown>)[parts[parts.length - 1]] = value;

    this.state.updateLayer(layerId, update as Partial<Layer>);
  }
}
