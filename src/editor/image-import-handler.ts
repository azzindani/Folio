// Paste / drag-drop image importer. Wires to the editor canvas container.
// SVG  → parse paths + colors → image layer (data URL, vector quality)
// PNG  → detect dominant colors → image layer (blob URL) + palette update
// Trace → PNG → SVG via imagetracerjs → image layer (editable colors)

import type { StateManager } from './state';
import type { ImageLayer } from '../schema/types';
import { extractDominantColors } from '../utils/color-extractor';
import { importSVGFile, parseSVGString } from '../utils/svg-importer';
import type { ColorPaletteManager } from '../ui/panels/color-palette';

const IMAGE_RE = /\.(png|jpg|jpeg|gif|webp)$/i;
const SVG_RE   = /\.svg$/i;

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

function makeLayer(src: string, w: number, h: number, id: string): ImageLayer {
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(w, h, 1));
  return { id, type: 'image', z: 100, x: 80, y: 80,
           width: Math.round(w * scale), height: Math.round(h * scale), src };
}

export class ImageImportHandler {
  private state: StateManager;
  private palette: ColorPaletteManager | null = null;

  constructor(state: StateManager) { this.state = state; }

  setPalette(p: ColorPaletteManager): void { this.palette = p; }

  wire(container: HTMLElement): void {
    container.addEventListener('paste',   e => { void this.onPaste(e); });
    container.addEventListener('dragover', e => e.preventDefault());
    container.addEventListener('drop',    e => { void this.onDrop(e); });

    // Global paste fallback: catches paste events that bubble from Monaco or other editors
    document.addEventListener('paste', e => {
      // Only handle if a text input / contenteditable is NOT the target
      const target = e.target as HTMLElement;
      const inText = target.matches('input,textarea,[contenteditable]')
        || Boolean(target.closest('[contenteditable],.monaco-editor'));
      if (inText) return;
      void this.onPaste(e);
    });
  }

  // ── Paste ─────────────────────────────────────────────────────
  private async onPaste(e: ClipboardEvent): Promise<void> {
    const items = e.clipboardData?.items;
    if (!items) return;

    // Collect all items first, prioritise SVG → raster image → text/html img → svg text
    const allItems = Array.from(items);

    // Priority 1: explicit SVG MIME
    for (const item of allItems) {
      if (item.type === 'image/svg+xml') {
        const f = item.getAsFile();
        if (f) { e.preventDefault(); await this.fromSVGFile(f); return; }
      }
    }

    // Priority 2: any raster image (PNG/JPEG/GIF/WebP) — handles Flaticon copy
    for (const item of allItems) {
      if (item.type.startsWith('image/')) {
        const b = item.getAsFile();
        if (b) { e.preventDefault(); await this.fromRaster(b); return; }
      }
    }

    // Priority 3: text/html that contains an <img src="..."> — browser image copy
    for (const item of allItems) {
      if (item.type === 'text/html') {
        await new Promise<void>(res => {
          item.getAsString(async html => {
            const m = html.match(/src=["']([^"']+)["']/i);
            if (m) {
              try {
                const resp = await fetch(m[1]);
                if (resp.ok) {
                  const blob = await resp.blob();
                  if (blob.type.startsWith('image/')) {
                    e.preventDefault();
                    await this.fromRaster(blob);
                  }
                }
              } catch { /* cross-origin fetch blocked — skip */ }
            }
            res();
          });
        });
        return;
      }
    }

    // Priority 4: plain SVG text
    for (const item of allItems) {
      if (item.type === 'text/plain') {
        item.getAsString(async txt => {
          if (txt.trimStart().startsWith('<svg')) {
            e.preventDefault();
            await this.fromSVGText(txt);
          }
        });
      }
    }
  }

  // ── Drop ──────────────────────────────────────────────────────
  private async onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) {
      if (SVG_RE.test(file.name))   { await this.fromSVGFile(file);  break; }
      if (IMAGE_RE.test(file.name)) { await this.fromRaster(file);   break; }
    }
  }

  // ── Import paths ──────────────────────────────────────────────
  async fromSVGFile(file: File): Promise<void> {
    const r = await importSVGFile(file);
    this.commit(makeLayer(r.dataUrl, r.width, r.height, nextId('svg')), r.colors);
  }

  async fromSVGText(text: string): Promise<void> {
    const r = parseSVGString(text);
    this.commit(makeLayer(r.dataUrl, r.width, r.height, nextId('svg')), r.colors);
  }

  async fromRaster(blob: Blob): Promise<void> {
    // Convert to data URL so the src survives page reloads (blob URLs are session-only)
    const dataUrl = await blobToDataUrl(blob);
    const { w, h } = await imgSize(dataUrl);
    const layer = makeLayer(dataUrl, w, h, nextId('img'));
    const colors = await extractDominantColors(blob);
    this.commit(layer, colors);
  }

  async traceAndReplace(layerId: string, blob: Blob): Promise<void> {
    const toast = await import('../utils/toast');
    toast.showToast('Tracing PNG to vector…', 'info');
    try {
      const { tracePNGToSVG } = await import('../utils/image-tracer');
      const r = await tracePNGToSVG(blob);
      const design = this.state.get().design;
      if (!design) return;
      this.state.updateLayer(layerId, { src: r.dataUrl });
      this.palette?.addImportedColors(r.colors);
      toast.showToast('Traced to vector — colors now editable in palette', 'success');
    } catch {
      toast.showToast('Trace failed', 'error');
    }
  }

  // ── Shared commit ─────────────────────────────────────────────
  private commit(layer: ImageLayer, colors: string[]): void {
    const design = this.state.get().design;
    if (!design) return;
    if (design.pages?.length) {
      const idx = this.state.get().currentPageIndex;
      const pages = design.pages.map((p, i) =>
        i === idx ? { ...p, layers: [...(p.layers ?? []), layer] } : p,
      );
      this.state.set('design', { ...design, pages });
    } else {
      this.state.set('design', { ...design, layers: [...(design.layers ?? []), layer] });
    }
    this.state.set('selectedLayerIds', [layer.id]);
    if (colors.length) this.palette?.addImportedColors(colors);
  }
}

async function imgSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => res({ w: 100, h: 100 });
    img.src = src;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}
