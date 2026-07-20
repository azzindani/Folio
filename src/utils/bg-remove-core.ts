/**
 * Background removal, as a pure function over pixels.
 *
 * The algorithm used to live inside a browser-only wrapper that built a
 * `<canvas>`, which meant a model working over MCP could not reach it at all —
 * only a human clicking in the editor could remove a background. Splitting the
 * pixel work out lets the editor keep its canvas path and the server use the
 * PNG codec, both calling ONE implementation, so the two can never drift.
 *
 * The method is a flood fill seeded from the image border: whatever colour the
 * edges agree on is treated as background, and connected runs of that colour
 * are made transparent. That is deliberately conservative — it removes a
 * studio backdrop and leaves an enclosed shape of the same colour alone (the
 * hole in a letter "O" stays filled), because reaching interior regions would
 * mean guessing at subject boundaries.
 */

export interface BgRemoveOptions {
  /** Colour distance still counted as background, 0–255. Default 30. */
  tolerance?: number;
  /** Alpha blur radius in px to soften the cut edge, 0 = hard. Default 1. */
  feather?: number;
}

export interface BgRemoveStats {
  /** Pixels made fully transparent. */
  removed: number;
  /** Fraction of the image removed, 0–1. */
  removedFraction: number;
  /** The border colour the fill treated as background. */
  background: [number, number, number];
}

/** Euclidean distance in RGB — cheap, and adequate against a flat backdrop. */
function colorDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * The background colour, taken as the median of the border pixels.
 *
 * The original sampled only the four corners and averaged them, which fails on
 * exactly the images people upload: a photo with a vignette, or a logo whose
 * corner happens to clip the mark. A median over the whole border ignores those
 * outliers instead of letting one dark corner drag the target colour away from
 * the actual backdrop.
 */
export function detectBackgroundColor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const sample = (x: number, y: number): void => {
    const i = (y * width + x) * 4;
    rs.push(pixels[i]); gs.push(pixels[i + 1]); bs.push(pixels[i + 2]);
  };

  for (let x = 0; x < width; x++) { sample(x, 0); sample(x, height - 1); }
  for (let y = 0; y < height; y++) { sample(0, y); sample(width - 1, y); }

  const median = (xs: number[]): number => {
    xs.sort((a, b) => a - b);
    return xs[Math.floor(xs.length / 2)] ?? 0;
  };
  return [median(rs), median(gs), median(bs)];
}

/**
 * Make border-connected background pixels transparent, in place.
 *
 * The fill is iterative rather than recursive: a 4000×4000 photo would blow the
 * call stack long before it ran out of memory.
 */
export function removeBackgroundPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: BgRemoveOptions = {},
): BgRemoveStats {
  const tolerance = opts.tolerance ?? 30;
  const feather = opts.feather ?? 1;
  const [bgR, bgG, bgB] = detectBackgroundColor(pixels, width, height);

  const visited = new Uint8Array(width * height);
  const queue: number[] = [];

  const enqueue = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    const i = idx * 4;
    if (colorDist(pixels[i], pixels[i + 1], pixels[i + 2], bgR, bgG, bgB) <= tolerance) {
      queue.push(idx);
    }
  };

  for (let x = 0; x < width; x++) { enqueue(x, 0); enqueue(x, height - 1); }
  for (let y = 0; y < height; y++) { enqueue(0, y); enqueue(width - 1, y); }

  let removed = 0;
  while (queue.length > 0) {
    const idx = queue.pop();
    if (idx === undefined) break;
    pixels[idx * 4 + 3] = 0;
    removed++;
    const x = idx % width;
    const y = Math.floor(idx / width);
    enqueue(x - 1, y); enqueue(x + 1, y);
    enqueue(x, y - 1); enqueue(x, y + 1);
  }

  if (feather > 0) featherAlpha(pixels, width, height, feather);

  return {
    removed,
    removedFraction: removed / (width * height),
    background: [bgR, bgG, bgB],
  };
}

/** Box-blur the alpha channel only, softening the cut edge without touching colour. */
export function featherAlpha(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): void {
  const alpha = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) alpha[i] = pixels[i * 4 + 3];

  const blurred = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
            sum += alpha[ny * width + nx];
            count++;
          }
        }
      }
      blurred[y * width + x] = count > 0 ? sum / count : alpha[y * width + x];
    }
  }

  for (let i = 0; i < width * height; i++) pixels[i * 4 + 3] = Math.round(blurred[i]);
}
