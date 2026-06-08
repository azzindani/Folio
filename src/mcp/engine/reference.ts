// extract_reference — turn a reference design (Canva export, screenshot, SVG)
// into a deterministic palette + canvas + a composition brief the model fills
// by LOOKING at the image. The model has vision; this tool supplies the things
// the model is unreliable at: exact pixel dimensions and a role-mapped palette.
//
// Pure & synchronous (handlers are sync). Image bytes come from a data: URL or
// a local file path; remote http(s) URLs degrade to model-observed colors.

import * as fs from 'fs';
import {
  resolvePath, okResult, errResult, pOk, pInfo, pWarn,
  buildContext, buildHandover,
} from './utils';
import type { ToolResult, ProgressItem, NextAction } from '../types';

// ── Color math (pure) ─────────────────────────────────────────
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

// ── Dimension header parsers (pure, no decode) ────────────────
/** Read width/height from PNG/JPEG/GIF/WebP magic-number headers. Null if unknown. */
export function parseDimensions(buf: Buffer): { w: number; h: number } | null {
  try {
    // PNG: 8-byte signature, IHDR width@16 height@20 (big-endian).
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    // GIF: "GIF" + logical screen width/height @6,@8 (little-endian).
    if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    }
    // WebP: RIFF....WEBP; VP8X carries explicit canvas size (1 + 24-bit).
    if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fmt = buf.toString('ascii', 12, 16);
      if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      if (fmt === 'VP8 ' && buf.length >= 30) return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
    // JPEG: scan segment markers for a Start-Of-Frame (SOFn).
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let o = 2;
      while (o + 9 < buf.length) {
        if (buf[o] !== 0xff) { o++; continue; }
        const m = buf[o + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
        }
        o += 2 + buf.readUInt16BE(o + 2);
      }
    }
  } catch { /* malformed header — fall through to null */ }
  return null;
}

