import { type StateManager } from '../../editor/state';
import { renderDesign, renderPage } from '../../renderer/renderer';
import { sourceOptions } from '../../renderer/resolve-source';
import { composeTheme } from '../../styles/compose';

/**
 * Minimap: a small live thumbnail of the design, with a viewport rectangle the
 * user can drag to pan the canvas.
 *
 * The thumbnail is INLINE SVG, not an SVG drawn into a <canvas> through an
 * <img>. SVG-as-image is sandboxed from the document's fonts, so every text
 * layer fell back to the browser's default serif — the minimap showed "Folio"
 * in Times under a canvas showing it in Space Grotesk, on every desktop screen.
 * The page strip already rendered inline for the same reason.
 */
export class MinimapManager {
  private container: HTMLElement;
  private state: StateManager;
  private surface!: HTMLDivElement;
  private vpBox!: HTMLDivElement;
  private mapW = 0;
  private mapH = 0;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.build();
    this.state.subscribe((_, keys) => {
      if (keys.some(k => ['design', 'theme', 'currentPageIndex', 'palette', 'typePack', 'effectsPack'].includes(k))) {
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

    this.surface = document.createElement('div');
    this.surface.className = 'minimap-surface';
    // width is set in px per refresh (see refreshThumbnail); margin:auto keeps a
    // thumbnail narrower than the panel centred rather than jammed left.
    this.surface.style.cssText = 'display:block;margin:0 auto;overflow:hidden;cursor:crosshair;';
    this.container.appendChild(this.surface);

    // Viewport indicator box
    this.vpBox = document.createElement('div');
    this.vpBox.style.cssText =
      'position:absolute;border:1.5px solid var(--color-primary);' +
      'pointer-events:none;box-sizing:border-box;';
    this.container.appendChild(this.vpBox);

    this.surface.addEventListener('mousedown', this.onDrag.bind(this));
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
    // Explicit px: the old bug here was the element being wider than the
    // pixels drawn into it.
    this.surface.style.width  = `${THUMB_W}px`;
    this.surface.style.height = `${THUMB_H}px`;
    this.container.style.height = `${THUMB_H + 1}px`;

    // Composed exactly as the canvas and the page strip compose it, so the
    // three views of one design cannot disagree about its colours or type.
    const { palette, typePack, effectsPack } = this.state.get();
    const composed = theme
      ? composeTheme(theme, { palette: palette ?? undefined, typePack: typePack ?? undefined, effectsPack: effectsPack ?? undefined })
      : undefined;
    let svg: SVGSVGElement;
    if (design.pages && design.pages.length > 0) {
      const pi = Math.min(currentPageIndex, design.pages.length - 1);
      const page = design.pages[pi];
      svg = renderPage(page?.layers ?? [], width, height, { theme: composed, stillScripts: true, source: sourceOptions(design, page) });
    } else {
      svg = renderDesign(design, { theme: composed, stillScripts: true });
    }
    svg.setAttribute('width',  String(THUMB_W));
    svg.setAttribute('height', String(THUMB_H));
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';
    this.surface.replaceChildren(svg);
    this.updateViewportBox();
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
      const rect   = this.surface.getBoundingClientRect();
      const mx     = me.clientX - rect.left;
      const my     = me.clientY - rect.top;
      const design = this.state.get().design;
      if (!design || !this.mapW) return;

      const { width } = design.document;
      const scale = this.mapW / width;
      const zoom  = this.state.get().zoom ?? 1;

      // Center the viewport on the click point — of the REAL canvas area, the
      // same one the viewport box is drawn from. This used to guess 55% × 75%
      // of the window, so a click landed the view somewhere else.
      const area = document.querySelector<HTMLElement>('.canvas-area');
      const areaW = area?.clientWidth || window.innerWidth * 0.55;
      const areaH = area?.clientHeight || window.innerHeight * 0.75;
      const designX = mx / scale;
      const designY = my / scale;
      const newPanX = -(designX * zoom) + areaW / 2;
      const newPanY = -(designY * zoom) + areaH / 2;

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
