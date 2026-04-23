/**
 * Color theory palette generator — no external API.
 * All math derived from HSL color wheel relationships.
 */

export type SchemeType =
  | 'complementary'
  | 'analogous'
  | 'triadic'
  | 'split-complementary'
  | 'tetradic'
  | 'monochromatic';

export interface ColorScheme {
  type: SchemeType;
  base: string;
  colors: string[];
}

// ── Public API ───────────────────────────────────────────────

export function generateScheme(baseHex: string, type: SchemeType, count = 5): ColorScheme {
  const [h, s, l] = hexToHsl(baseHex);
  let hues: number[];

  switch (type) {
    case 'complementary':
      hues = [h, rotate(h, 180)]; break;
    case 'analogous':
      hues = [-30, -15, 0, 15, 30].map(d => rotate(h, d)); break;
    case 'triadic':
      hues = [h, rotate(h, 120), rotate(h, 240)]; break;
    case 'split-complementary':
      hues = [h, rotate(h, 150), rotate(h, 210)]; break;
    case 'tetradic':
      hues = [h, rotate(h, 90), rotate(h, 180), rotate(h, 270)]; break;
    case 'monochromatic':
      hues = Array.from({ length: count }, () => h); break;
  }

  const colors = type === 'monochromatic'
    ? monoVariants(h, s, count)
    : hues.slice(0, count).map(hue => hslToHex(hue, s, l));

  return { type, base: baseHex, colors };
}

export function suggestSchemes(baseHex: string): ColorScheme[] {
  const types: SchemeType[] = [
    'complementary', 'analogous', 'triadic',
    'split-complementary', 'tetradic', 'monochromatic',
  ];
  return types.map(t => generateScheme(baseHex, t));
}

// ── Internal helpers ─────────────────────────────────────────

function monoVariants(h: number, s: number, count: number): string[] {
  const lightnesses = Array.from({ length: count }, (_, i) =>
    Math.round(20 + (60 / (count - 1 || 1)) * i),
  );
  return lightnesses.map(l => hslToHex(h, s, l));
}

function rotate(h: number, deg: number): number {
  return ((h + deg) % 360 + 360) % 360;
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100, ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