/** Extract dimensions + colors from raw SVG markup. */
export function parseSvg(text: string): { dims: { w: number; h: number } | null; colors: string[] } {
  let dims: { w: number; h: number } | null = null;
  const wh = text.match(/\bwidth\s*=\s*["']?([\d.]+)/i);
  const hh = text.match(/\bheight\s*=\s*["']?([\d.]+)/i);
  if (wh && hh) dims = { w: Math.round(parseFloat(wh[1])), h: Math.round(parseFloat(hh[1])) };
  else {
    const vb = text.match(/viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/i);
    if (vb) dims = { w: Math.round(parseFloat(vb[1])), h: Math.round(parseFloat(vb[2])) };
  }
  const colors: string[] = [];
  for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) colors.push(m[0]);
  return { dims, colors };
}

// ── Palette role classification (pure) ────────────────────────
export interface ReferencePalette {
  background: string; surface: string; text: string; text_muted: string;
  border: string; primary: string; secondary: string; accent: string;
}

/** Map an unordered color list onto semantic roles via luminance + saturation. */
export function classifyPalette(rgbs: RGB[]): ReferencePalette | null {
  if (rgbs.length === 0) return null;
  const sorted = [...rgbs].sort((a, b) => luminance(a) - luminance(b));
  const meanLum = rgbs.reduce((s, c) => s + luminance(c), 0) / rgbs.length;
  const dark = meanLum < 0.5;
  const darkest = sorted[0], lightest = sorted[sorted.length - 1];

  const bg = dark ? darkest : lightest;
  let text = dark ? lightest : darkest;
  if (Math.abs(luminance(text) - luminance(bg)) < 0.35) text = dark ? [250, 250, 250] : [10, 10, 10];

  const key = (c: RGB): string => c.map(n => Math.round(n / 16)).join(',');
  const used = new Set([key(bg), key(text)]);
  const chroma = rgbs.filter(c => !used.has(key(c))).sort((a, b) => saturation(b) - saturation(a));
  const primary = chroma[0] ?? [...rgbs].sort((a, b) => saturation(b) - saturation(a))[0] ?? text;
  const secondary = chroma.find(c => Math.abs(hue(c) - hue(primary)) > 40) ?? chroma[1] ?? primary;

  return {
    background: toHex(bg),
    surface: toHex(mix(bg, text, dark ? 0.08 : 0.06)),
    text: toHex(text),
    text_muted: toHex(mix(text, bg, 0.45)),
    border: toHex(mix(bg, text, 0.18)),
    primary: toHex(primary),
    secondary: toHex(secondary),
    accent: toHex(primary),
  };
}

// ── Canvas recommendation (pure) ──────────────────────────────
const CANVAS_TARGETS = [
  { type: 'square (1:1)', width: 1080, height: 1080 },
  { type: 'portrait (4:5)', width: 1080, height: 1350 },
  { type: 'story (9:16)', width: 1080, height: 1920 },
  { type: 'landscape (16:9)', width: 1920, height: 1080 },
] as const;

export function recommendCanvas(dims: { w: number; h: number }): { width: number; height: number; type: string } {
  const ratio = dims.w / Math.max(1, dims.h);
  let best: { type: string; width: number; height: number } = CANVAS_TARGETS[0];
  let bestDiff = Infinity;
  for (const t of CANVAS_TARGETS) {
    const diff = Math.abs(Math.log(ratio / (t.width / t.height)));
    if (diff < bestDiff) { bestDiff = diff; best = t; }
  }
  return { width: best.width, height: best.height, type: best.type };
}

// ── Composition brief (pure) ──────────────────────────────────
function buildBrief(p: ReferencePalette | null, canvas: { width: number; height: number; type: string } | null, mood: string | null): string {
  const lines: string[] = [
    'REFERENCE BRIEF — reproduce this design as NATIVE editable layers (rect/text/icon/feature_grid), NOT a flattened image.',
  ];
  if (canvas) lines.push(`CANVAS: ${canvas.width}x${canvas.height} (${canvas.type}) — pass width/height to create_design.`);
  if (p) {
    lines.push('PALETTE — use these EXACT hex, do not invent new colors:');
    lines.push(`  bg ${p.background} · surface ${p.surface} · text ${p.text} · muted ${p.text_muted}`);
    lines.push(`  accent ${p.accent} (use 1–2× only — a stat or a rule) · secondary ${p.secondary} · border ${p.border}`);
    const bgLayer = canvas ? `{id:"bg",type:"rect",z:0,pos:[0,0,${canvas.width},${canvas.height}],fill:"${p.background}"}` : `a full-canvas rect filled "${p.background}"`;
    lines.push(`⚠️ MANDATORY FIRST LAYER: ${bgLayer}. The canvas MUST be ${p.background} — do NOT default to white or navy. Then put text in ${p.text}; use ${p.accent} on only 1–2 elements. Every text color must contrast with the block it sits on (add_layers will flag invisible text).`);
  }
  if (mood) lines.push(`MOOD: ${mood}`);
  lines.push(
    'NOW LOOK AT THE REFERENCE, then build with add_layers:',
    '  1. Map each visual block → a layer: eyebrow/kicker → mono text · headline → big display text (4–5× body) · body → text · cards/benefits → ONE feature_grid · logo/photo → image(src)/icon · divider → thin rect rule.',
    '  2. Match LAYOUT: same alignment (left-anchor vs centered), hierarchy, column count, spacing. Keep empty space the reference leaves.',
    '  3. Match TYPE by category you see: serif display → "Playfair Display" · grotesk → "Space Grotesk"/"Inter" · mono labels → "IBM Plex Mono". Headline weight 700–800, tight lh 1.0–1.05.',
    '  4. Flat bg, ONE accent, text in the palette text color. Avoid the AI-template look (navy gradient + glow + everything centered).',
    'Then seal_design → export_design.',
  );
  return lines.join('\n');
}

// ── Orchestrator (I/O: data: URL or local file path) ──────────
function decodeImage(image: string, maxBytes: number): { dims: { w: number; h: number } | null; colors: string[]; note?: ProgressItem; source: string } {
  // Remote URLs can't be fetched synchronously — degrade to model-observed colors.
  if (/^https?:/i.test(image)) {
    return { dims: null, colors: [], source: 'url', note: pWarn('Remote URL not fetched', 'Pass a data: URL or local path for exact dimensions; meanwhile send colors:[…] you observe.') };
  }
  const dataMatch = image.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/);
  try {
    if (dataMatch) {
      const mime = dataMatch[1] ?? '', isB64 = Boolean(dataMatch[2]), payload = dataMatch[3] ?? '';
      if (payload.length > maxBytes) return { dims: null, colors: [], source: 'data', note: pWarn('Image too large', `>${Math.round(maxBytes / 1024)}KB — downscale or pass colors:[…].`) };
      if (mime.includes('svg') || (!isB64 && decodeURIComponent(payload).trimStart().startsWith('<svg'))) {
        const svg = isB64 ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload);
        const r = parseSvg(svg);
        return { dims: r.dims, colors: r.colors, source: 'data:svg' };
      }
      const buf = isB64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'binary');
      return { dims: parseDimensions(buf), colors: [], source: 'data:raster' };
    }
    // Treat as a local file path under an allowed root.
    const resolved = resolvePath(image);
    if (!fs.existsSync(resolved)) return { dims: null, colors: [], source: 'path', note: pWarn('File not found', `No file at ${image} — pass a data: URL or colors:[…].`) };
    if (fs.statSync(resolved).size > maxBytes) return { dims: null, colors: [], source: 'path', note: pWarn('Image too large', 'Downscale or pass colors:[…].') };
    if (/\.svg$/i.test(resolved)) {
      const r = parseSvg(fs.readFileSync(resolved, 'utf8'));
      return { dims: r.dims, colors: r.colors, source: 'path:svg' };
    }
    return { dims: parseDimensions(fs.readFileSync(resolved)), colors: [], source: 'path:raster' };
  } catch (e) {
    return { dims: null, colors: [], source: 'error', note: pWarn('Could not read image', (e as Error).message) };
  }
}

