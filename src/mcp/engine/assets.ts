// Project asset store — ingest (data: URI / in-sandbox path), list, delete.
// Assets are PLAIN FILES under <project>/assets/{images,icons,fonts}; the
// project.yaml `assets:` block is a regenerable manifest carrying what the
// file alone can't tell a vision-less model: dimensions, dominant colors,
// luminance class, alt text. No base64 ever lands inside a .design.yaml.
import * as fs from 'fs';
import * as path from 'path';
import type { ToolResult, ProgressItem, NextAction } from '../types';
import {
  resolvePath, resolveProjectPath, readYAML, writeYAML, snapshot,
  okResult, errResult, buildContext, buildHandover, pOk, pInfo, pWarn,
} from './utils';
import { parseDimensions, parseSvg, dedupeColors, toHex, luminance as lumOf } from './reference';

// ── Types ─────────────────────────────────────────────────────
export type AssetKind = 'images' | 'icons' | 'fonts';

export interface AssetEntry {
  id: string;                 // stable slug, unique per project
  path: string;               // project-relative, e.g. "assets/images/team.jpg"
  kind: AssetKind;
  bytes: number;
  width?: number;             // raster/svg pixel dims (absent for fonts)
  height?: number;
  dominant_colors?: string[]; // ≤4 hex, most-covering first
  luminance?: 'dark' | 'light' | 'busy';
  alt?: string;               // operator/model description — a blind model's eyes
  added: string;              // ISO date
}

interface ProjectManifest {
  assets?: Partial<Record<AssetKind, AssetEntry[]>> & Record<string, unknown>;
  [key: string]: unknown;
}

// ── Limits (env-tunable; sized for the 4 GiB container) ──────
export function maxAssetBytes(): number {
  return parseInt(process.env['FOLIO_MAX_ASSET_BYTES'] ?? '', 10) || 8 * 1024 * 1024;
}
export function maxAssetsTotalBytes(): number {
  return parseInt(process.env['FOLIO_MAX_ASSETS_TOTAL'] ?? '', 10) || 256 * 1024 * 1024;
}

// ── Type allowlist ────────────────────────────────────────────
const EXT_KIND: Record<string, AssetKind> = {
  png: 'images', jpg: 'images', jpeg: 'images', webp: 'images', gif: 'images',
  avif: 'images', svg: 'images',
  ttf: 'fonts', otf: 'fonts', woff2: 'fonts', woff: 'fonts',
};
const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'font/ttf': 'ttf', 'font/otf': 'otf', 'font/woff2': 'woff2', 'font/woff': 'woff',
};

/** Strip directories + dangerous chars; enforce an allowlisted extension. */
export function sanitizeAssetName(name: string): { name: string; ext: string; kind: AssetKind } | null {
  const base = path.basename(String(name)).replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').toLowerCase();
  const ext = (base.match(/\.([a-z0-9]+)$/)?.[1] ?? '');
  const kind = EXT_KIND[ext];
  if (!kind || base.length <= ext.length + 1) return null;
  return { name: base, ext, kind };
}

/** icons/ is images-shaped but kept as its own folder when the caller asks. */
function targetKind(fileKind: AssetKind, requested?: string): AssetKind {
  if (requested === 'icons' && fileKind === 'images') return 'icons';
  return fileKind;
}

// ── Metadata extraction ───────────────────────────────────────
export interface AssetMeta {
  width?: number; height?: number;
  dominant_colors?: string[];
  luminance?: 'dark' | 'light' | 'busy';
}

export function extractAssetMeta(buf: Buffer, ext: string): AssetMeta {
  if (EXT_KIND[ext] === 'fonts') return {};
  if (ext === 'svg') {
    const { dims, colors } = parseSvg(buf.toString('utf8'));
    const rgbs = dedupeColors(colors).slice(0, 4);
    const meta: AssetMeta = {};
    if (dims) { meta.width = dims.w; meta.height = dims.h; }
    if (rgbs.length) {
      meta.dominant_colors = rgbs.map(toHex);
      meta.luminance = rgbs.reduce((s, c) => s + lumOf(c), 0) / rgbs.length < 0.5 ? 'dark' : 'light';
    }
    return meta;
  }
  const dims = parseDimensions(buf);
  const meta: AssetMeta = dims ? { width: dims.w, height: dims.h } : {};
  const sampled = sampleRasterColors(buf, ext);
  return { ...meta, ...sampled };
}

