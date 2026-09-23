/**
 * Perspective warp — a flat picture laid exactly on a turning face.
 *
 * The perspective projection of a plane is a homography, fixed by where four
 * corners land. A scene rendered once is drawn onto its face by mapping every
 * frame pixel back through the inverse homography and sampling the scene
 * bilinearly: exact perspective, no strips, one render per face. Pixels are
 * premultiplied RGBA, as resvg hands them over, so sampling and compositing
 * need no conversion. (The editor draws the same faces as vector strips —
 * scene-transition-3d.ts.)
 */

/** A point in pixels. */
export type Pt = [number, number];
/** A premultiplied RGBA picture. */
export interface Pixels { width: number; height: number; pixels: Uint8Array | Uint8ClampedArray }

/** Solve A·x = b by elimination with partial pivoting; null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i] ?? 0]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]?.[c] ?? 0) > Math.abs(M[p]?.[c] ?? 0)) p = r;
    const pivot = M[p];
    if (!pivot || Math.abs(pivot[c] ?? 0) < 1e-12) return null;
    [M[c], M[p]] = [pivot, M[c] ?? pivot];
    for (let r = 0; r < n; r++) {
      const row = M[r];
      if (r === c || !row) continue;
      const k = (row[c] ?? 0) / (pivot[c] ?? 1);
      for (let j = c; j <= n; j++) row[j] = (row[j] ?? 0) - k * (pivot[j] ?? 0);
    }
  }
  return M.map((row, i) => (row[n] ?? 0) / (row[i] ?? 1));
}

/** The 3×3 homography (row-major) taking src[i] to dst[i]; null when the points are degenerate. */
export function homography(src: Pt[], dst: Pt[]): number[] | null {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i] ?? [0, 0], [u, v] = dst[i] ?? [0, 0];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

/** The inverse of a 3×3 matrix, or null when singular. */
export function invert3(m: number[]): number[] | null {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 0] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return inv.map(v => v / det);
}

/**
 * Draw `src` onto `dst` so its corners land on `quad` (top-left, top-right,
 * bottom-right, bottom-left), source-over. Coverage ramps over the last pixel
 * at the picture's edge, so the face's outline is anti-aliased.
 */
export function warpOnto(dst: Pixels, src: Pixels, quad: Pt[]): void {
  const W = src.width, H = src.height;
  const fwd = homography([[0, 0], [W, 0], [W, H], [0, H]], quad);
  const inv = fwd ? invert3(fwd) : null;
  if (!inv) return;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 0] = inv;
  const xs = quad.map(p => p[0]), ys = quad.map(p => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), x1 = Math.min(dst.width, Math.ceil(Math.max(...xs)) + 1);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1), y1 = Math.min(dst.height, Math.ceil(Math.max(...ys)) + 1);
  const S = src.pixels, D = dst.pixels;
  for (let y = y0; y < y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x < x1; x++) {
      const px = x + 0.5;
      const w = g * px + h * py + i;
      if (w <= 0) continue;
      // Where this pixel's centre falls in the picture, in its pixel-centre coordinates.
      const sx = (a * px + b * py + c) / w - 0.5, sy = (d * px + e * py + f) / w - 0.5;
      const inside = Math.min(sx + 0.5, sy + 0.5, W - 0.5 - sx, H - 0.5 - sy);
      const cov = Math.min(1, inside + 0.5);
      if (cov <= 0) continue;
      const cx = Math.min(W - 1, Math.max(0, sx)), cy = Math.min(H - 1, Math.max(0, sy));
      const ix = Math.floor(cx), iy = Math.floor(cy), fx = cx - ix, fy = cy - iy;
      const ix1 = Math.min(W - 1, ix + 1), iy1 = Math.min(H - 1, iy + 1);
      const o00 = (iy * W + ix) * 4, o10 = (iy * W + ix1) * 4, o01 = (iy1 * W + ix) * 4, o11 = (iy1 * W + ix1) * 4;
      const w00 = (1 - fx) * (1 - fy) * cov, w10 = fx * (1 - fy) * cov, w01 = (1 - fx) * fy * cov, w11 = fx * fy * cov;
      const at = (o: number): number => (S[o] ?? 0);
      const sa = at(o00 + 3) * w00 + at(o10 + 3) * w10 + at(o01 + 3) * w01 + at(o11 + 3) * w11;
      if (sa <= 0) continue;
      const keep = 1 - sa / 255, o = (y * dst.width + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        D[o + ch] = at(o00 + ch) * w00 + at(o10 + ch) * w10 + at(o01 + ch) * w01 + at(o11 + ch) * w11 + (D[o + ch] ?? 0) * keep;
      }
    }
  }
}

/** `src` over `dst`, pixel for pixel — the same size. */
export function overOnto(dst: Pixels, src: Pixels): void {
  const S = src.pixels, D = dst.pixels;
  for (let o = 0; o < D.length && o < S.length; o += 4) {
    const a = S[o + 3] ?? 0;
    if (a === 0) continue;
    const keep = 1 - a / 255;
    for (let ch = 0; ch < 4; ch++) D[o + ch] = (S[o + ch] ?? 0) + (D[o + ch] ?? 0) * keep;
  }
}

/**
 * A frame of a turning face: the stage colour, each face's picture warped onto
 * its corners (canvas px, scaled to the picture), then `top` — what sits over
 * the turn, the captions — laid on unwarped. `top` sets the frame's size.
 */
export function paintTurning(stage: string, faces: Array<{ img: Pixels; corners: Pt[] }>, top: Pixels, canvasWidth: number): Pixels & { pixels: Uint8ClampedArray } {
  const out = { width: top.width, height: top.height, pixels: new Uint8ClampedArray(top.width * top.height * 4) };
  const hex = /^#?([0-9a-f]{6})$/i.exec(stage.trim())?.[1] ?? '101010';
  const v = parseInt(hex, 16);
  for (let o = 0; o < out.pixels.length; o += 4) out.pixels.set([(v >> 16) & 255, (v >> 8) & 255, v & 255, 255], o);
  const k = top.width / canvasWidth;
  for (const f of faces) warpOnto(out, f.img, f.corners.map(([x, y]): Pt => [x * k, y * k]));
  overOnto(out, top);
  return out;
}
