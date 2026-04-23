/**
 * PanelResizer — draggable dividers for IDE-style panel resizing.
 *
 * Usage:
 *   new PanelResizer({ cssVar: '--left-panel-width', axis: 'x', min: 160, max: 600, target: document.documentElement })
 *
 * The handle element is injected adjacent to the panel and updates the CSS
 * custom property on drag so all panels resize live without JS layout math.
 */

export interface ResizerOptions {
  /** CSS custom property to update (e.g. '--left-panel-width') */
  cssVar: string;
  /** Drag axis */
  axis: 'x' | 'y';
  /** Min size in px */
  min: number;
  /** Max size in px */
  max: number;
  /** Element that holds the CSS var (default: document.documentElement) */
  target?: HTMLElement;
  /** Invert delta direction (for right/bottom panels whose handle is on the near edge) */
  invert?: boolean;
  /** Called after each resize with the new size in px */
  onChange?: (size: number) => void;
  /** localStorage key for persistence (default: derived from cssVar) */
  persistKey?: string;
}

export class PanelResizer {
  private handle: HTMLElement;
  private opts: Required<Omit<ResizerOptions, 'persistKey'>> & { persistKey?: string };
  private dragging = false;
  private startPos = 0;
  private startSize = 0;

  constructor(opts: ResizerOptions) {
    this.opts = {
      target: document.documentElement,
      onChange: () => undefined,
      invert: false,
      ...opts,
    };
    this.handle = document.createElement('div');
    this.handle.className = `panel-resize-handle panel-resize-handle--${opts.axis}`;
    this.handle.setAttribute('role', 'separator');
    this.handle.setAttribute('aria-orientation', opts.axis === 'x' ? 'vertical' : 'horizontal');
    this.handle.setAttribute('tabindex', '0');
    this.wireEvents();
    this.restoreSize();
  }

  private storageKey(): string {
    return `folio-panel:${this.opts.persistKey ?? this.opts.cssVar}`;
  }

  private restoreSize(): void {
    try {
      const saved = localStorage.getItem(this.storageKey());
      if (saved) {
        const px = parseInt(saved, 10);
        if (!isNaN(px)) this.setSize(px);
      }
    } catch { /* private browsing / storage blocked */ }
  }

  /** Returns the injected handle element so caller can insert it into the DOM. */
  getHandle(): HTMLElement {
    return this.handle;
  }

  private currentSize(): number {
    // Try inline style first (works in jsdom and real browsers)
    const inline = this.opts.target.style.getPropertyValue(this.opts.cssVar).trim();
    if (inline) return parseInt(inline, 10) || 0;
    // Fall back to computed style (production path)
    const computed = getComputedStyle(this.opts.target).getPropertyValue(this.opts.cssVar).trim();
    return parseInt(computed, 10) || 0;
  }

  private setSize(px: number): void {
    const clamped = Math.min(this.opts.max, Math.max(this.opts.min, px));
    this.opts.target.style.setProperty(this.opts.cssVar, `${clamped}px`);
    try { localStorage.setItem(this.storageKey(), String(clamped)); } catch { /* storage full */ }
    this.opts.onChange(clamped);
  }

  private wireEvents(): void {
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.startPos = this.opts.axis === 'x' ? e.clientX : e.clientY;
      this.startSize = this.currentSize();
      this.handle.setPointerCapture?.(e.pointerId);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = this.opts.axis === 'x' ? 'col-resize' : 'row-resize';
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      const raw =
        this.opts.axis === 'x'
          ? e.clientX - this.startPos
          : e.clientY - this.startPos;
      const delta = this.opts.invert ? -raw : raw;
      this.setSize(this.startSize + delta);
    };

    const onPointerUp = () => {
      if (!this.dragging) return;
      this.dragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    // Keyboard: arrow keys nudge by 8px
    const onKeyDown = (e: KeyboardEvent) => {
      const dir = this.opts.axis === 'x'
        ? (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0)
        : (e.key === 'ArrowDown'  ? 1 : e.key === 'ArrowUp'   ? -1 : 0);
      if (dir === 0) return;
      e.preventDefault();
      this.setSize(this.currentSize() + dir * 8);
    };

    this.handle.addEventListener('pointerdown', onPointerDown);
    this.handle.addEventListener('pointermove', onPointerMove);
    this.handle.addEventListener('pointerup', onPointerUp);
    this.handle.addEventListener('keydown', onKeyDown);
  }

  destroy(): void {
    this.handle.remove();
  }
}
