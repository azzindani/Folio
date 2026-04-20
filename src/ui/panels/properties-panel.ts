import { type StateManager, type EditorState } from '../../editor/state';
import type { Layer, RectLayer, CircleLayer, TextLayer, LineLayer, LinearGradientFill, RadialGradientFill, GradientStop } from '../../schema/types';
import { colorPicker } from '../color-picker/color-picker';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

export class PropertiesPanelManager {
  private container: HTMLElement;
  private state: StateManager;
  private content!: HTMLElement;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.content = container.querySelector('.properties-content') ?? container;
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private onStateChange(state: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.some(k => ['selectedLayerIds', 'design'].includes(k))) {
      this.render();
    }
  }

  render(): void {
    const selected = this.state.getSelectedLayers();

    if (selected.length === 0) {
      this.content.innerHTML = `
        <div style="color:var(--color-text-muted);padding:16px;font-size:12px">
          Select a layer to edit its properties
        </div>`;
      return;
    }

    if (selected.length > 1) {
      this.content.innerHTML = `
        <div style="padding:8px">
          <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:10px">${selected.length} layers selected</div>
          ${selected.length === 2 ? this.renderBooleanOpsSection() : ''}
        </div>`;
      if (selected.length === 2) this.bindBooleanOps(selected[0], selected[1]);
      return;
    }

    const layer = selected[0];
    this.renderLayerProperties(layer);
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
      case 'auto_layout': appearance = this.renderAutoLayoutFields(layer as import('../../schema/types').AutoLayoutLayer); break;
    }
    if (appearance) html += this.section('Appearance', appearance);

    // Transform section
    const transform = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
        ${this.renderNumberInput('z', 'Z', layer.z)}
        ${this.renderNumberInput('opacity', 'Opacity', layer.opacity ?? 1)}
        ${this.renderNumberInput('rotation', 'Rotate°', layer.rotation ?? 0)}
      </div>
      ${this.renderBlendModeField(layer.effects?.blend_mode)}`;
    html += this.section('Transform', transform);

    // Stroke section (all layers that support stroke)
    if ('stroke' in layer) {
      html += this.section('Stroke', this.renderStrokeFields(layer as Layer & { stroke?: import('../../schema/types').Stroke }), true);
    }

    // Effects section — shadows + blur
    html += this.section('Effects', this.renderEffectsFields(layer), true);

    this.content.innerHTML = html;
    this.bindInputs(layer);
    this.bindColorWells(layer);
    this.bindGradientEditor(layer);
    this.bindEffectsButtons(layer);
    this.bindAccordions();
  }

  private renderBooleanOpsSection(): string {
    return `
      <div style="border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:8px">
        <div style="font-size:11px;font-weight:600;color:var(--color-text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">
          Boolean / Mask
        </div>
        <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:8px">
          Top layer clips bottom layer.
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button class="btn btn-sm bool-op-btn" data-op="clip-mask" style="width:100%;text-align:left">
            ⊓ Clip Mask (intersect)
          </button>
          <button class="btn btn-sm bool-op-btn" data-op="release" style="width:100%;text-align:left">
            ✕ Release Mask
          </button>
        </div>
      </div>`;
  }

  private bindBooleanOps(layerA: Layer, layerB: Layer): void {
    // Determine top (higher z) and bottom (lower z) layers
    const [top, bottom] = layerA.z > layerB.z ? [layerA, layerB] : [layerB, layerA];

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
        }
      });
    });
  }

  private renderBlendModeField(current?: string): string {
    const modes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
      'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
      'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
    const options = modes.map(m =>
      `<option value="${m}"${m === (current ?? 'normal') ? ' selected' : ''}>${m}</option>`
    ).join('');
    return `<div style="margin-top:6px">
      <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:3px">Blend</div>
      <select class="prop-input prop-select" data-prop="effects.blend_mode" style="width:100%">
        ${options}
      </select>
    </div>`;
  }

  private renderStrokeFields(layer: Layer & { stroke?: import('../../schema/types').Stroke }): string {
    const s = layer.stroke;
    const color = s?.color ?? '#000000';
    const width = s?.width ?? 1;
    const safe = color.startsWith('#') ? color : '#000000';
    return `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <div class="color-well cp-trigger" data-prop="stroke.color"
          style="background:${safe};width:28px;height:22px;border-radius:4px;
                 border:1px solid var(--color-border);cursor:pointer;flex-shrink:0"></div>
        <input type="text" class="prop-input" data-prop="stroke.color" value="${color}"
          style="flex:1;background:var(--color-bg);border:1px solid var(--color-border);
                 border-radius:4px;padding:3px 6px;color:var(--color-text);font-size:11px;font-family:var(--font-mono)">
        <input type="number" class="prop-input" data-prop="stroke.width" value="${width}" min="0" max="100" step="0.5"
          style="width:52px;background:var(--color-bg);border:1px solid var(--color-border);
                 border-radius:4px;padding:3px 6px;color:var(--color-text);font-size:11px">
      </div>`;
  }

  private renderEffectsFields(layer: Layer): string {
    const shadows = layer.effects?.shadows ?? [];
    const blur = layer.effects?.blur ?? 0;
    const backdropBlur = layer.effects?.backdrop_blur ?? 0;

    let html = `
      <div>
        ${this.renderNumberField('effects.blur', 'Blur', blur, 0, 200, 1)}
        ${this.renderNumberField('effects.backdrop_blur', 'Backdrop Blur', backdropBlur, 0, 200, 1)}
        <div style="font-size:11px;color:var(--color-text-muted);margin:8px 0 4px;display:flex;align-items:center;justify-content:space-between">
          Shadows
          <button class="btn btn-sm" data-action="add-shadow" style="font-size:10px;padding:2px 6px">+ Add</button>
        </div>`;

    shadows.forEach((sh, i) => {
      const sc = sh.color.startsWith('#') ? sh.color : '#000000';
      html += `<div class="shadow-row" data-shadow-index="${i}" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;margin-bottom:6px;padding:6px;background:var(--color-surface-2);border-radius:4px;position:relative">
        <div>
          <div style="font-size:10px;color:var(--color-text-muted)">X</div>
          <input type="number" class="prop-input" data-prop="effects.shadows.${i}.x" value="${sh.x}" step="1"
            style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);border-radius:3px;padding:2px 4px;color:var(--color-text);font-size:11px">
        </div>
        <div>
          <div style="font-size:10px;color:var(--color-text-muted)">Y</div>
          <input type="number" class="prop-input" data-prop="effects.shadows.${i}.y" value="${sh.y}" step="1"
            style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);border-radius:3px;padding:2px 4px;color:var(--color-text);font-size:11px">
        </div>
        <div>
          <div style="font-size:10px;color:var(--color-text-muted)">Blur</div>
          <input type="number" class="prop-input" data-prop="effects.shadows.${i}.blur" value="${sh.blur}" min="0" step="1"
            style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);border-radius:3px;padding:2px 4px;color:var(--color-text);font-size:11px">
        </div>
        <div>
          <div style="font-size:10px;color:var(--color-text-muted)">Spread</div>
          <input type="number" class="prop-input" data-prop="effects.shadows.${i}.spread" value="${sh.spread ?? 0}" step="1"
            style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);border-radius:3px;padding:2px 4px;color:var(--color-text);font-size:11px">
        </div>
        <div style="grid-column:1/-1;display:flex;align-items:center;gap:6px;margin-top:4px">
          <div class="color-well cp-trigger" data-prop="effects.shadows.${i}.color"
            style="background:${sc};width:24px;height:20px;border-radius:3px;border:1px solid var(--color-border);cursor:pointer;flex-shrink:0"></div>
          <input type="text" class="prop-input" data-prop="effects.shadows.${i}.color" value="${sh.color}"
            style="flex:1;background:var(--color-bg);border:1px solid var(--color-border);border-radius:3px;padding:2px 5px;color:var(--color-text);font-size:11px;font-family:var(--font-mono)">
          <button class="btn btn-sm" data-action="remove-shadow" data-shadow-index="${i}" style="font-size:10px;padding:2px 6px;color:var(--color-error)">✕</button>
        </div>
      </div>`;
    });

    html += '</div>';
    return html;
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

  private section(title: string, body: string, collapsed = false): string {
    return `
      <div class="prop-section${collapsed ? ' collapsed' : ''}">
        <div class="prop-section-header">${title}</div>
        <div class="prop-section-body">${body}</div>
      </div>`;
  }

  private bindAccordions(): void {
    this.content.querySelectorAll<HTMLElement>('.prop-section-header').forEach(header => {
      header.addEventListener('click', () => {
        header.closest('.prop-section')?.classList.toggle('collapsed');
      });
    });
  }

  private renderPositionFields(layer: Layer): string {
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
        ${this.renderNumberInput('x', 'X', layer.x ?? 0)}
        ${this.renderNumberInput('y', 'Y', layer.y ?? 0)}
        ${this.renderNumberInput('width', 'W', typeof layer.width === 'number' ? layer.width : 0)}
        ${this.renderNumberInput('height', 'H', typeof layer.height === 'number' ? layer.height : 0)}
      </div>`;
  }

  private renderRectFields(layer: RectLayer): string {
    let html = '';
    html += this.renderFillFields(layer.fill);
    if (typeof layer.radius === 'number') {
      html += this.renderNumberField('radius', 'Radius', layer.radius, 0, 500, 1);
    }
    return html;
  }

  private renderCircleFields(layer: CircleLayer): string {
    return this.renderFillFields(layer.fill);
  }

  private renderFillFields(fill: (RectLayer | CircleLayer)['fill']): string {
    if (!fill || fill.type === 'none') return '';
    if (fill.type === 'solid') {
      return this.renderColorField('fill.color', 'Fill', fill.color);
    }
    if (fill.type === 'linear') {
      return this.renderLinearGradientFields(fill);
    }
    if (fill.type === 'radial') {
      return this.renderRadialGradientFields(fill);
    }
    return '';
  }

  private renderLinearGradientFields(fill: LinearGradientFill): string {
    const stopCss = fill.stops.map(s => `${s.color} ${s.position}%`).join(', ');
    const previewBg = `linear-gradient(to right, ${stopCss})`;
    const thumbs = fill.stops.map((s, i) => this.renderGradientThumb(s.color, s.position, i)).join('');

    let html = `
      <div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">Linear Gradient</div>
        <div class="grad-bar-wrap" style="position:relative;margin-bottom:4px">
          <div class="grad-preview" data-fill-type="linear"
            style="height:20px;border-radius:4px;
              background:${previewBg};border:1px solid var(--color-border);
              cursor:crosshair">
          </div>
          <div class="grad-thumbs" style="position:relative;height:14px">${thumbs}</div>
        </div>
        <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:6px">
          Click bar to add stop · Drag thumbs to move · Double-click thumb to delete
        </div>
        ${this.renderNumberField('fill.angle', 'Angle °', fill.angle, 0, 360, 1)}
        <div style="font-size:11px;color:var(--color-text-muted);margin:6px 0 4px">Stops</div>
    `;
    fill.stops.forEach((stop, i) => {
      html += this.renderGradientStop(stop, i);
    });
    html += '</div>';
    return html;
  }

  private renderRadialGradientFields(fill: RadialGradientFill): string {
    let html = `
      <div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">Radial Gradient</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          ${this.renderNumberInput('fill.cx', 'CX (%)', fill.cx)}
          ${this.renderNumberInput('fill.cy', 'CY (%)', fill.cy)}
        </div>
        ${this.renderNumberField('fill.radius', 'Radius (%)', fill.radius, 0, 200, 1)}
        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px;margin-top:8px">Stops</div>
    `;
    fill.stops.forEach((stop, i) => {
      html += this.renderGradientStop(stop, i);
    });
    html += '</div>';
    return html;
  }

  private renderGradientThumb(color: string, position: number, index: number): string {
    const safe = color.startsWith('#') ? color : '#6c5ce7';
    return `<div class="grad-thumb" data-stop-index="${index}"
      style="position:absolute;left:${position}%;transform:translateX(-50%);
             width:12px;height:12px;background:${safe};
             border:2px solid #fff;border-radius:2px;cursor:ew-resize;
             box-shadow:0 1px 3px rgba(0,0,0,.5);top:1px"></div>`;
  }

  private renderGradientStop(stop: GradientStop, index: number): string {
    const safe = stop.color.startsWith('#') ? stop.color : '#6c5ce7';
    return `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <div class="color-well cp-trigger" data-prop="fill.stops.${index}.color"
          style="background:${safe};width:24px;height:20px;border-radius:3px;
                 border:1px solid var(--color-border);cursor:pointer;flex-shrink:0"></div>
        <input type="text" class="prop-input" data-prop="fill.stops.${index}.color" value="${stop.color}"
          style="flex:1;background:var(--color-bg);border:1px solid var(--color-border);
                 border-radius:4px;padding:3px 5px;color:var(--color-text);font-size:11px;
                 font-family:var(--font-mono)">
        <input type="number" class="prop-input" data-prop="fill.stops.${index}.position"
          value="${stop.position}" min="0" max="100" step="1"
          style="width:44px;background:var(--color-bg);border:1px solid var(--color-border);
                 border-radius:4px;padding:3px 5px;color:var(--color-text);font-size:11px"
          title="Position (0–100)">
      </div>`;
  }

  private renderTextFields(layer: TextLayer): string {
    let html = '';
    if (layer.content.type === 'plain' || layer.content.type === 'markdown') {
      html += `
        <div>
          <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">Content</div>
          <textarea class="prop-input prop-textarea" data-prop="content.value"
            style="width:100%;min-height:60px;resize:vertical;background:var(--color-bg);
                   border:1px solid var(--color-border);border-radius:4px;padding:6px;
                   color:var(--color-text);font-size:12px;font-family:var(--font-mono)"
          >${layer.content.value}</textarea>
        </div>`;
    }
    if (layer.style) {
      html += this.renderNumberField('style.font_size', 'Font Size', layer.style.font_size ?? 16, 1, 500, 1);
      html += this.renderNumberField('style.font_weight', 'Weight', layer.style.font_weight ?? 400, 100, 900, 100);
      if (layer.style.color) {
        html += this.renderColorField('style.color', 'Color', layer.style.color);
      }
    }
    return html;
  }

  private renderLineFields(layer: LineLayer): string {
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        ${this.renderNumberInput('x1', 'X1', layer.x1)}
        ${this.renderNumberInput('y1', 'Y1', layer.y1)}
        ${this.renderNumberInput('x2', 'X2', layer.x2)}
        ${this.renderNumberInput('y2', 'Y2', layer.y2)}
      </div>`;
  }

  private renderAutoLayoutFields(layer: import('../../schema/types').AutoLayoutLayer): string {
    const dir = layer.direction ?? 'row';
    const gap = layer.gap ?? 0;
    const pad = typeof layer.padding === 'number' ? layer.padding : (layer.padding?.top ?? 0);
    const align = layer.align_items ?? 'start';
    const justify = layer.justify_content ?? 'start';

    const dirOpts = ['row', 'column'].map(v =>
      `<option value="${v}"${v === dir ? ' selected' : ''}>${v}</option>`).join('');
    const alignOpts = ['start', 'center', 'end', 'stretch'].map(v =>
      `<option value="${v}"${v === align ? ' selected' : ''}>${v}</option>`).join('');
    const justifyOpts = ['start', 'center', 'end', 'space-between', 'space-around'].map(v =>
      `<option value="${v}"${v === justify ? ' selected' : ''}>${v}</option>`).join('');

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div>
          <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:3px">Direction</div>
          <select class="prop-select" data-prop="direction" style="width:100%">${dirOpts}</select>
        </div>
        <div>
          <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:3px">Wrap</div>
          <input type="checkbox" data-prop="wrap" ${layer.wrap ? 'checked' : ''} style="margin-top:8px">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">
        ${this.renderNumberInput('gap', 'Gap', gap)}
        ${this.renderNumberInput('al-padding', 'Padding', pad)}
      </div>
      <div style="margin-top:6px">
        <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:3px">Align items</div>
        <select class="prop-select" data-prop="align_items" style="width:100%">${alignOpts}</select>
      </div>
      <div style="margin-top:6px">
        <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:3px">Justify content</div>
        <select class="prop-select" data-prop="justify_content" style="width:100%">${justifyOpts}</select>
      </div>`;
  }

  private renderNumberInput(prop: string, label: string, value: number): string {
    return `
      <div>
        <div style="font-size:10px;color:var(--color-text-muted)">${label}</div>
        <input type="number" class="prop-input" data-prop="${prop}" value="${value}"
          style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);
                 border-radius:4px;padding:4px 6px;color:var(--color-text);font-size:12px">
      </div>`;
  }

  private renderNumberField(prop: string, label: string, value: number, min?: number, max?: number, step?: number): string {
    return `
      <div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">${label}</div>
        <input type="number" class="prop-input" data-prop="${prop}" value="${value}"
          ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} ${step !== undefined ? `step="${step}"` : ''}
          style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);
                 border-radius:4px;padding:4px 6px;color:var(--color-text);font-size:12px">
      </div>`;
  }

  private renderColorField(prop: string, label: string, value: string): string {
    const safeVal = value.startsWith('#') ? value : '#6c5ce7';
    return `
      <div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">${label}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <div class="color-well cp-trigger" data-prop="${prop}"
            style="background:${safeVal};width:28px;height:22px;border-radius:4px;
                   border:1px solid var(--color-border);cursor:pointer;flex-shrink:0"></div>
          <input type="text" class="prop-input" data-prop="${prop}" value="${value}"
            style="flex:1;background:var(--color-bg);border:1px solid var(--color-border);
                   border-radius:4px;padding:3px 6px;color:var(--color-text);font-size:11px;
                   font-family:var(--font-mono);outline:none">
        </div>
      </div>`;
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
    const preview = this.content.querySelector<HTMLElement>('.grad-preview');
    const thumbsContainer = this.content.querySelector<HTMLElement>('.grad-thumbs');
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

  private addGradientStop(layerId: string, position: number): void {
    const layers = this.state.getCurrentLayers();
    const layer = layers.find(l => l.id === layerId);
    if (!layer || !('fill' in layer)) return;
    const fill = (layer as { fill?: { type: string; stops?: unknown[] } }).fill;
    if (!fill || (fill.type !== 'linear' && fill.type !== 'radial')) return;

    const stops = [...(fill.stops ?? [])] as Array<{ color: string; position: number }>;
    stops.push({ color: '#ffffff', position });
    stops.sort((a, b) => a.position - b.position);
    this.applyPropertyChange(layerId, 'fill.stops', stops);
  }

  private removeGradientStop(layerId: string, index: number): void {
    const layers = this.state.getCurrentLayers();
    const layer = layers.find(l => l.id === layerId);
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
    const layers = this.state.getCurrentLayers();
    const layer = layers.find(l => l.id === layerId);
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