// Rasters are sampled by rendering the image into a tiny SVG via resvg (the
// rasterizer we already ship) and quantizing the pixels — no new decoder dep.
const SAMPLE = 24;
function sampleRasterColors(buf: Buffer, ext: string): Pick<AssetMeta, 'dominant_colors' | 'luminance'> {
  try {
    // Lazy require keeps module load cheap for callers that never ingest.
    const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js');
    const mime = Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? 'image/png';
    const uri = `data:${mime};base64,${buf.toString('base64')}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SAMPLE}" height="${SAMPLE}">` +
      `<image width="${SAMPLE}" height="${SAMPLE}" preserveAspectRatio="xMidYMid slice" href="${uri}"/></svg>`;
    const px = new Resvg(svg, {}).render().pixels;
    const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
    let lumSum = 0, opaque = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      opaque++;
      lumSum += lumOf([r, g, b]);
      const k = `${r >> 5},${g >> 5},${b >> 5}`;   // 3-bit/channel buckets
      const cur = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      cur.n++; cur.r += r; cur.g += g; cur.b += b;
      buckets.set(k, cur);
    }
    if (!opaque) return {};
    const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 4)
      .map(c => toHex([Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)]));
    const meanLum = lumSum / opaque;
    // "busy" = many distinct color regions → text needs a scrim on top of it.
    const lum = buckets.size > 24 ? 'busy' : meanLum < 0.5 ? 'dark' : 'light';
    return { dominant_colors: top, luminance: lum };
  } catch { return {}; } // sampling is best-effort; dims alone still useful
}

// ── Manifest I/O ──────────────────────────────────────────────
const KINDS: AssetKind[] = ['images', 'icons', 'fonts'];

export function readAssetManifest(projectDir: string): Partial<Record<AssetKind, AssetEntry[]>> {
  const file = path.join(projectDir, 'project.yaml');
  if (!fs.existsSync(file)) return {};
  try {
    const proj = readYAML<ProjectManifest>(file);
    const out: Partial<Record<AssetKind, AssetEntry[]>> = {};
    for (const k of KINDS) {
      const rows = proj.assets?.[k];
      if (Array.isArray(rows)) out[k] = rows.filter((r): r is AssetEntry => Boolean(r) && typeof r === 'object' && typeof (r as AssetEntry).path === 'string');
    }
    return out;
  } catch { return {}; }
}

function writeManifestEntry(projectDir: string, entry: AssetEntry): void {
  const file = path.join(projectDir, 'project.yaml');
  if (!fs.existsSync(file)) return; // asset dir without project.yaml — file is still the truth
  const proj = readYAML<ProjectManifest>(file);
  proj.assets = proj.assets ?? {};
  const rows = (Array.isArray(proj.assets[entry.kind]) ? proj.assets[entry.kind] : []) as AssetEntry[];
  proj.assets[entry.kind] = [...rows.filter(r => r?.path !== entry.path), entry];
  writeYAML(file, proj);
}

function removeManifestEntry(projectDir: string, relPath: string): void {
  const file = path.join(projectDir, 'project.yaml');
  if (!fs.existsSync(file)) return;
  const proj = readYAML<ProjectManifest>(file);
  if (!proj.assets) return;
  for (const k of KINDS) {
    const rows = proj.assets[k];
    if (Array.isArray(rows)) proj.assets[k] = (rows as AssetEntry[]).filter(r => r?.path !== relPath);
  }
  writeYAML(file, proj);
}

function assetsTotalBytes(projectDir: string): number {
  let total = 0;
  const root = path.join(projectDir, 'assets');
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else total += fs.statSync(p).size;
    }
  };
  walk(root);
  return total;
}

