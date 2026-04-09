import { type StateManager, type EditorState } from '../../editor/state';
import type { Layer, RectLayer, CircleLayer, TextLayer, LineLayer, LinearGradientFill, RadialGradientFill, GradientStop } from '../../schema/types';

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
          <div style="font-size:12px;color:var(--color-text-muted)">${selected.length} layers selected</div>
        </div>`;
      return;
    }

    const layer = selected[0];
    this.renderLayerProperties(layer);
  }

  private renderLayerProperties(layer: Layer): void {
    let html = `
      <div class="prop-section" style="padding:8px;display:flex;flex-direction:column;gap:12px">
        <div>
          <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">ID</div>
          <div style="font-size:13px;font-family:var(--font-mono)">${layer.id}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">Type</div>
          <div style="font-size:13px">${layer.type}</div>
        </div>
    `;

    // Position fields
    html += this.renderPositionFields(layer);

    // Type-specific fields
    switch (layer.type) {
      case 'rect': html += this.renderRectFields(layer); break;
      case 'circle': html += this.renderCircleFields(layer); break;
      case 'text': html += this.renderTextFields(layer); break;
      case 'line': html += this.renderLineFields(layer); break;
    }

    // Z-index
    html += this.renderNumberField('z', 'Z-Index', layer.z);

    // Opacity
    html += this.renderNumberField('opacity', 'Opacity', layer.opacity ?? 1, 0, 1, 0.05);

    // Rotation
    html += this.renderNumberField('rotation', 'Rotation', layer.rotation ?? 0, 0, 360, 1);

    html += '</div>';
    this.content.innerHTML = html;
    this.bindInputs(layer);
  }

  private renderPositionFields(layer: Layer): string {
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
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
    let html = `
      <div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">Linear Gradient</div>
        ${this.renderNumberField('fill.angle', 'Angle (deg)', fill.angle, 0, 360, 1)}
        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px;margin-top:8px">Stops</div>
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

  private renderGradientStop(stop: GradientStop, index: number): string {
    return `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <input type="color" class="prop-input" data-prop="fill.stops.${index}.color" value="${stop.color}"
          style="width:28px;height:24px;border:none;background:none;cursor:pointer;flex-shrink:0">
        <input type="text" class="prop-input" data-prop="fill.stops.${index}.color" value="${stop.color}"
          style="flex:1;background:var(--color-bg);border:1px solid var(--color-border);border-radius:4px;padding:3px 5px;color:var(--color-text);font-size:11px;font-family:var(--font-mono)">
        <input type="number" class="prop-input" data-prop="fill.stops.${index}.position" value="${stop.position}"
          min="0" max="100" step="1"
          style="width:48px;background:var(--color-bg);border:1px solid var(--color-border);border-radius:4px;padding:3px 5px;color:var(--color-text);font-size:11px"
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
    return `
      <div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">${label}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="color" class="prop-input" data-prop="${prop}" value="${value}"
            style="width:32px;height:28px;border:none;background:none;cursor:pointer">
          <input type="text" class="prop-input" data-prop="${prop}" value="${value}"
            style="flex:1;background:var(--color-bg);border:1px solid var(--color-border);
                   border-radius:4px;padding:4px 6px;color:var(--color-text);font-size:12px;font-family:var(--font-mono)">
        </div>
      </div>`;
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
