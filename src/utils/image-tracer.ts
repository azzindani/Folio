// PNG → SVG vector trace via imagetracerjs. Lazy-loaded (~50 KB).
// Best results on simple flat icons with ≤ 16 distinct colors.

export interface TraceResult {
  dataUrl: string;   // data:image/svg+xml;base64,...
  colors: string[];  // unique fill colors in the traced SVG
  width: number;
  height: number;
}

export async function tracePNGToSVG(blob: Blob): Promise<TraceResult> {
  const { default: ImageTracer } = await import('imagetracerjs');

  const { imageData, width, height } = await blobToImageData(blob);

  const svgStr = ImageTracer.imagedataToSVG(imageData, {
    ltres: 1,
    qtres: 1,
    pathomit: 8,
    rightangleenhance: true,
    colorsampling: 2,
    numberofcolors: 16,
    mincolorratio: 0.02,
    colorquantcycles: 3,
    strokewidth: 0,
    linefilter: false,
    scale: 1,
    roundcoords: 1,
    viewbox: true,
    desc: false,
  });

  const colors = extractTracedColors(svgStr);
  const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));

  return { dataUrl, colors, width, height };
}

async function blobToImageData(blob: Blob): Promise<{ imageData: ImageData; width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        resolve({
          imageData: ctx.getImageData(0, 0, cv.width, cv.height),
          width: cv.width,
          height: cv.height,
        });
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function extractTracedColors(svgStr: string): string[] {
  const matches = svgStr.matchAll(/fill="(#[0-9a-fA-F]{3,8})"/g);
  const seen = new Set<string>();
  for (const [, hex] of matches) {
    if (hex !== 'none') seen.add(hex.toLowerCase());
  }
  return [...seen];
}
