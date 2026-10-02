/**
 * Footage drawn as pixels: a frame is its graphics rasterised in bands (each a
 * premultiplied RGBA image, as resvg renders it) with each clip's decoded
 * picture painted between them — the same stacking the SVG would have drawn,
 * without embedding a JPEG in the SVG for resvg to decode and resample again.
 */

/** Where a clip lands in output pixels: its box scaled, edges rounded so neighbours never gap. */
export function clipRect(x: number, y: number, w: number, h: number, scale: number): { x: number; y: number; w: number; h: number } {
  const x0 = Math.round(x * scale), y0 = Math.round(y * scale);
  return { x: x0, y: y0, w: Math.max(1, Math.round((x + w) * scale) - x0), h: Math.max(1, Math.round((y + h) * scale) - y0) };
}

/** Paint a premultiplied band over `dst` (same size), source-over. */
export function overBand(dst: Buffer, band: Buffer): void {
  const n = Math.min(dst.length, band.length);
  for (let i = 0; i < n; i += 4) {
    const a = band[i + 3] ?? 0;
    if (a === 0) continue;
    if (a === 255) {
      dst[i] = band[i] ?? 0; dst[i + 1] = band[i + 1] ?? 0; dst[i + 2] = band[i + 2] ?? 0; dst[i + 3] = 255;
      continue;
    }
    const k = 255 - a;
    for (let c = 0; c < 4; c++) dst[i + c] = (band[i + c] ?? 0) + (((dst[i + c] ?? 0) * k + 127) / 255 | 0);
  }
}

function rowOpaque(px: Buffer, from: number, to: number): boolean {
  for (let i = from + 3; i < to; i += 4) if (px[i] !== 255) return false;
  return true;
}

/**
 * Paint a straight-alpha w×h clip (ffmpeg's rgba) at (x, y) over premultiplied
 * `dst` (dw×dh) at `opacity`, source-over, cut to the frame.
 */
export function drawClip(dst: Buffer, dw: number, dh: number, clip: Buffer, w: number, h: number, x: number, y: number, opacity: number): void {
  const op = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(dw, x + w), y1 = Math.min(dh, y + h);
  if (op === 0 || x1 <= x0 || y1 <= y0) return;
  for (let yy = y0; yy < y1; yy++) {
    let s = ((yy - y) * w + (x0 - x)) * 4;
    let d = (yy * dw + x0) * 4;
    // Footage is opaque: a row with no alpha to blend is one copy (21.6 → ~3 ms a 1080p frame).
    if (op === 255 && rowOpaque(clip, s, s + (x1 - x0) * 4)) { clip.copy(dst, d, s, s + (x1 - x0) * 4); continue; }
    for (let xx = x0; xx < x1; xx++, s += 4, d += 4) {
      const a = op === 255 ? (clip[s + 3] ?? 0) : ((clip[s + 3] ?? 0) * op + 127) / 255 | 0;
      if (a === 0) continue;
      if (a === 255) {
        dst[d] = clip[s] ?? 0; dst[d + 1] = clip[s + 1] ?? 0; dst[d + 2] = clip[s + 2] ?? 0; dst[d + 3] = 255;
        continue;
      }
      const k = 255 - a;
      for (let c = 0; c < 3; c++) dst[d + c] = ((clip[s + c] ?? 0) * a + (dst[d + c] ?? 0) * k + 127) / 255 | 0;
      dst[d + 3] = a + (((dst[d + 3] ?? 0) * k + 127) / 255 | 0);
    }
  }
}