// ── Core ingest (shared by MCP op + HTTP upload route) ────────
export interface IngestArgs {
  projectDir: string;          // absolute, already sandbox-resolved
  name: string;                // desired filename (sanitized here)
  data?: Buffer;               // raw bytes (HTTP route)
  dataUri?: string;            // data: URI (MCP op)
  sourcePath?: string;         // in-sandbox file to copy (MCP op)
  kind?: string;               // optional 'icons' override
  alt?: string;
}
export class AssetError extends Error {
  constructor(message: string, public status: number, public hint: string) { super(message); }
}

export function ingestAsset(args: IngestArgs): { entry: AssetEntry; warnings: string[] } {
  const warnings: string[] = [];
  const clean = sanitizeAssetName(args.name);
  if (!clean) {
    throw new AssetError(`Unsupported asset name/type: "${args.name}"`, 415,
      `Allowed extensions: ${Object.keys(EXT_KIND).join(', ')}.`);
  }

  // Resolve the bytes from whichever source the caller has.
  let buf: Buffer;
  if (args.data) {
    buf = args.data;
  } else if (args.dataUri) {
    const m = args.dataUri.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/);
    if (!m) throw new AssetError('data is not a valid data: URI', 400, 'Pass data:"data:image/png;base64,…" or source_path to an existing file.');
    buf = m[2] ? Buffer.from(m[3] ?? '', 'base64') : Buffer.from(decodeURIComponent(m[3] ?? ''), 'utf8');
    // Trust the URI's mime over the filename when they disagree.
    const mimeExt = MIME_EXT[(m[1] ?? '').toLowerCase()];
    if (mimeExt && mimeExt !== clean.ext && EXT_KIND[mimeExt]) {
      warnings.push(`extension .${clean.ext} did not match ${m[1]} — saved as .${mimeExt}`);
      clean.name = clean.name.replace(/\.[a-z0-9]+$/, `.${mimeExt}`);
      clean.ext = mimeExt;
      clean.kind = EXT_KIND[mimeExt];
    }
  } else if (args.sourcePath) {
    // Only files already inside the sandbox (projects dir or /tmp) — resolvePath
    // gates traversal; we additionally require existence.
    const src = resolvePath(args.sourcePath);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
      throw new AssetError(`source_path not found: ${args.sourcePath}`, 404, 'Pass data: URI bytes instead, or a path inside the projects dir.');
    }
    buf = fs.readFileSync(src);
  } else {
    throw new AssetError('No asset bytes given', 400, 'Pass data (data: URI) or source_path.');
  }

  if (buf.length === 0) throw new AssetError('Asset is empty (0 bytes)', 400, 'Check the data: URI payload.');
  if (buf.length > maxAssetBytes()) {
    throw new AssetError(`Asset too large: ${Math.round(buf.length / 1024)} KiB > ${Math.round(maxAssetBytes() / 1024)} KiB cap`, 413,
      'Downscale/compress the image, or raise FOLIO_MAX_ASSET_BYTES.');
  }
  const total = assetsTotalBytes(args.projectDir);
  if (total + buf.length > maxAssetsTotalBytes()) {
    throw new AssetError('Project asset quota exceeded', 413,
      `Project holds ${Math.round(total / 1024 / 1024)} MiB; cap is ${Math.round(maxAssetsTotalBytes() / 1024 / 1024)} MiB (FOLIO_MAX_ASSETS_TOTAL). Delete unused assets first.`);
  }

  // SVG assets are text the browser will execute inside the editor — strip scripts.
  if (clean.ext === 'svg') {
    const text = buf.toString('utf8');
    if (/<script[\s>]/i.test(text) || /\bon[a-z]+\s*=/i.test(text)) {
      const stripped = text.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      buf = Buffer.from(stripped, 'utf8');
      warnings.push('svg contained script/event handlers — stripped');
    }
  }

  const kind = targetKind(clean.kind, args.kind);
  const dir = path.join(args.projectDir, 'assets', kind);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, clean.name);
  const relPath = `assets/${kind}/${clean.name}`;
  const existed = fs.existsSync(abs);
  if (existed) { snapshot(abs); warnings.push(`replaced existing ${relPath}`); }
  fs.writeFileSync(abs, buf);

  const meta = extractAssetMeta(buf, clean.ext);
  const entry: AssetEntry = {
    id: clean.name.replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9-]+/g, '-'),
    path: relPath, kind, bytes: buf.length,
    ...(meta.width ? { width: meta.width, height: meta.height } : {}),
    ...(meta.dominant_colors ? { dominant_colors: meta.dominant_colors } : {}),
    ...(meta.luminance ? { luminance: meta.luminance } : {}),
    ...(args.alt ? { alt: String(args.alt).slice(0, 300) } : {}),
    added: new Date().toISOString().split('T')[0],
  };
  writeManifestEntry(args.projectDir, entry);
  return { entry, warnings };
}

