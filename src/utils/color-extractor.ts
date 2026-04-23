// Dominant color extraction via median-cut. No dependencies — pure Canvas API.

type RGB = [number, number, number];

export async function extractDominantColors(source: Blob | string, maxColors = 8): Promise<string[]> {
  const url = source instanceof Blob ? URL.createObjectURL(source) : source;
  try {
    const pixels = await loadPixels(url);
    return medianCut(pixels, maxColors).map(toHex);
  } finally {
    if (source instanceof Blob) URL.revokeObjectURL(url);
  }
}

async function loadPixels(src: string): Promise<RGB[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, 150 / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const w = Math.round(img.naturalWidth  * scale) || 1;
      const h = Math.round(img.naturalHeight * scale) || 1;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const pixels: RGB[] = [];
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue; // skip transparent
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
      resolve(pixels);
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

function medianCut(pixels: RGB[], maxColors: number): RGB[] {
  if (pixels.length === 0) return [];
  let buckets: RGB[][] = [pixels];

  while (buckets.length < maxColors) {
    let splitIdx = 0, splitCh = 0, maxRange = 0;
    for (let b = 0; b < buckets.length; b++) {
      for (let c = 0; c < 3; c++) {
        const vals = buckets[b].map(p => p[c]);
        const range = Math.max(...vals) - Math.min(...vals);
        if (range > maxRange) { maxRange = range; splitIdx = b; splitCh = c; }
      }
    }
    if (maxRange === 0) break;

    const bucket = [...buckets[splitIdx]].sort((a, b) => a[splitCh] - b[splitCh]);
    const mid = Math.floor(bucket.length / 2);
    buckets.splice(splitIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
  }

  return buckets
    .filter(b => b.length > 0)
    .sort((a, b) => b.length - a.length) // dominant first
    .map(bucket => {
      const n = bucket.length;
      return [
        Math.round(bucket.reduce((s, p) => s + p[0], 0) / n),
        Math.round(bucket.reduce((s, p) => s + p[1], 0) / n),
        Math.round(bucket.reduce((s, p) => s + p[2], 0) / n),
      ] as RGB;
    });
}

function toHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}
