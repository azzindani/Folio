/**
 * What an image actually draws inside its box. Found in the benchmark (r8): a
 * bike icon (Lucide, 24-unit viewBox, 2 units of transparent margin a side)
 * "came to rest over" a hedge line 10 px above its wheels — the collision check
 * measured the layer's box, and the box is mostly empty air. The ink of each
 * image FILE is measured once (an SVG drawn small by resvg, a raster decoded)
 * and cached; layers carry it as `ink_box`, fractions of the box they draw in.
 */

import * as fs from 'fs';
import { Resvg } from '@resvg/resvg-js';
import type { Layer } from '../../schema/types';
import { decodeRaster } from '../../utils/raster-decode';
import { opaqueBounds } from '../../utils/image-geometry';
import { resolveAssetFile } from './asset-resolve';

export interface InkFrac { x: number; y: number; w: number; h: number }

const cache = new Map<string, { key: string; ink: InkFrac | null }>();

/** The share of the image its opaque pixels span, or null when it is all ink (or unreadable). */
export function imageInk(abs: string): InkFrac | null {
  let key = '';
  try { const st = fs.statSync(abs); key = `${st.mtimeMs}:${st.size}`; } catch { return null; }
  const hit = cache.get(abs);
  if (hit?.key === key) return hit.ink;
  let ink: InkFrac | null = null;
  try {
    const buf = fs.readFileSync(abs);
    const img = /\.svg$/i.test(abs)
      ? (() => { const r = new Resvg(buf, { fitTo: { mode: 'width', value: 96 } }).render(); return { width: r.width, height: r.height, pixels: new Uint8ClampedArray(r.pixels) }; })()
      : decodeRaster(buf);
    const b = opaqueBounds(img);
    // Only a real margin counts: an image inked edge to edge is its box.
    if (b && (b.w < img.width * 0.97 || b.h < img.height * 0.97)) {
      ink = { x: b.x / img.width, y: b.y / img.height, w: b.w / img.width, h: b.h / img.height };
    }
  } catch { ink = null; }
  cache.set(abs, { key, ink });
  return ink;
}

/** The tree with each image layer's ink recorded as `ink_box` — for the measures that care what is drawn. */
export function withImageInk(layers: Layer[], designPath: string, projectPath?: string): Layer[] {
  return layers.map(l => {
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) return { ...l, layers: withImageInk(kids, designPath, projectPath) } as Layer;
    const src = (l as { src?: unknown }).src;
    if (l.type !== 'image' || typeof src !== 'string') return l;
    const abs = resolveAssetFile(src, designPath, projectPath);
    const ink = abs ? imageInk(abs) : null;
    return ink ? ({ ...l, ink_box: ink } as Layer) : l;
  });
}