// ── MCP ToolResult wrappers (manage_design ops) ───────────────
function requireProject(op: string, projectPath?: string): { dir: string } | ToolResult {
  if (!projectPath) return errResult(op, 'project_path is required', 'Pass the project bare name or path.');
  const dir = resolveProjectPath(projectPath);
  if (!fs.existsSync(dir)) return errResult(op, `Project not found: ${projectPath}`, 'create_project first, or manage_design {op:"browse"} to find the right name.');
  return { dir };
}
const isErr = (r: { dir: string } | ToolResult): r is ToolResult => 'success' in r;

export function assetAdd(args: { project_path?: string; name?: string; data?: string; source_path?: string; kind?: string; alt?: string }): ToolResult {
  const op = 'asset_add';
  const proj = requireProject(op, args.project_path);
  if (isErr(proj)) return proj;
  if (!args.name) return errResult(op, 'name is required', 'Pass a filename with extension, e.g. name:"team.jpg".');
  const progress: ProgressItem[] = [];
  try {
    const { entry, warnings } = ingestAsset({
      projectDir: proj.dir, name: args.name,
      dataUri: args.data, sourcePath: args.source_path, kind: args.kind, alt: args.alt,
    });
    progress.push(pOk('Asset saved', `${entry.path} (${Math.round(entry.bytes / 1024)} KiB${entry.width ? `, ${entry.width}×${entry.height}` : ''})`));
    for (const w of warnings) progress.push(pWarn('Note', w));

    // Baton: a ready-to-place image layer at the asset's native aspect.
    const w = entry.width ?? 600, h = entry.height ?? 400;
    const scale = Math.min(1, 600 / Math.max(w, h));
    const stub = { id: entry.id, type: 'image', z: 21, pos: [120, 120, Math.round(w * scale), Math.round(h * scale)], src: entry.path, fit: 'cover' };
    const next_action: NextAction = {
      tool: 'add_layers',
      params: { design_path: '<your .design.yaml>', layers_shorthand: [stub] },
      remaining: 0,
      hint: `Asset stored. Place it with add_layers using src:"${entry.path}" (native ${w}×${h}${entry.luminance ? `, reads ${entry.luminance}` : ''}${entry.luminance === 'busy' ? ' — put a scrim behind any text over it' : ''}). manage_design {op:"asset_list"} shows everything available.`,
    };
    const context = buildContext(op, `Added asset ${entry.path}`, [{ type: 'export', path: path.join(proj.dir, entry.path), role: 'created' }]);
    const handover = buildHandover('COMPOSE', { project_path: proj.dir });
    return okResult(op, { asset: entry, layer_stub: stub, next_action, progress, context, handover });
  } catch (e) {
    if (e instanceof AssetError) return errResult(op, e.message, e.hint, progress);
    return errResult(op, `Asset ingest failed: ${(e as Error).message}`, 'Check the data: URI / source_path and retry.', progress);
  }
}

