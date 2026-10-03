// A moving crop of decoded footage — the pixels of a pan or zoom inside a clip.
//
// A clip whose crop changes every frame cannot be cropped by ffmpeg's fixed
// filter, so its stream decodes the footage once, large enough for its closest
// zoom (never past the file's own size), and each frame takes its window here:
// bilinear, straight RGBA in and out. A window exactly the output's size, on
// whole pixels, is a row copy.

/** RGBA `dw×dh` sampled from the window (rx, ry, rw, rh) of an RGBA `sw×sh` frame. */
export function resampleRegion(src: Uint8Array, sw: number, sh: number, rx: number, ry: number, rw: number, rh: number, dw: number, dh: number): Buffer {
  const out = Buffer.alloc(dw * dh * 4);
  const ix = Math.round(rx), iy = Math.round(ry);
  if (Math.abs(rw - dw) < 1e-6 && Math.abs(rh - dh) < 1e-6 && Math.abs(rx - ix) < 1e-6 && Math.abs(ry - iy) < 1e-6 && ix >= 0 && iy >= 0 && ix + dw <= sw && iy + dh <= sh) {
    for (let y = 0; y < dh; y++) out.set(src.subarray(((iy + y) * sw + ix) * 4, ((iy + y) * sw + ix + dw) * 4), y * dw * 4);
    return out;
  }
  const sx = rw / dw, sy = rh / dh;
  const maxX = sw - 1, maxY = sh - 1;
  // Column taps once per frame: the left source column and its weight for every output x.
  const x0s = new Int32Array(dw), fxs = new Float32Array(dw);
  for (let x = 0; x < dw; x++) {
    const fx = Math.min(maxX, Math.max(0, rx + (x + 0.5) * sx - 0.5));
    const x0 = Math.min(maxX - 1 < 0 ? 0 : maxX - 1, Math.floor(fx));
    x0s[x] = x0; fxs[x] = fx - x0;
  }
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(maxY, Math.max(0, ry + (y + 0.5) * sy - 0.5));
    const y0 = Math.min(maxY - 1 < 0 ? 0 : maxY - 1, Math.floor(fy));
    const wy = fy - y0, r0 = y0 * sw * 4, r1 = Math.min(maxY, y0 + 1) * sw * 4;
    let d = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      const c0 = (x0s[x] ?? 0) * 4, c1 = Math.min(maxX, (x0s[x] ?? 0) + 1) * 4, wx = fxs[x] ?? 0;
      for (let ch = 0; ch < 4; ch++) {
        const top = (src[r0 + c0 + ch] ?? 0) + ((src[r0 + c1 + ch] ?? 0) - (src[r0 + c0 + ch] ?? 0)) * wx;
        const bot = (src[r1 + c0 + ch] ?? 0) + ((src[r1 + c1 + ch] ?? 0) - (src[r1 + c0 + ch] ?? 0)) * wx;
        out[d++] = top + (bot - top) * wy + 0.5;
      }
    }
  }
  return out;
}

/**
 * Where a crop's window lies in a frame decoded at `decoded` × the file's size, for an
 * output box w×h: the footage covers the box at zoom 1 (scale `cover`), enlarged by
 * `zoom`, aligned by `focus` — the same reading as ffmpeg's crop at (iw−ow)·x.
 */
export function cropWindow(fileW: number, fileH: number, w: number, h: number, focus: readonly [number, number], zoom: number, decoded: number): { rx: number; ry: number; rw: number; rh: number } {
  const cover = Math.max(w / fileW, h / fileH);
  const zw = fileW * cover * zoom, zh = fileH * cover * zoom;
  const k = decoded / (cover * zoom);
  return { rx: (zw - w) * focus[0] * k, ry: (zh - h) * focus[1] * k, rw: w * k, rh: h * k };
}
