/**
 * Lightweight HSL color picker popover.
 * Usage:
 *   const picker = new ColorPicker();
 *   picker.open(anchorEl, '#ff0000', (hex) => { ... });
 */

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const sl = s / 100, ll = l / 100;
  const a = sl * Math.min(ll, 1 - ll);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const col = ll - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * col).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export class ColorPicker {
  private popover: HTMLElement | null = null;
  private onChangeCb: ((hex: string) => void) | null = null;
  private currentH = 0;
  private currentS = 100;
  private currentL = 50;
  private currentA = 1;

  open(anchor: HTMLElement, initialColor: string, onChange: (hex: string) => void): void {
    this.close();
    this.onChangeCb = onChange;

    const hex = initialColor.startsWith('#') ? initialColor : '#6c5ce7';
    [this.currentH, this.currentS, this.currentL] = hexToHsl(hex);

    this.popover = this.buildPopover();
    document.body.appendChild(this.popover);
    this.syncUI();
    this.position(anchor);

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', this.handleOutside, { once: false });
    }, 0);
  }

  close(): void {
    if (this.popover) {
      this.popover.remove();
      this.popover = null;
    }
    document.removeEventListener('click', this.handleOutside);
  }

  private handleOutside = (e: MouseEvent): void => {
    if (!this.popover?.contains(e.target as Node)) {
      this.close();
    }
  };

  private position(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const pop = this.popover!;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = rect.bottom + 4;
    let left = rect.left;
    if (left + 240 > vw) left = vw - 248;
    if (top + 340 > vh) top = rect.top - 340 - 4;
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
  }

  private buildPopover(): HTMLElement {
    const pop = document.createElement('div');
    pop.className = 'color-picker-popover';
    pop.style.cssText = 'position:fixed;z-index:9999;user-select:none;';
    pop.innerHTML = `
      <canvas class="cp-sv-canvas" width="216" height="160"
        style="border-radius:4px;cursor:crosshair;display:block;width:100%"></canvas>
      <div class="cp-hue-track" style="margin-top:8px;height:12px;border-radius:6px;cursor:pointer;
        background:linear-gradient(to right,hsl(0,100%,50%),hsl(30,100%,50%),hsl(60,100%,50%),
        hsl(90,100%,50%),hsl(120,100%,50%),hsl(150,100%,50%),hsl(180,100%,50%),
        hsl(210,100%,50%),hsl(240,100%,50%),hsl(270,100%,50%),hsl(300,100%,50%),
        hsl(330,100%,50%),hsl(360,100%,50%));position:relative">
        <div class="cp-hue-thumb" style="position:absolute;top:-2px;width:16px;height:16px;
          border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);
          transform:translateX(-50%);pointer-events:none"></div>
      </div>
      <div class="cp-alpha-track" style="margin-top:6px;height:12px;border-radius:6px;cursor:pointer;
        position:relative;background-image:linear-gradient(45deg,#ccc 25%,transparent 25%),
        linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),
        linear-gradient(-45deg,transparent 75%,#ccc 75%);background-size:8px 8px;
        background-position:0 0,0 4px,4px -4px,-4px 0">
        <div class="cp-alpha-gradient" style="position:absolute;inset:0;border-radius:6px"></div>
        <div class="cp-alpha-thumb" style="position:absolute;top:-2px;width:16px;height:16px;
          border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);
          transform:translateX(-50%);pointer-events:none"></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;align-items:center">
        <div class="cp-preview" style="width:28px;height:28px;border-radius:4px;
          border:1px solid rgba(255,255,255,.15);flex-shrink:0"></div>
        <input class="cp-hex-input" type="text" maxlength="7"
          style="flex:1;padding:4px 6px;border:1px solid var(--color-border);
          border-radius:4px;background:var(--color-bg);color:var(--color-text);
          font-size:11px;font-family:var(--font-mono);outline:none">
      </div>
      <div class="cp-swatches" style="display:grid;grid-template-columns:repeat(8,1fr);gap:3px;margin-top:8px"></div>
    `;

    this.bindEvents(pop);
    this.buildSwatches(pop);
    return pop;
  }

  private buildSwatches(pop: HTMLElement): void {
    const SWATCHES = [
      '#ffffff','#e2e2ea','#7a7a9a','#2a2a3e','#0d0d14',
      '#6c5ce7','#e94560','#00b894','#fdcb6e','#0078d4',
      '#ff6b35','#00d4ff','#7b2fff','#2ecc71','#f39c12','#e74c3c',
    ];
    const grid = pop.querySelector('.cp-swatches')!;
    for (const hex of SWATCHES) {
      const s = document.createElement('div');
      s.className = 'color-swatch';
      s.style.background = hex;
      s.title = hex;
      s.addEventListener('click', (e) => {
        e.stopPropagation();
        [this.currentH, this.currentS, this.currentL] = hexToHsl(hex);
        this.syncUI();
        this.emit();
      });
      grid.appendChild(s);
    }
  }

  private bindEvents(pop: HTMLElement): void {
    const canvas = pop.querySelector<HTMLCanvasElement>('.cp-sv-canvas')!;
    const hueTrack = pop.querySelector<HTMLElement>('.cp-hue-track')!;
    const alphaTrack = pop.querySelector<HTMLElement>('.cp-alpha-track')!;
    const hexInput = pop.querySelector<HTMLInputElement>('.cp-hex-input')!;

    // SV canvas drag
    const onSvMove = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const py = 'touches' in e ? e.touches[0].clientY : e.clientY;
      this.currentS = Math.round(Math.max(0, Math.min(1, (px - rect.left) / rect.width)) * 100);
      this.currentL = Math.round(Math.max(0, Math.min(1, 1 - (py - rect.top) / rect.height)) * 100);
      this.syncUI(); this.emit();
    };
    canvas.addEventListener('mousedown', (e) => {
      onSvMove(e);
      const up = () => document.removeEventListener('mousemove', onSvMove as EventListener);
      document.addEventListener('mousemove', onSvMove as EventListener);
      document.addEventListener('mouseup', up, { once: true });
    });

    // Hue drag
    const onHueMove = (e: MouseEvent) => {
      const rect = hueTrack.getBoundingClientRect();
      this.currentH = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 360);
      this.syncUI(); this.emit();
    };
    hueTrack.addEventListener('mousedown', (e) => {
      onHueMove(e);
      const up = () => document.removeEventListener('mousemove', onHueMove);
      document.addEventListener('mousemove', onHueMove);
      document.addEventListener('mouseup', up, { once: true });
    });

    // Alpha drag
    const onAlphaMove = (e: MouseEvent) => {
      const rect = alphaTrack.getBoundingClientRect();
      this.currentA = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 100) / 100;
      this.syncUI(); this.emit();
    };
    alphaTrack.addEventListener('mousedown', (e) => {
      onAlphaMove(e);
      const up = () => document.removeEventListener('mousemove', onAlphaMove);
      document.addEventListener('mousemove', onAlphaMove);
      document.addEventListener('mouseup', up, { once: true });
    });

    // Hex input
    hexInput.addEventListener('change', () => {
      const v = hexInput.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) {
        [this.currentH, this.currentS, this.currentL] = hexToHsl(v);
        this.syncUI(); this.emit();
      }
    });
    hexInput.addEventListener('click', (e) => e.stopPropagation());
  }

  private syncUI(): void {
    const pop = this.popover;
    if (!pop) return;

    const canvas = pop.querySelector<HTMLCanvasElement>('.cp-sv-canvas')!;
    const ctx = canvas.getContext('2d')!;
    // Draw saturation/lightness gradient for current hue
    const w = canvas.width, h = canvas.height;
    const satGrad = ctx.createLinearGradient(0, 0, w, 0);
    satGrad.addColorStop(0, `hsl(${this.currentH},0%,50%)`);
    satGrad.addColorStop(1, `hsl(${this.currentH},100%,50%)`);
    ctx.fillStyle = satGrad;
    ctx.fillRect(0, 0, w, h);
    const lumGrad = ctx.createLinearGradient(0, 0, 0, h);
    lumGrad.addColorStop(0, 'rgba(255,255,255,1)');
    lumGrad.addColorStop(0.5, 'rgba(255,255,255,0)');
    lumGrad.addColorStop(0.5, 'rgba(0,0,0,0)');
    lumGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = lumGrad;
    ctx.fillRect(0, 0, w, h);

    // Hue thumb
    const hueThumb = pop.querySelector<HTMLElement>('.cp-hue-thumb')!;
    hueThumb.style.left = `${(this.currentH / 360) * 100}%`;

    // Alpha thumb + gradient
    const alphaGrad = pop.querySelector<HTMLElement>('.cp-alpha-gradient')!;
    const alphaThumb = pop.querySelector<HTMLElement>('.cp-alpha-thumb')!;
    const hex = hslToHex(this.currentH, this.currentS, this.currentL);
    alphaGrad.style.background = `linear-gradient(to right,transparent,${hex})`;
    alphaThumb.style.left = `${this.currentA * 100}%`;

    // Preview + hex input
    const preview = pop.querySelector<HTMLElement>('.cp-preview')!;
    const hexInput = pop.querySelector<HTMLInputElement>('.cp-hex-input')!;
    preview.style.background = `${hex}`;
    preview.style.opacity = String(this.currentA);
    hexInput.value = hex;
  }

  private emit(): void {
    const hex = hslToHex(this.currentH, this.currentS, this.currentL);
    this.onChangeCb?.(hex);
  }
}

// Singleton for the app
export const colorPicker = new ColorPicker();
