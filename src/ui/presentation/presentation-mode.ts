import { type StateManager } from '../../editor/state';
import { renderDesign, renderPage } from '../../renderer/renderer';
import type { DesignSpec } from '../../schema/types';

/**
 * Fullscreen presentation overlay.
 * Enter: open(). Exit: Escape key or close().
 * Page navigation: ←/→ arrow keys (paged designs) or click left/right thirds.
 */
export class PresentationMode {
  private state: StateManager;
  private overlay: HTMLElement | null = null;
  private currentPage = 0;
  private totalPages = 1;

  constructor(state: StateManager) {
    this.state = state;
  }

  open(): void {
    if (this.overlay) return; // already open
    const design = this.state.get().design;
    if (!design) return;

    this.currentPage = this.state.get().currentPageIndex ?? 0;
    this.totalPages = design.pages?.length ?? 1;

    this.overlay = this.buildOverlay(design);
    document.body.appendChild(this.overlay);

    this.renderSlide(design);
    this.bindKeys();

    // Request fullscreen if available
    this.overlay.requestFullscreen?.().catch(() => { /* ignore if not supported */ });
  }

  close(): void {
    if (!this.overlay) return;
    document.removeEventListener('keydown', this.handleKey);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { /* ignore */ });
    }
    this.overlay.remove();
    this.overlay = null;
  }

  private buildOverlay(design: DesignSpec): HTMLElement {
    const el = document.createElement('div');
    el.className = 'pres-overlay';
    el.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:#000;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'user-select:none;';

    // Slide container
    const slide = document.createElement('div');
    slide.className = 'pres-slide';
    slide.style.cssText = 'position:relative;flex-shrink:0;';

    // Left / right click zones
    const leftZone = document.createElement('div');
    leftZone.style.cssText =
      'position:absolute;left:0;top:0;width:20%;height:100%;' +
      'cursor:w-resize;z-index:10;';
    leftZone.addEventListener('click', () => this.navigate(-1, design));

    const rightZone = document.createElement('div');
    rightZone.style.cssText =
      'position:absolute;right:0;top:0;width:20%;height:100%;' +
      'cursor:e-resize;z-index:10;';
    rightZone.addEventListener('click', () => this.navigate(1, design));

    slide.appendChild(leftZone);
    slide.appendChild(rightZone);
    el.appendChild(slide);

    // HUD: page counter + close
    const hud = document.createElement('div');
    hud.className = 'pres-hud';
    hud.style.cssText =
      'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'display:flex;align-items:center;gap:16px;' +
      'background:rgba(0,0,0,.5);backdrop-filter:blur(8px);' +
      'border-radius:24px;padding:8px 20px;';

    const prevBtn = this.hudBtn('‹', () => this.navigate(-1, design));
    const counter = document.createElement('span');
    counter.className = 'pres-counter';
    counter.style.cssText = 'color:#fff;font-size:13px;font-family:sans-serif;min-width:60px;text-align:center;';
    const nextBtn = this.hudBtn('›', () => this.navigate(1, design));
    const closeBtn = this.hudBtn('✕', () => this.close());
    closeBtn.style.marginLeft = '8px';
    closeBtn.title = 'Exit (Esc)';

    hud.append(prevBtn, counter, nextBtn, closeBtn);
    el.appendChild(hud);

    // Store refs for later updates via dataset-style approach
    (el as unknown as Record<string, unknown>)['_slide']   = slide;
    (el as unknown as Record<string, unknown>)['_counter'] = counter;

    // Compute slide scale on resize
    const resize = () => this.scaleSlide(slide, design);
    window.addEventListener('resize', resize);
    el.addEventListener('remove', () => window.removeEventListener('resize', resize));

    return el;
  }

  private hudBtn(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText =
      'background:none;border:none;color:#fff;font-size:20px;' +
      'cursor:pointer;padding:0 4px;line-height:1;opacity:.8;';
    btn.addEventListener('click', onClick);
    btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
    btn.addEventListener('mouseleave', () => (btn.style.opacity = '.8'));
    return btn;
  }

  private renderSlide(design: DesignSpec): void {
    if (!this.overlay) return;
    const store = this.overlay as unknown as Record<string, unknown>;
    const slide   = store['_slide']   as HTMLElement;
    const counter = store['_counter'] as HTMLElement;

    const theme = this.state.get().theme ?? undefined;
    const { width, height } = design.document;

    let svg: SVGSVGElement;
    if (design.pages && design.pages.length > 0) {
      const page = design.pages[Math.min(this.currentPage, design.pages.length - 1)];
      svg = renderPage(page?.layers ?? [], width, height, { theme });
    } else {
      svg = renderDesign(design, { theme });
    }

    svg.style.display = 'block';

    // Remove old SVG, keep click zones
    const oldSvg = slide.querySelector('svg');
    if (oldSvg) oldSvg.remove();
    slide.insertBefore(svg, slide.firstChild);

    this.scaleSlide(slide, design);
    counter.textContent = this.totalPages > 1
      ? `${this.currentPage + 1} / ${this.totalPages}`
      : '';
  }

  private scaleSlide(slide: HTMLElement, design: DesignSpec): void {
    const { width, height } = design.document;
    const vw = window.innerWidth  - 40;
    const vh = window.innerHeight - 80;
    const scale = Math.min(vw / width, vh / height, 1);
    const sw = Math.round(width  * scale);
    const sh = Math.round(height * scale);
    slide.style.width  = `${sw}px`;
    slide.style.height = `${sh}px`;
    const svg = slide.querySelector<SVGSVGElement>('svg');
    if (svg) {
      svg.setAttribute('width',  String(sw));
      svg.setAttribute('height', String(sh));
      svg.style.width  = `${sw}px`;
      svg.style.height = `${sh}px`;
    }
  }

  private navigate(delta: number, design: DesignSpec): void {
    const next = Math.max(0, Math.min(this.totalPages - 1, this.currentPage + delta));
    if (next === this.currentPage) return;
    this.currentPage = next;
    this.renderSlide(design);
  }

  private handleKey = (e: KeyboardEvent): void => {
    const design = this.state.get().design;
    if (!design) return;
    switch (e.key) {
      case 'Escape':     this.close();                       break;
      case 'ArrowRight':
      case 'ArrowDown':
      case ' ':          this.navigate(1, design);           break;
      case 'ArrowLeft':
      case 'ArrowUp':    this.navigate(-1, design);          break;
    }
  };

  private bindKeys(): void {
    document.addEventListener('keydown', this.handleKey);
  }
}
