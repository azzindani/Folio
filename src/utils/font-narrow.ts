/**
 * Only the fonts a render names.
 *
 * resvg builds its font database from every font it is handed, on EVERY render:
 * the bundled set, the shared library tree and the system fonts. Measured in the
 * container on a 1080p frame naming one family: 47.5 ms with all of them, 13.6 ms
 * with that family's files — ~34 ms off every raster frame of every export. A
 * render whose SVG names only bundled families (the manifest in a font dir lists
 * them) gets just those files plus DejaVu, resvg's fallback for generic and
 * missing names — but only when those families hold every character the text
 * uses: a glyph a font lacks (✓ → ▪) is found by searching every loaded font,
 * and a smaller set would find a different one (3 of 40 live designs drew a
 * different checkmark). Anything else — a project or library font, italic text
 * (no bundled face is italic; the shared library holds some), a symbol outside
 * the named families, no DejaVu found — keeps the full option.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ResvgRenderOptions } from '@resvg/resvg-js';
import { parseFontMetrics, type FontMetrics } from './font-metrics';

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif',
  'ui-serif', 'ui-monospace', 'inherit', 'initial', 'dejavu sans']);
const DEJAVU_DIRS = ['/usr/share/fonts/dejavu', '/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/TTF', '/usr/local/share/fonts'];

const manifests = new Map<string, Map<string, string[]> | null>();
let fallback: string[] | null | undefined;

/** Lowercased family → absolute file paths, from `<dir>/manifest.json`; null when the dir has none. */
function manifestOf(dir: string): Map<string, string[]> | null {
  const hit = manifests.get(dir);
  if (hit !== undefined) return hit;
  let out: Map<string, string[]> | null = null;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { files?: Record<string, string[]> };
    out = new Map(Object.entries(m.files ?? {}).map(([fam, files]) => [fam.toLowerCase(), files.map(f => path.join(dir, f))]));
  } catch { /* no manifest here */ }
  manifests.set(dir, out);
  return out;
}

/** DejaVu Sans files on this host — resvg's fallback face — or null when none is installed. */
export function fallbackFonts(): string[] | null {
  if (fallback !== undefined) return fallback;
  fallback = null;
  for (const dir of DEJAVU_DIRS) {
    try {
      const files = fs.readdirSync(dir).filter(f => /^DejaVuSans.*\.ttf$/i.test(f)).map(f => path.join(dir, f));
      if (files.length) { fallback = files; break; }
    } catch { /* not here */ }
  }
  return fallback;
}

const metrics = new Map<string, FontMetrics | null>();

/** Whether any of a family's files maps the code point to a glyph. */
function covers(files: readonly string[], cp: number): boolean {
  return files.some(f => {
    let m = metrics.get(f);
    if (m === undefined) {
      try { m = parseFontMetrics(fs.readFileSync(f)); } catch { m = null; }
      metrics.set(f, m);
    }
    return m?.advance(cp) !== undefined;
  });
}

/** Every code point in the SVG's text (tags and styles dropped, entities decoded), whitespace aside. */
export function textCodePoints(svg: string): Set<number> {
  const text = svg.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;|&gt;|&quot;|&apos;|&amp;/g, e => ({ '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' })[e] ?? e);
  const out = new Set<number>();
  for (const ch of text) if (!/\s/.test(ch)) out.add(ch.codePointAt(0) ?? 0);
  return out;
}

const ENTITY: Record<string, string> = { '&quot;': '"', '&apos;': "'", '&#39;': "'", '&amp;': '&' };

/** Every family an SVG names in a font-family attribute or style, lowercased, unquoted. */
export function svgFamilies(svg: string): Set<string> {
  const out = new Set<string>();
  for (const m of svg.matchAll(/font-family\s*(?:=\s*"([^"]*)"|=\s*'([^']*)'|:\s*([^;"}<]*))/g)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(/&quot;|&apos;|&#39;|&amp;/g, e => ENTITY[e] ?? e);
    for (const part of raw.split(',')) {
      const fam = part.trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
      if (fam) out.add(fam);
    }
  }
  return out;
}

/** The render's font option cut down to the files its SVG names, when every name is bundled. */
export function narrowFonts(svg: string, opts?: ResvgRenderOptions): ResvgRenderOptions | undefined {
  const font = opts?.font;
  if (!font || !font.fontDirs?.length || font.fontFiles?.length || /font-style\s*[:=]\s*["']?\s*(italic|oblique)/.test(svg)) return opts;
  const manifest = font.fontDirs.map(manifestOf).find(m => m !== null);
  const base = fallbackFonts();
  if (!manifest || !base) return opts;
  const files = new Set(base);
  const named: string[][] = [];
  const families = svgFamilies(svg);
  // Text set in a generic family, or in none, is drawn in DejaVu: its characters must be there too.
  if (!families.size || [...families].some(f => GENERIC.has(f))) named.push(base);
  for (const fam of families) {
    if (GENERIC.has(fam)) continue;
    const own = manifest.get(fam);
    if (!own) return opts;
    named.push(own);
    for (const f of own) files.add(f);
  }
  for (const cp of textCodePoints(svg)) if (named.some(own => !covers(own, cp))) return opts;
  return { ...opts, font: { fontFiles: [...files], loadSystemFonts: false, defaultFontFamily: font.defaultFontFamily ?? 'DejaVu Sans' } };
}
