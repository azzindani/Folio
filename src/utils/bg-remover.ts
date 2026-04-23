/**
 * Background removal via canvas flood-fill.
 * Targets light (near-white) pixels connected to image corners and makes them transparent.
 */

export interface BgRemoveOptions {
  tolerance?: number;  // 0–255, default 30
  feather?: number;    // px edge blur, 0 = none, default 1
}

export async function removeBackground(
  src: string,
  opts: BgRemoveOptions = {},
): Promise<string> {
  const tolerance = opts.tolerance ?? 30;
  const feather   = opts.feather   ?? 1;

  const img = await loadImage(src);
  const { width: w, height: h } = img;

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, w, h);
  const pixels = data.data;

  // Sample corner colors to determine background color (average of 4 corners)
  const corners = [
    pixelAt(pixels, w, 0, 0),
    pixelAt(pixels, w, w - 1, 0),
    pixelAt(pixels, w, 0, h - 1),
    pixelAt(pixels, w, w - 1, h - 1),
  ];
  const bgR = Math.round(corners.reduce((s, c) => s + c[0], 0) / 4);
  const bgG = Math.round(corners.reduce((s, c) => s + c[1], 0) / 4);
  const bgB = Math.round(corners.reduce((s, c) => s + c[2], 0) / 4);

  const visited = new Uint8Array(w * h);
  const queue: number[] = [];

  const enqueue = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    const p = pixelAt(pixels, w, x, y);
    if (colorDist(p[0], p[1], p[2], bgR, bgG, bgB) <= tolerance) {
      queue.push(idx);
    }
  };

  // Seed from all 4 edges
  for (let x = 0; x < w; x++) { enqueue(x, 0); enqueue(x, h - 1); }
  for (let y = 0; y < h; y++) { enqueue(0, y); enqueue(w - 1, y); }

  while (queue.length > 0) {
    const idx = queue.pop()!;
    const x = idx % w;
    const y = Math.floor(idx / w);
    // Make transparent
    pixels[idx * 4 + 3] = 0;
    enqueue(x - 1, y); enqueue(x + 1, y);
    enqueue(x, y - 1); enqueue(x, y + 1);
  }

  if (feather > 0) applyFeather(pixels, w, h, feather);

  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

function pixelAt(data: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

function colorDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function applyFeather(pixels: Uint8ClampedArray, w: number, h: number, radius: number): void {
  // Blur alpha channel only (box blur approximation)
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = pixels[i * 4 + 3];

  const blurred = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
            sum += alpha[ny * w + nx];
            count++;
          }
        }
      }
      blurred[y * w + x] = sum / count;
    }
  }

  for (let i = 0; i < w * h; i++) pixels[i * 4 + 3] = Math.round(blurred[i]);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