export function assetList(args: { project_path?: string; search?: string; kind?: string; limit?: number }): ToolResult {
  const op = 'asset_list';
  const proj = requireProject(op, args.project_path);
  if (isErr(proj)) return proj;
  const manifest = readAssetManifest(proj.dir);

  // Files are the truth: pick up anything on disk the manifest doesn't know
  // (hand-copied, HTTP-uploaded before manifest support, …) with cheap meta.
  const byPath = new Map<string, AssetEntry>();
  for (const k of KINDS) for (const e of manifest[k] ?? []) byPath.set(e.path, e);
  for (const k of KINDS) {
    const dir = path.join(proj.dir, 'assets', k);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const rel = `assets/${k}/${f}`;
      const clean = sanitizeAssetName(f);
      if (!clean || byPath.has(rel)) continue;
      const abs = path.join(dir, f);
      if (!fs.statSync(abs).isFile()) continue;
      const buf = fs.readFileSync(abs);
      const meta = extractAssetMeta(buf, clean.ext);
      byPath.set(rel, {
        id: clean.name.replace(/\.[a-z0-9]+$/, ''), path: rel, kind: k, bytes: buf.length,
        ...(meta.width ? { width: meta.width, height: meta.height } : {}),
        ...(meta.dominant_colors ? { dominant_colors: meta.dominant_colors } : {}),
        ...(meta.luminance ? { luminance: meta.luminance } : {}),
        added: fs.statSync(abs).mtime.toISOString().split('T')[0],
      });
    }
  }

  let rows = [...byPath.values()];
  if (args.kind && KINDS.includes(args.kind as AssetKind)) rows = rows.filter(r => r.kind === args.kind);
  if (args.search) {
    const q = args.search.toLowerCase();
    rows = rows.filter(r => r.path.toLowerCase().includes(q) || (r.alt ?? '').toLowerCase().includes(q));
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  const limit = Math.min(Math.max(1, args.limit ?? 40), 200);
  const truncated = rows.length > limit;
  rows = rows.slice(0, limit);

  const progress = [pOk('Assets listed', `${rows.length}${truncated ? '+' : ''} asset(s)`)];
  const hint = rows.length
    ? `Place one with add_layers: {type:"image", src:"<path>", pos:[x,y,w,h], fit:"cover"}. Sizes/colors above are per-asset — respect native aspect (width/height) and add a scrim behind text on "busy" images.`
    : 'No assets yet — add one with manage_design {op:"asset_add", name, data:"data:image/…;base64,…"} or upload via the editor.';
  const context = buildContext(op, `${rows.length} asset(s) in ${path.basename(proj.dir)}`);
  const handover = buildHandover('COMPOSE', { project_path: proj.dir });
  return okResult(op, { assets: rows, truncated, hint, progress, context, handover });
}

export function assetDelete(args: { project_path?: string; asset_path?: string }): ToolResult {
  const op = 'asset_delete';
  const proj = requireProject(op, args.project_path);
  if (isErr(proj)) return proj;
  const rel = String(args.asset_path ?? '').replace(/^\/+/, '');
  if (!/^assets\/(images|icons|fonts)\/[^/]+$/.test(rel)) {
    return errResult(op, `asset_path must look like "assets/images/<file>"`, 'manage_design {op:"asset_list"} shows the exact paths.');
  }
  const abs = path.join(proj.dir, rel);
  if (!fs.existsSync(abs)) return errResult(op, `Asset not found: ${rel}`, 'manage_design {op:"asset_list"} shows what exists.');

  const trashDir = path.join(proj.dir, '.trash');
  fs.mkdirSync(trashDir, { recursive: true });
  const dest = path.join(trashDir, `${Date.now()}_${path.basename(rel)}`);
  fs.renameSync(abs, dest);
  removeManifestEntry(proj.dir, rel);

  const progress = [pOk('Asset moved to .trash', rel), pInfo('Recoverable', dest)];
  const context = buildContext(op, `Deleted ${rel} (soft)`);
  const handover = buildHandover('COMPOSE', { project_path: proj.dir });
  return okResult(op, { deleted: rel, trash_path: dest, note: 'Designs referencing this src will show a placeholder frame until you update or restore it.', progress, context, handover });
}