export function extractReference(args: { image?: string; colors?: string[]; project_path?: string; name?: string }): ToolResult {
  const op = 'extract_reference';
  const progress: ProgressItem[] = [];
  const maxBytes = parseInt(process.env['FOLIO_MAX_REF_BYTES'] ?? '', 10) || 4 * 1024 * 1024;

  let dims: { w: number; h: number } | null = null;
  let svgColors: string[] = [];
  let source = 'colors-only';
  if (args.image) {
    const d = decodeImage(args.image, maxBytes);
    dims = d.dims; svgColors = d.colors; source = d.source;
    if (d.note) progress.push(d.note);
  }

  const observed = (args.colors && args.colors.length ? args.colors : svgColors);
  const rgbs = dedupeColors(observed);
  if (rgbs.length === 0 && !dims) {
    return errResult(op, 'No colors or readable image', 'Look at the reference and pass colors:["#…", …] (the main hex you see), and/or image= a data: URL or local file path for exact dimensions.', progress);
  }

  const palette = classifyPalette(rgbs);
  const canvas = dims ? recommendCanvas(dims) : null;
  const mood = rgbs.length ? (rgbs.reduce((s, c) => s + luminance(c), 0) / rgbs.length < 0.5 ? 'dark' : 'light') : null;
  if (dims) progress.push(pInfo('Dimensions', `${dims.w}x${dims.h} → ${canvas?.type}`));
  if (palette) progress.push(pOk('Palette mapped', `${rgbs.length} colors → ${mood} roles`));

  const palette_spec = palette ? {
    _protocol: 'palette/v1', id: `ref-${(args.name ?? 'reference').toLowerCase().replace(/\s+/g, '-')}`,
    name: `From reference${args.name ? ` — ${args.name}` : ''}`, version: '1.0.0', colors: { ...palette },
  } : null;

  const brief = buildBrief(palette, canvas, mood);
  // A ready-to-paste first layer: the full-canvas background in the extracted
  // color, so the model literally cannot drop the reference's canvas color.
  const starter_layers = (palette && canvas)
    ? [{ id: 'bg', type: 'rect', z: 0, pos: [0, 0, canvas.width, canvas.height], fill: palette.background }]
    : undefined;
  const next_action: NextAction = args.project_path ? {
    tool: 'create_design',
    params: { project_path: args.project_path, name: args.name ?? 'reference-design', ...(canvas ? { width: canvas.width, height: canvas.height } : {}) },
    remaining: 1, hint: `Create the design at the recommended canvas, then add_layers — your FIRST layer MUST be the full-canvas background${palette ? ` filled ${palette.background}` : ''} (see starter_layers), then build the rest with the EXACT palette hex. Reproduce the reference layout; do not default to a white/navy-gradient template.`,
  } : {
    tool: 'create_project', params: { name: args.name ?? 'reference-design' },
    remaining: 2, hint: 'Create a project, then create_design at the recommended canvas and add_layers with the palette above.',
  };

  const context = buildContext(op, `Extracted ${rgbs.length} colors${dims ? ` + ${dims.w}x${dims.h}` : ''} from reference`);
  const handover = buildHandover('PROJECT', args.project_path ? { project_path: args.project_path } : {});
  return okResult(op, { source, dimensions: dims, canvas, mood, palette, palette_spec, ...(starter_layers ? { starter_layers } : {}), observed_colors: rgbs.map(toHex), brief, next_action, progress, context, handover });
}
