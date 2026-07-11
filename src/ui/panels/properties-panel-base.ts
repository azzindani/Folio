// Folio properties panel — base class: stateless field/HTML builders + dataset
// helpers. Split out of properties-panel.ts to stay within the line budget;
// PropertiesPanelManager extends this with lifecycle + event binding. Verbatim.
import { type StateManager } from '../../editor/state';
import type { Layer, RectLayer, CircleLayer, TextLayer, LineLayer, ImageLayer, LinearGradientFill, RadialGradientFill, GradientStop } from '../../schema/types';
import { extractSVGColors } from '../../utils/svg-importer';
import { flowGridMetrics } from '../../renderer/flow-layout';
import { widthToSpan } from '../../editor/flow-edit';
import { type DatasetInfo } from './report-fields';

export abstract class PropertiesPanelBase {
  protected container!: HTMLElement;
  protected state!: StateManager;
  protected content!: HTMLElement;

  protected renderBooleanOpsSection(): string {
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

  protected renderBlendModeField(current?: string): string {
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

  protected renderStrokeFields(layer: Layer & { stroke?: import('../../schema/types').Stroke }): string {
    const s = layer.stroke;
    const colorVal = s?.color ?? '#000000';
    const color = typeof colorVal === 'string' ? colorVal : '#000000';
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

  protected renderEffectsFields(layer: Layer): string {
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

  protected section(title: string, body: string, collapsed = false): string {
    return `
      <div class="prop-section${collapsed ? ' collapsed' : ''}">
        <div class="prop-section-header">${title}</div>
        <div class="prop-section-body">${body}</div>
      </div>`;
  }

  protected reportDatasets(): DatasetInfo[] {
    const sources = this.state.get().design?.report?.data?.sources;
    if (!Array.isArray(sources)) return [];
    return sources.map(s => {
      const rows = (s as { rows?: Record<string, unknown>[] }).rows;
      const columns = Array.isArray(rows) && rows[0] ? Object.keys(rows[0]) : [];
      return { id: s.id, columns };
    });
  }

  // True when the active design is a flow/scroll report — layers are positioned
  // by document order + 12-col span, not free x/y/width/height.
  protected isFlowReport(): boolean {
    const r = this.state.get().design?.report;
    return !!r && (r.layout === 'flow' || r.flow === true);
  }

  protected renderPositionFields(layer: Layer): string {
    if (this.isFlowReport()) return this.renderFlowPositionFields(layer);
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
        ${this.renderNumberInput('x', 'X', layer.x ?? 0)}
        ${this.renderNumberInput('y', 'Y', layer.y ?? 0)}
        ${this.renderNumberInput('width', 'W', typeof layer.width === 'number' ? layer.width : 0)}
        ${this.renderNumberInput('height', 'H', typeof layer.height === 'number' ? layer.height : 0)}
      </div>${this.renderPinControl(layer)}`;
  }

  // WP-4.10 — pin toggles: which edges hold their offset when the doc resizes.
  // Left+Right (or Top+Bottom) both lit → the layer STRETCHES on that axis.
  protected renderPinControl(layer: Layer): string {
    const c = (layer as { constraints?: Record<string, boolean> }).constraints ?? {};
    const on = (k: string): string => c[k]
      ? 'background:var(--color-accent,#3b82f6);color:#fff;border-color:var(--color-accent,#3b82f6)'
      : 'background:var(--color-bg);color:var(--color-text-muted);border-color:var(--color-border)';
    const btn = (edge: string, label: string): string =>
      `<button type="button" class="pin-btn" data-pin="${edge}" title="Pin ${edge}"
        style="width:22px;height:22px;border:1px solid;border-radius:4px;font-size:10px;cursor:pointer;padding:0;${on(edge)}">${label}</button>`;
    return `
      <div style="margin-top:8px">
        <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:4px">Pin to edges (resize)</div>
        <div style="display:grid;grid-template-columns:repeat(3,22px);gap:3px;justify-content:start">
          <span></span>${btn('top', 'T')}<span></span>
          ${btn('left', 'L')}<span style="width:22px"></span>${btn('right', 'R')}
          <span></span>${btn('bottom', 'B')}<span></span>
        </div>
      </div>`;
  }

  // Flow layers: editable Span (1–12) + explicit row Height (flow_h). Width and
  // y are derived by the layout each render, so showing/editing them is moot.
  protected renderFlowPositionFields(layer: Layer): string {
    const { design } = this.state.get();
    const docW = design?.document?.width;
    const maxW = design?.report?.max_width;
    const cw = (typeof maxW === 'number' && maxW > 0 ? maxW : 0) || (typeof docW === 'number' ? docW : 0) || 1200;
    const m = flowGridMetrics({ containerWidth: cw });
    const lr = layer as unknown as Record<string, unknown>;
    const span = typeof lr['span'] === 'number'
      ? (lr['span'] as number)
      : widthToSpan(typeof layer.width === 'number' ? layer.width : 0, m);
    const flowH = typeof lr['flow_h'] === 'number'
      ? (lr['flow_h'] as number)
      : (typeof layer.height === 'number' ? Math.round(layer.height) : 0);
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
        <div>
          <div style="font-size:10px;color:var(--color-text-muted)">Span (1–12)</div>
          <input type="number" class="prop-input" data-prop="span" value="${span}" min="1" max="12" step="1"
            style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);
                   border-radius:4px;padding:4px 6px;color:var(--color-text);font-size:12px">
        </div>
        <div>
          <div style="font-size:10px;color:var(--color-text-muted)">Height</div>
          <input type="number" class="prop-input" data-prop="flow_h" value="${flowH}" min="40" step="1"
            style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);
                   border-radius:4px;padding:4px 6px;color:var(--color-text);font-size:12px">
        </div>
      </div>
      <div style="font-size:10px;color:var(--color-text-dim);padding:4px 0 0">
        Flow layout · drag the body to reorder, side handles to set span, bottom handle for height.
      </div>`;
  }

  protected renderRectFields(layer: RectLayer): string {
    let html = '';
    html += this.renderFillFields(layer.fill);
    // Uniform radius input — always visible, defaults to 0
    const r = layer.radius;
    const uniform = typeof r === 'number' ? r : (r ? '' : 0);
    html += `<div class="prop-row">
      <label class="prop-label">Radius</label>
      <div style="display:flex;gap:4px;align-items:center">
        <input type="number" class="prop-input" data-prop="radius"
          value="${uniform}" placeholder="${typeof r === 'object' ? 'mixed' : '0'}"
          min="0" step="1" style="flex:1" />
        <button class="prop-btn" data-prop-action="toggle-corners" title="Toggle per-corner radius">
          ${typeof r === 'object' ? '⊟' : '⊞'}
        </button>
      </div>
    </div>`;
    if (typeof r === 'object' && r) {
      html += `<div class="prop-corner-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px 8px 8px">
        <input type="number" class="prop-input" data-prop="radius.tl" value="${r.tl ?? 0}" min="0" step="1" placeholder="TL" title="Top-left" />
        <input type="number" class="prop-input" data-prop="radius.tr" value="${r.tr ?? 0}" min="0" step="1" placeholder="TR" title="Top-right" />
        <input type="number" class="prop-input" data-prop="radius.bl" value="${r.bl ?? 0}" min="0" step="1" placeholder="BL" title="Bottom-left" />
        <input type="number" class="prop-input" data-prop="radius.br" value="${r.br ?? 0}" min="0" step="1" placeholder="BR" title="Bottom-right" />
      </div>`;
    }
    return html;
  }

  protected renderCircleFields(layer: CircleLayer): string {
    return this.renderFillFields(layer.fill);
  }

  protected renderFillFields(fill: (RectLayer | CircleLayer)['fill']): string {
    const activeType = fill?.type ?? 'none';
    const types: Array<{ key: string; label: string }> = [
      { key: 'solid',  label: 'Solid'  },
      { key: 'linear', label: 'Linear' },
      { key: 'radial', label: 'Radial' },
      { key: 'none',   label: 'None'   },
    ];
    const tabs = types.map(t => {
      const active = activeType === t.key;
      return `<button class="fill-type-btn" data-fill-type="${t.key}"
        style="flex:1;padding:3px 0;font-size:10px;border:1px solid var(--color-border);
               background:${active ? 'var(--color-accent)' : 'var(--color-bg)'};
               color:${active ? '#fff' : 'var(--color-text-muted)'};
               border-radius:3px;cursor:pointer">${t.label}</button>`;
    }).join('');

    let body = '';
    if (!fill || fill.type === 'none') {
      body = '';
    } else if (fill.type === 'solid') {
      body = this.renderColorField('fill.color', 'Fill', fill.color);
    } else if (fill.type === 'linear') {
      body = this.renderLinearGradientFields(fill);
    } else if (fill.type === 'radial') {
      body = this.renderRadialGradientFields(fill);
    }

    return `
      <div style="margin-bottom:6px">
        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">Fill</div>
        <div class="fill-type-tabs" style="display:flex;gap:3px;margin-bottom:6px">${tabs}</div>
        ${body}
      </div>`;
  }

  protected renderLinearGradientFields(fill: LinearGradientFill): string {
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
        <div style="display:flex;align-items:center;justify-content:space-between;margin:6px 0 4px">
          <span style="font-size:11px;color:var(--color-text-muted)">Stops</span>
          <button class="grad-add-stop-btn" style="font-size:11px;background:none;border:1px solid var(--color-border);
            border-radius:3px;color:var(--color-text-muted);cursor:pointer;padding:1px 6px">+</button>
        </div>
    `;
    fill.stops.forEach((stop, i) => {
      html += this.renderGradientStop(stop, i);
    });
    html += '</div>';
    return html;
  }

  protected renderRadialGradientFields(fill: RadialGradientFill): string {
    const stopCss = fill.stops.map(s => `${s.color} ${s.position}%`).join(', ');
    const previewBg = `radial-gradient(circle at ${fill.cx ?? 50}% ${fill.cy ?? 50}%, ${stopCss})`;
    const thumbs = fill.stops.map((s, i) => this.renderGradientThumb(s.color, s.position, i)).join('');

    let html = `
      <div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">Radial Gradient</div>
        <div class="grad-bar-wrap" style="position:relative;margin-bottom:4px">
          <div class="grad-preview" data-fill-type="radial"
            style="height:20px;border-radius:4px;background:${previewBg};
                   border:1px solid var(--color-border);cursor:crosshair">
          </div>
          <div class="grad-thumbs" style="position:relative;height:14px">${thumbs}</div>
        </div>
        <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:6px">
          Click bar to add stop · Drag thumbs to move · Double-click thumb to delete
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          ${this.renderNumberInput('fill.cx', 'CX (%)', fill.cx ?? 50)}
          ${this.renderNumberInput('fill.cy', 'CY (%)', fill.cy ?? 50)}
        </div>
        ${this.renderNumberField('fill.radius', 'Radius (%)', fill.radius ?? 50, 0, 200, 1)}
        <div style="display:flex;align-items:center;justify-content:space-between;margin:6px 0 4px">
          <span style="font-size:11px;color:var(--color-text-muted)">Stops</span>
          <button class="grad-add-stop-btn" style="font-size:11px;background:none;border:1px solid var(--color-border);
            border-radius:3px;color:var(--color-text-muted);cursor:pointer;padding:1px 6px">+</button>
        </div>
    `;
    fill.stops.forEach((stop, i) => {
      html += this.renderGradientStop(stop, i);
    });
    html += '</div>';
    return html;
  }

  protected renderGradientThumb(color: string, position: number, index: number): string {
    const safe = color.startsWith('#') ? color : '#6c5ce7';
    return `<div class="grad-thumb" data-stop-index="${index}"
      style="position:absolute;left:${position}%;transform:translateX(-50%);
             width:12px;height:12px;background:${safe};
             border:2px solid #fff;border-radius:2px;cursor:ew-resize;
             box-shadow:0 1px 3px rgba(0,0,0,.5);top:1px"></div>`;
  }

  protected renderGradientStop(stop: GradientStop, index: number): string {
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

  protected renderTextFields(layer: TextLayer): string {
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
      html += this.renderFontPicker('style.font_family', layer.style.font_family ?? '');
      html += this.renderNumberField('style.font_size', 'Font Size', layer.style.font_size ?? 16, 1, 500, 1);
      html += this.renderNumberField('style.font_weight', 'Weight', layer.style.font_weight ?? 400, 100, 900, 100);
      if (layer.style.color) {
        const styleColor = typeof layer.style.color === 'string' ? layer.style.color : '#000000';
        html += this.renderColorField('style.color', 'Color', styleColor);
      }
    }
    // Link — set an href so the layer renders as a real clickable hyperlink
    // (wrapped in an SVG <a> by renderLayer) in the editor, HTML and PDF export.
    const href = typeof (layer as { href?: unknown }).href === 'string' ? (layer as { href: string }).href : '';
    html += `
      <div style="margin-top:6px">
        <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:3px">Link (URL)</div>
        <input type="text" class="prop-input" data-prop="href" value="${href}" placeholder="https://…"
          style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);
                 border-radius:4px;padding:4px 6px;color:var(--color-text);font-size:12px">
      </div>`;
    return html;
  }

  protected renderFontPicker(prop: string, current: string): string {
    const fonts = [
      'Inter','Roboto','Open Sans','Lato','Poppins','Montserrat','Raleway','Nunito',
      'Source Sans Pro','PT Sans','Ubuntu','Noto Sans','Playfair Display','Merriweather',
      'Georgia','Times New Roman','Arial','Helvetica','Verdana','Trebuchet MS',
      'Courier New','Courier Prime','Source Code Pro','JetBrains Mono','Fira Code',
    ];
    const opts = fonts.map(f =>
      `<option value="${f}"${f === current ? ' selected' : ''}>${f}</option>`
    ).join('');
    // B12: a token value ($heading) or an empty field told the user nothing.
    // Resolve against the active theme so the REAL family is visible — the
    // input keeps the raw value, so a token stays a token when edited.
    let resolved = '';
    if (!current || current.startsWith('$')) {
      const fams = this.state?.get?.().theme?.typography?.families ?? {};
      const key = current ? current.slice(1) : 'body';
      resolved = fams[key] ?? fams['body'] ?? '';
    }
    const preview = (current && !current.startsWith('$') ? current : resolved) || 'Inter';
    const hint = current.startsWith('$') && resolved
      ? `<div style="font-size:10px;color:var(--color-text-muted);margin-top:2px">→ ${resolved}</div>`
      : '';
    return `
      <div style="margin-bottom:6px">
        <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:3px">Font Family</div>
        <input list="font-datalist" class="prop-input" data-prop="${prop}" value="${current}"
          placeholder="${resolved ? `${resolved} (theme)` : 'theme default'}"
          style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);
                 border-radius:4px;padding:4px 6px;color:var(--color-text);font-size:12px;
                 font-family:'${preview}',sans-serif">
        <datalist id="font-datalist">${opts}</datalist>${hint}
      </div>`;
  }

  protected renderLineFields(layer: LineLayer): string {
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        ${this.renderNumberInput('x1', 'X1', layer.x1)}
        ${this.renderNumberInput('y1', 'Y1', layer.y1)}
        ${this.renderNumberInput('x2', 'X2', layer.x2)}
        ${this.renderNumberInput('y2', 'Y2', layer.y2)}
      </div>`;
  }

  protected renderImageFields(layer: ImageLayer): string {
    const isSVG = layer.src.startsWith('data:image/svg+xml');
    const isRaster = layer.src.startsWith('data:image/png') || layer.src.startsWith('data:image/jpeg') || layer.src.startsWith('blob:');

    let html = '';

    if (isRaster) {
      html += `
        <div style="margin-bottom:8px">
          <button class="btn btn-sm" id="bg-remove-btn" style="width:100%">Remove Background</button>
        </div>`;
    }

    if (isSVG) {
      const colors = this.parseSVGColors(layer.src);
      if (colors.length > 0) {
        const swatches = colors.map((c, i) => `
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <div class="svg-color-swatch" data-svg-color-index="${i}"
              style="width:22px;height:22px;border-radius:3px;border:1px solid var(--color-border);
                     background:${c};flex-shrink:0"></div>
            <input type="color" class="svg-color-picker" data-svg-color-index="${i}"
                   data-original="${c}" value="${c}"
                   style="width:36px;height:22px;border:none;padding:0;cursor:pointer">
            <span style="font-size:11px;font-family:var(--font-mono);color:var(--color-text-muted)">${c}</span>
          </div>`).join('');
        html += `<div><div style="font-size:10px;color:var(--color-text-muted);margin-bottom:6px">SVG Colors</div>${swatches}</div>`;
      }
    }

    return html;
  }

  protected parseSVGColors(dataUrl: string): string[] {
    try {
      const raw = atob(dataUrl.replace(/^data:image\/svg\+xml;base64,/, ''));
      const text = decodeURIComponent(escape(raw));
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      return extractSVGColors(doc.documentElement);
    } catch {
      return [];
    }
  }

  protected renderAutoLayoutFields(layer: import('../../schema/types').AutoLayoutLayer): string {
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

  protected renderNumberInput(prop: string, label: string, value: number): string {
    return `
      <div>
        <div style="font-size:10px;color:var(--color-text-muted)">${label}</div>
        <input type="number" class="prop-input" data-prop="${prop}" value="${value}"
          style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);
                 border-radius:4px;padding:4px 6px;color:var(--color-text);font-size:12px">
      </div>`;
  }

  protected renderNumberField(prop: string, label: string, value: number, min?: number, max?: number, step?: number): string {
    return `
      <div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">${label}</div>
        <input type="number" class="prop-input" data-prop="${prop}" value="${value}"
          ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} ${step !== undefined ? `step="${step}"` : ''}
          style="width:100%;background:var(--color-bg);border:1px solid var(--color-border);
                 border-radius:4px;padding:4px 6px;color:var(--color-text);font-size:12px">
      </div>`;
  }

  protected renderColorField(prop: string, label: string, value: string): string {
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

}
