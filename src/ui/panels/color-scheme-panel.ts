import { suggestSchemes, generateScheme, type SchemeType } from '../../utils/color-scheme';
import { addToRecent } from './color-palette';

export class ColorSchemePanelManager {
  private container: HTMLElement;
  private onPick: (hex: string) => void;
  private baseColor = '#4a90d9';

  constructor(container: HTMLElement, onPick: (hex: string) => void) {
    this.container = container;
    this.onPick = onPick;
    this.render();
  }

  private render(): void {
    const schemes = suggestSchemes(this.baseColor);
    const swatchRows = schemes.map(scheme => {
      const swatches = scheme.colors.map(c =>
        `<button class="scheme-swatch" data-color="${c}" title="${c}"
          style="background:${c};width:28px;height:28px;border:none;border-radius:4px;
                 cursor:pointer;flex-shrink:0"></button>`
      ).join('');
      return `
        <div class="scheme-row" style="margin-bottom:8px">
          <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:4px;text-transform:capitalize">
            ${scheme.type}
          </div>
          <div style="display:flex;gap:4px">${swatches}</div>
        </div>`;
    }).join('');

    const typeOpts: SchemeType[] = [
      'complementary', 'analogous', 'triadic',
      'split-complementary', 'tetradic', 'monochromatic',
    ];
    const countOpts = [3, 4, 5, 6, 8].map(n =>
      `<option value="${n}"${n === 5 ? ' selected' : ''}>${n}</option>`
    ).join('');

    this.container.innerHTML = `
      <div class="scheme-panel" style="padding:8px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;gap:6px;align-items:center">
          <label style="font-size:10px;color:var(--color-text-muted)">Base</label>
          <input type="color" id="scheme-base" value="${this.baseColor}"
            style="width:36px;height:24px;border:none;padding:0;cursor:pointer">
          <select id="scheme-count" style="font-size:11px;background:var(--color-bg);
            border:1px solid var(--color-border);border-radius:3px;padding:2px 4px;
            color:var(--color-text);margin-left:auto">
            ${countOpts}
          </select>
          <label style="font-size:10px;color:var(--color-text-muted)">colors</label>
        </div>
        <div id="scheme-results">${swatchRows}</div>
      </div>`;

    this.bindEvents(typeOpts);
  }

  private bindEvents(types: SchemeType[]): void {
    const baseInput  = this.container.querySelector<HTMLInputElement>('#scheme-base')!;
    const countSel   = this.container.querySelector<HTMLSelectElement>('#scheme-count')!;
    const results    = this.container.querySelector<HTMLElement>('#scheme-results')!;

    const refresh = () => {
      this.baseColor = baseInput.value;
      const count = parseInt(countSel.value);
      const schemes = types.map(t => generateScheme(this.baseColor, t, count));
      results.innerHTML = schemes.map(scheme => {
        const swatches = scheme.colors.map(c =>
          `<button class="scheme-swatch" data-color="${c}" title="${c}"
            style="background:${c};width:28px;height:28px;border:none;border-radius:4px;
                   cursor:pointer;flex-shrink:0"></button>`
        ).join('');
        return `
          <div class="scheme-row" style="margin-bottom:8px">
            <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:4px;text-transform:capitalize">
              ${scheme.type}
            </div>
            <div style="display:flex;gap:4px">${swatches}</div>
          </div>`;
      }).join('');
      this.bindSwatches();
    };

    baseInput.addEventListener('input', refresh);
    countSel.addEventListener('change', refresh);
    this.bindSwatches();
  }

  private bindSwatches(): void {
    this.container.querySelectorAll<HTMLElement>('.scheme-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        const color = sw.dataset.color!;
        addToRecent(color);
        this.onPick(color);
      });
    });
  }
}
