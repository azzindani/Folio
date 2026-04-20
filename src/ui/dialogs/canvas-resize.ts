/**
 * CanvasResizeDialog — modal for resizing the design canvas.
 *
 * Lets the user set width/height, unit (px/mm/cm/in), and DPI.
 * On confirm, fires onChange with the new document spec.
 */

import type { RulerUnit } from '../../editor/state';
import { unitToPx, pxToUnit } from '../../utils/ruler-units';

export interface CanvasDocSpec {
  width: number;   // px
  height: number;  // px
  dpi: number;
  unit: 'px' | 'mm' | 'cm' | 'in' | 'pt';
}

type ConfirmCallback = (spec: CanvasDocSpec) => void;

const PRESETS: Record<string, { w: number; h: number; label: string }> = {
  'A4 Portrait':    { w: 794, h: 1123, label: 'A4 Portrait (210×297mm)' },
  'A4 Landscape':   { w: 1123, h: 794, label: 'A4 Landscape (297×210mm)' },
  'Letter':         { w: 816, h: 1056, label: 'Letter (8.5×11in)' },
  'Instagram Post': { w: 1080, h: 1080, label: 'Instagram Post (1080×1080px)' },
  'Instagram Story':{ w: 1080, h: 1920, label: 'Instagram Story (1080×1920px)' },
  'Twitter Post':   { w: 1600, h: 900, label: 'Twitter Post (1600×900px)' },
  'Presentation':   { w: 1920, h: 1080, label: 'Presentation (1920×1080px)' },
  '4K':             { w: 3840, h: 2160, label: '4K UHD (3840×2160px)' },
};

export class CanvasResizeDialog {
  private overlay: HTMLElement | null = null;

  open(current: CanvasDocSpec, onConfirm: ConfirmCallback): void {
    this.close();

    const unit: RulerUnit = (['px','mm','cm','in'] as RulerUnit[]).includes(current.unit as RulerUnit)
      ? current.unit as RulerUnit : 'px';

    const toDisplay = (px: number): string => (pxToUnit(px, unit)).toFixed(unit === 'px' ? 0 : 2);
    const w = toDisplay(current.width);
    const h = toDisplay(current.height);

    const presetOptions = Object.entries(PRESETS)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
      .join('');

    this.overlay = document.createElement('div');
    this.overlay.className = 'dialog-overlay';
    this.overlay.innerHTML = `
      <div class="dialog-box" role="dialog" aria-modal="true" aria-label="Resize Canvas">
        <div class="dialog-header">
          <span class="dialog-title">Resize Canvas</span>
          <button class="dialog-close" aria-label="Close">✕</button>
        </div>
        <div class="dialog-body">
          <div class="dialog-row">
            <label class="dialog-label">Preset</label>
            <select id="cr-preset" class="dialog-select">
              <option value="">— Custom —</option>
              ${presetOptions}
            </select>
          </div>
          <div class="dialog-row">
            <label class="dialog-label">Unit</label>
            <select id="cr-unit" class="dialog-select">
              <option value="px"${unit==='px'?' selected':''}>px</option>
              <option value="mm"${unit==='mm'?' selected':''}>mm</option>
              <option value="cm"${unit==='cm'?' selected':''}>cm</option>
              <option value="in"${unit==='in'?' selected':''}>in</option>
            </select>
          </div>
          <div class="dialog-row">
            <label class="dialog-label">Width</label>
            <input id="cr-width" type="number" class="dialog-input" value="${w}" min="1" step="1">
            <span id="cr-unit-label" class="dialog-unit-label">${unit}</span>
          </div>
          <div class="dialog-row">
            <label class="dialog-label">Height</label>
            <input id="cr-height" type="number" class="dialog-input" value="${h}" min="1" step="1">
            <span class="dialog-unit-label">${unit}</span>
          </div>
          <div class="dialog-row">
            <label class="dialog-label">DPI</label>
            <input id="cr-dpi" type="number" class="dialog-input" value="${current.dpi}" min="72" max="600" step="1">
            <span class="dialog-unit-label">dpi</span>
          </div>
          <div class="dialog-info" id="cr-px-size">
            ${current.width} × ${current.height} px
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn" id="cr-cancel">Cancel</button>
          <button class="btn btn-primary" id="cr-confirm">Apply</button>
        </div>
      </div>`;

    document.body.appendChild(this.overlay);
    this.wire(current, unit, onConfirm);
    (this.overlay.querySelector('#cr-width') as HTMLElement)?.focus();
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private wire(current: CanvasDocSpec, initUnit: RulerUnit, onConfirm: ConfirmCallback): void {
    const el = <T extends HTMLElement>(id: string) => this.overlay!.querySelector<T>(`#${id}`)!;

    let unit = initUnit;

    const getWHpx = (): [number, number] => {
      const wv = parseFloat(el<HTMLInputElement>('cr-width').value) || 1;
      const hv = parseFloat(el<HTMLInputElement>('cr-height').value) || 1;
      return [Math.round(unitToPx(wv, unit)), Math.round(unitToPx(hv, unit))];
    };

    const updateInfo = (): void => {
      const [wpx, hpx] = getWHpx();
      el('cr-px-size').textContent = `${wpx} × ${hpx} px`;
    };

    el('cr-width').addEventListener('input', updateInfo);
    el('cr-height').addEventListener('input', updateInfo);

    el<HTMLSelectElement>('cr-unit').addEventListener('change', (e) => {
      const [oldWpx, oldHpx] = getWHpx();
      unit = (e.target as HTMLSelectElement).value as RulerUnit;
      el<HTMLInputElement>('cr-width').value = pxToUnit(oldWpx, unit).toFixed(unit === 'px' ? 0 : 2);
      el<HTMLInputElement>('cr-height').value = pxToUnit(oldHpx, unit).toFixed(unit === 'px' ? 0 : 2);
      this.overlay!.querySelectorAll('.dialog-unit-label').forEach(s => { if (s.id !== 'cr-px-size') s.textContent = unit; });
      updateInfo();
    });

    el<HTMLSelectElement>('cr-preset').addEventListener('change', (e) => {
      const key = (e.target as HTMLSelectElement).value;
      if (!key) return;
      const preset = PRESETS[key];
      el<HTMLInputElement>('cr-width').value = pxToUnit(preset.w, unit).toFixed(unit === 'px' ? 0 : 2);
      el<HTMLInputElement>('cr-height').value = pxToUnit(preset.h, unit).toFixed(unit === 'px' ? 0 : 2);
      updateInfo();
    });

    el('cr-confirm').addEventListener('click', () => {
      const [wpx, hpx] = getWHpx();
      const dpi = parseInt(el<HTMLInputElement>('cr-dpi').value, 10) || current.dpi;
      onConfirm({ width: wpx, height: hpx, dpi, unit });
      this.close();
    });

    const cancel = (): void => this.close();
    el('cr-cancel').addEventListener('click', cancel);
    this.overlay!.querySelector('.dialog-close')?.addEventListener('click', cancel);
    this.overlay!.addEventListener('click', (e) => { if (e.target === this.overlay) cancel(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel(); }, { once: true });
  }
}

export const canvasResizeDialog = new CanvasResizeDialog();
