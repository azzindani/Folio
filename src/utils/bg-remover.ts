/**
 * Background removal in the browser — the canvas wrapper around the shared
 * pixel algorithm in bg-remove-core.ts.
 *
 * This file used to contain the algorithm itself, which made it unreachable
 * from anywhere without a DOM: the editor could cut out a background and a
 * model working over MCP could not. The pixel work now lives in the core so
 * both callers run the same code and cannot drift apart.
 */

import { removeBackgroundPixels, type BgRemoveOptions } from './bg-remove-core';

export type { BgRemoveOptions } from './bg-remove-core';

export async function removeBackground(
  src: string,
  opts: BgRemoveOptions = {},
): Promise<string> {
  const img = await loadImage(src);
  const { width: w, height: h } = img;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context for background removal.');
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, w, h);
  removeBackgroundPixels(data.data, w, h, opts);

  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
