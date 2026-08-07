import { type StateManager } from '../../editor/state';
import { renderDesign, renderPage } from '../../renderer/renderer';

/**
 * Minimap: small canvas thumbnail of the design, with a
 * viewport rectangle the user can drag to pan the canvas.
 */
export class MinimapManager {
  private container: HTMLElement;
  private state: StateManager;
  private canvas!: HTMLCanvasElement;
  private vpBox!: HTMLDivElement;
  private mapW = 0;
  private mapH = 0;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.build();
    this.state.subscribe((_, keys) => {
      if (keys.some(k => ['design', 'theme', 'currentPageIndex'].includes(k))) {
        this.refreshThumbnail();
      }
      if (keys.some(k => ['zoom', 'panX', 'panY', 'design'].includes(k))) {
        this.updateViewportBox();
      }
    });
  }

  private build(): void {
    this.container.innerHTML = '';
    this.container.style.cssText =
      'position:relative;overflow:hidden;background:var(--color-bg);' +
      'border-top:1px solid var(--color-border);';

    this.canvas = document.createElement('canvas');
    // width is set in px per refresh (see refreshThumbnail); margin:auto keeps a
    // thumbnail narrower than the panel centred rather than jammed left.
    this.canvas.style.cssText = 'display:block;margin:0 auto;image-rendering:pixelated;cursor:crosshair;';
    this.container.appendChild(this.canvas);

    // Viewport indicator box
    this.vpBox = document.createElement('div');
    this.vpBox.style.cssText =
      'position:absolute;border:1.5px solid var(--color-primary);' +
      'pointer-events:none;box-sizing:border-box;';
    this.container.appendChild(this.vpBox);

    this.canvas.addEventListener('mousedown', this.onDrag.bind(this));
    this.refreshThumbnail();
  }

  private refreshThumbnail(): void {
    const { design, theme, currentPageIndex } = this.state.get();
    if (!design) return;

    const { width, height } = design.document;
    // clientWidth is 0 before the panel is laid out. The old `|| 240` fallback
    // then baked a 240px-wide thumbnail whose height matched a 240px scale,
    // while the canvas ELEMENT stretched to the panel's real ~300px — so the
    // minimap showed a portrait design as very nearly square. Wait for a real
    // measurement instead of guessing one.
    const avail = this.container.clientWidth;
    if (!avail) { requestAnimationFrame(() => this.refreshThumbnail()); return; }

    // A tall design would otherwise claim the whole panel: a 1080×1350 poster
    // at 300px wide wants 375px of height, which is more than the properties
    // it sits under. Cap it, and scale from whichever axis binds.
    const maxH = Math.max(120, Math.min(260, Math.round(window.innerHeight * 0.24)));
    const scale = Math.min(avail / width, maxH / height);
    const THUMB_W = Math.max(1, Math.round(width * scale));
    const THUMB_H = Math.max(1, Math.round(height * scale));

    this.mapW = THUMB_W;
    this.mapH = THUMB_H;
    this.canvas.width  = THUMB_W;
    this.canvas.height = THUMB_H;
    // Explicit px, not 100%: the whole bug above was the element being wider
    // than the pixels drawn into it.
    this.canvas.style.width  = `${THUMB_W}px`;
    this.canvas.style.height = `${THUMB_H}px`;
    this.container.style.height = `${THUMB_H + 1}px`;

    // Render design to an off-screen SVG then draw on canvas via Image
    let svg: SVGSVGElement;
    if (design.pages && design.pages.length > 0) {
      const pi = Math.min(currentPageIndex, design.pages.length - 1);
      const page = design.pages[pi];
      svg = renderPage(page?.layers ?? [], width, height, { theme: theme ?? undefined });
    } else {
      svg = renderDesign(design, { theme: theme ?? undefined });
    }

    svg.setAttribute('width',  String(THUMB_W));
    svg.setAttribute('height', String(THUMB_H));

    const svgStr = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      const ctx = this.canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, THUMB_W, THUMB_H);
        ctx.drawImage(img, 0, 0, THUMB_W, THUMB_H);
      }
      URL.revokeObjectURL(url);
      this.updateViewportBox();
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  private updateViewportBox(): void {
    const { zoom = 1, panX = 0, panY = 0, design } = this.state.get();
    if (!design || !this.mapW) return;

    const { width } = design.document;
    const scale = this.mapW / width;

    // The viewport rect only means anything if it is measured against the REAL
    // canvas area. This used to assume 55% of the window width and 75% of its
    // height — wrong at every size, and wronger now that the panels adapt.
    const area = document.querySelector<HTMLElement>('.canvas-area');
    const canvasAreaW = area?.clientWidth || window.innerWidth * 0.55;
    const canvasAreaH = area?.clientHeight || window.innerHeight * 0.75;

    // Viewport in design coords
    const vpW = canvasAreaW / zoom;
    const vpH = canvasAreaH / zoom;
    const vpX = -panX / zoom;
    const vpY = -panY / zoom;

    // The thumbnail is centred when it is narrower than the panel, so the box
    // has to start from the thumbnail's left edge, not the container's.
    const offsetX = Math.max(0, (this.container.clientWidth - this.mapW) / 2);
    this.vpBox.style.left   = `${offsetX + Math.max(0, vpX * scale)}px`;
    this.vpBox.style.top    = `${Math.max(0, vpY * scale)}px`;
    this.vpBox.style.width  = `${Math.min(this.mapW, vpW * scale)}px`;
    this.vpBox.style.height = `${Math.min(this.mapH, vpH * scale)}px`;
  }

  private onDrag(e: MouseEvent): void {
    const move = (me: MouseEvent) => {
      const rect   = this.canvas.getBoundingClientRect();
      const mx     = me.clientX - rect.left;
      const my     = me.clientY - rect.top;
      const design = this.state.get().design;
      if (!design || !this.mapW) return;

      const { width } = design.document;
      const scale = this.mapW / width;
      const zoom  = this.state.get().zoom ?? 1;

      // Center the viewport on click point
      const designX = mx / scale;
      const designY = my / scale;
      const newPanX = -(designX * zoom) + (window.innerWidth  * 0.55) / 2;
      const newPanY = -(designY * zoom) + (window.innerHeight * 0.75) / 2;

      this.state.batch(() => {
        this.state.set('panX', newPanX, false);
        this.state.set('panY', newPanY, false);
      });
    };

    move(e);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', () => {
      document.removeEventListener('mousemove', move);
    }, { once: true });
  }
}
