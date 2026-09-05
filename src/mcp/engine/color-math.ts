// Colour math — pure, dependency-free, and deliberately a leaf.
//
// It lived in reference.ts, which also imports the tool-result helpers. Anything
// wanting to reason about colour therefore had to pull the whole extract_reference
// tool in with it, and design-precedent → design-signature → reference → utils
// closed a cycle back onto the module that writes designs. Same functions, one
// import level down; reference.ts re-exports them, so every existing caller is
// unchanged.
export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6); // drop alpha
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function toHex([r, g, b]: RGB): string {
  const c = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** Perceptual luminance 0..1 (sRGB-weighted, not gamma-linearized — enough for ranking). */
export function luminance([r, g, b]: RGB): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** HSL saturation 0..1. */
export function saturation([r, g, b]: RGB): number {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  if (mx === mn) return 0;
  return l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
}

/** Hue in degrees 0..360. */
export function hue([r, g, b]: RGB): number {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn), d = mx - mn;
  if (d === 0) return 0;
  let h: number;
  if (mx === rn) h = ((gn - bn) / d) % 6;
  else if (mx === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Dedupe near-identical colors (quantize to 16 levels/channel), preserve order. */
export function dedupeColors(hexes: string[]): RGB[] {
  const seen = new Set<string>();
  const out: RGB[] = [];
  for (const hx of hexes) {
    const rgb = hexToRgb(hx);
    if (!rgb) continue;
    const key = rgb.map(n => Math.round(n / 16)).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rgb);
  }
  return out;
}
