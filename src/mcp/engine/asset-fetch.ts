// Asset finder, second half: turn a search `ref` into a file in the project.
//
// Fetching is deliberately ref-first. The provider API is asked where the file
// actually lives and under what licence, so provenance is recorded from the
// source rather than from whatever the model believed. A raw `url:` is still
// allowed, but only against the host allowlist — that is the lever that keeps
// a project sourcing screenshots from one vendor's site and nowhere else.
import * as fs from 'fs';
import * as path from 'path';
import { httpJSON, httpBytes, NetError, defaultFetchHosts } from './asset-net';
import { readYAML, okResult, errResult, buildContext, buildHandover, pOk, pInfo, pWarn } from './utils';
import { ovLicenseLabel, wmText } from './asset-search';
import {
  ingestAsset, requireProject, isErr, extForMime, maxAssetBytes, AssetError,
  type AssetProvenance, type IngestArgs,
} from './assets';
import type { ToolResult, NextAction, ProgressItem } from '../types';

const pathJoin = path.join;

export interface ResolvedAsset {
  url: string;                 // direct file URL to download
  suggestedName: string;       // slug, no extension
  ext?: string;                // when the provider is authoritative about it
  kind?: 'images' | 'icons' | 'fonts';
  license?: string;
  attribution?: string;
  creator?: string;
  page?: string;
  title?: string;
  width?: number;
  height?: number;
}

export function slugify(s: string, fallback: string): string {
  const out = String(s ?? '').toLowerCase().normalize('NFKD')
    .replace(/[^\w\s-]+/g, '').trim().replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return out || fallback;
}

// ── Per-provider resolution ──────────────────────────────────
interface OVDetail {
  url?: string; title?: string; creator?: string; license?: string; license_version?: string;
  attribution?: string; foreign_landing_url?: string; filetype?: string; width?: number; height?: number;
}

async function resolveOpenverse(id: string): Promise<ResolvedAsset> {
  const d = await httpJSON<OVDetail>(`https://api.openverse.org/v1/images/${encodeURIComponent(id)}/`);
  if (!d.url) throw new NetError(`Openverse has no file URL for ${id}`, 'Re-run asset_search — the id may be stale.');
  const r: ResolvedAsset = {
    url: d.url, kind: 'images',
    suggestedName: slugify(d.title ?? '', `openverse-${id.slice(0, 8)}`),
    license: ovLicenseLabel(d.license, d.license_version),
  };
  if (d.filetype) r.ext = d.filetype.toLowerCase();
  if (d.title) r.title = d.title;
  if (d.creator) r.creator = d.creator;
  if (d.attribution) r.attribution = d.attribution;
  if (d.foreign_landing_url) r.page = d.foreign_landing_url;
  if (d.width) { r.width = d.width; r.height = d.height; }
  return r;
}

interface WMInfo {
  url?: string; descriptionurl?: string; width?: number; height?: number; mime?: string;
  size?: number; thumburl?: string; thumbwidth?: number; thumbheight?: number;
  extmetadata?: Record<string, { value?: unknown }>;
}

/** Commons originals run to tens of MB; past this we take the server's render. */
const WM_ORIGINAL_MAX = 4 * 1024 * 1024;

async function resolveWikimedia(title: string): Promise<ResolvedAsset> {
  const file = title.replace(/^File:/i, '');
  const qs = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', titles: `File:${file}`,
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '2000',
  });
  const data = await httpJSON<{ query?: { pages?: Record<string, { imageinfo?: WMInfo[] }> } }>(`https://commons.wikimedia.org/w/api.php?${qs}`);
  const info = Object.values(data.query?.pages ?? {})[0]?.imageinfo?.[0];
  if (!info?.url) throw new NetError(`Wikimedia Commons has no file named "${file}"`, 'Re-run asset_search to get an exact File: title.');
  const meta = info.extmetadata ?? {};
  const license = wmText(meta['LicenseShortName']?.value) || 'see file page';
  const artist = wmText(meta['Artist']?.value);
  const base = file.replace(/\.[a-z0-9]+$/i, '');
  // A 30 MB museum scan is not a design asset. When the original is oversized
  // (or is an SVG map that our raster path would rather have flattened), take
  // the 2000px render Commons already produced.
  const huge = (info.size ?? 0) > WM_ORIGINAL_MAX;
  const useThumb = Boolean(info.thumburl) && huge;
  const r: ResolvedAsset = {
    url: useThumb ? String(info.thumburl) : info.url, kind: 'images',
    suggestedName: slugify(base, 'commons-image'),
    license, title: base,
  };
  if (info.mime) r.ext = info.mime.split('/')[1]?.replace('jpeg', 'jpg');
  if (useThumb) {
    // The render is a different format from the original for SVG/TIFF sources.
    const fromUrl = String(info.thumburl).split('?')[0]?.match(/\.([a-z0-9]+)$/i)?.[1];
    if (fromUrl) r.ext = fromUrl.toLowerCase().replace('jpeg', 'jpg');
  }
  if (artist) { r.creator = artist; r.attribution = `${base} by ${artist} (${license}), via Wikimedia Commons`; }
  if (info.descriptionurl) r.page = info.descriptionurl;
  const w = useThumb ? info.thumbwidth : info.width;
  const h = useThumb ? info.thumbheight : info.height;
  if (w) { r.width = w; r.height = h; }
  return r;
}

interface IconifyCollections { [prefix: string]: { name?: string; author?: { name?: string }; license?: { title?: string; spdx?: string } } }

async function resolveIconify(id: string, px: number): Promise<ResolvedAsset> {
  const [prefix, name] = id.split(':');
  if (!prefix || !name) throw new NetError(`Malformed icon ref "${id}"`, 'Use the ref from asset_search, e.g. "iconify:mdi:cloud".');
  let license = 'open source';
  let creator: string | undefined;
  let setName: string | undefined;
  try {
    const cols = await httpJSON<IconifyCollections>(`https://api.iconify.design/collections?prefix=${encodeURIComponent(prefix)}`);
    const col = cols[prefix];
    license = col?.license?.spdx ?? col?.license?.title ?? license;
    creator = col?.author?.name;
    setName = col?.name;
  } catch { /* licence lookup is best-effort; the icon itself is still open */ }
  const r: ResolvedAsset = {
    url: `https://api.iconify.design/${prefix}/${name}.svg?height=${Math.round(px)}`,
    kind: 'icons', ext: 'svg',
    suggestedName: slugify(`${prefix}-${name}`, 'icon'),
    license, title: name.replace(/-/g, ' '),
    page: `https://icon-sets.iconify.design/${prefix}/${name}/`,
  };
  if (creator) {
    r.creator = creator;
    r.attribution = `${name} icon from ${setName ?? prefix} by ${creator} (${license})`;
  }
  return r;
}

interface FSDetail { id?: string; family?: string; license?: string; weights?: number[]; defSubset?: string; category?: string }

async function resolveFont(id: string, weight?: number): Promise<ResolvedAsset> {
  const d = await httpJSON<FSDetail>(`https://api.fontsource.org/v1/fonts/${encodeURIComponent(id)}`);
  if (!d.family) throw new NetError(`No open font with id "${id}"`, 'Run asset_search {what:"font"} for exact ids.');
  const weights = d.weights ?? [400];
  const want = weight && weights.includes(weight) ? weight
    : weights.includes(400) ? 400 : (weights[0] ?? 400);
  const subset = d.defSubset ?? 'latin';
  return {
    url: `https://cdn.jsdelivr.net/fontsource/fonts/${encodeURIComponent(id)}@latest/${subset}-${want}-normal.ttf`,
    kind: 'fonts', ext: 'ttf',
    suggestedName: slugify(`${d.family}-${want}`, 'font'),
    license: d.license ?? 'open source',
    title: `${d.family} ${want}`,
    page: `https://fontsource.org/fonts/${id}`,
    attribution: `${d.family} (${d.license ?? 'open source'})`,
  };
}

/** Project-level narrowing: asset_sources.allow_hosts in project.yaml. */
export function projectAllowHosts(projectDir: string): string[] | null {
  const file = path.join(projectDir, 'project.yaml');
  if (!fs.existsSync(file)) return null;
  try {
    const y = readYAML<{ asset_sources?: { allow_hosts?: unknown } }>(file);
    const raw = y.asset_sources?.allow_hosts;
    if (!Array.isArray(raw)) return null;
    const hosts = raw.map(h => String(h).trim().toLowerCase()).filter(Boolean);
    return hosts.length ? hosts : null;
  } catch { return null; }
}

/**
 * ref → everything needed to download and credit the file.
 *
 * `url:` is the only form that bypasses a provider, so it is the only one held
 * to the allowlist; the rest were vouched for by an API we chose to trust.
 */
export async function resolveRef(ref: string, opts: { projectDir: string; icon_px?: number; weight?: number })
  : Promise<{ resolved: ResolvedAsset; allow?: string[] }> {
  const raw = String(ref ?? '').trim();
  const cut = raw.indexOf(':');
  const scheme = cut > 0 ? raw.slice(0, cut) : '';
  const rest = cut > 0 ? raw.slice(cut + 1) : '';
  if (!rest) throw new NetError(`Malformed ref "${raw}"`, 'Use a ref from asset_search, or url:"https://…".');
  switch (scheme) {
    case 'openverse': return { resolved: await resolveOpenverse(rest) };
    case 'wikimedia': return { resolved: await resolveWikimedia(rest) };
    case 'iconify':   return { resolved: await resolveIconify(rest, opts.icon_px ?? 512) };
    case 'font':      return { resolved: await resolveFont(rest, opts.weight) };
    case 'https': {
      const allow = projectAllowHosts(opts.projectDir) ?? defaultFetchHosts();
      const url = new URL(raw);
      return {
        resolved: {
          url: raw, suggestedName: slugify(path.basename(url.pathname).replace(/\.[a-z0-9]+$/i, ''), 'download'),
          page: raw, license: 'unverified — you are responsible for the rights',
        },
        allow,
      };
    }
    case 'http':
      throw new NetError('Plain http:// is refused — the response could be tampered with in transit', `Use the https:// form of ${raw}.`);
    default:
      throw new NetError(`Unknown ref scheme "${scheme}"`, 'Refs look like openverse:<id>, wikimedia:<File title>, iconify:<set>:<name>, font:<id>, or a plain https:// URL.');
  }
}

// ── MCP op ───────────────────────────────────────────────────
/**
 * manage_design {op:"asset_fetch"} — download a search result into the project.
 *
 * The file lands through the same ingest path as an upload (size cap, quota,
 * snapshot-on-replace, metadata extraction), plus a provenance record. From
 * here on it is an ordinary local asset: designs reference the local path, and
 * nothing is fetched again at render time.
 */
export async function assetFetch(args: {
  project_path?: string; ref?: string; url?: string; name?: string;
  folder?: string; alt?: string; kind?: string; icon_px?: number; weight?: number;
}): Promise<ToolResult> {
  const op = 'asset_fetch';
  const proj = requireProject(op, args.project_path);
  if (isErr(proj)) return proj;
  const ref = String(args.ref ?? args.url ?? '').trim();
  if (!ref) return errResult(op, 'ref is required', 'Run op:"asset_search" first and pass a result\'s ref, or pass a direct https:// URL.');

  const progress: ProgressItem[] = [];
  try {
    const opts: { projectDir: string; icon_px?: number; weight?: number } = { projectDir: proj.dir };
    if (args.icon_px !== undefined) opts.icon_px = args.icon_px;
    if (args.weight !== undefined) opts.weight = args.weight;
    const { resolved, allow } = await resolveRef(ref, opts);
    progress.push(pInfo('Source resolved', `${resolved.title ?? resolved.suggestedName} — ${resolved.license ?? 'licence unknown'}`));

    const got = await httpBytes(resolved.url, maxAssetBytes(), allow);
    // The wire's content-type outranks the provider's guess and the URL's
    // extension: it is the only one describing the bytes we actually hold.
    const ext = extForMime(got.contentType) ?? resolved.ext
      ?? new URL(got.finalUrl).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (!ext) {
      return errResult(op, `Could not tell what kind of file ${got.finalUrl} is (content-type: ${got.contentType || 'none'})`,
        'Pass name:"something.png" to declare the type, or pick a different result.', progress);
    }
    const name = args.name ?? `${resolved.suggestedName}.${ext}`;
    const provenance: AssetProvenance = {
      source: ref.split(':')[0] ?? 'url',
      url: got.finalUrl,
      ...(resolved.page ? { page: resolved.page } : {}),
      ...(resolved.license ? { license: resolved.license } : {}),
      ...(resolved.attribution ? { attribution: resolved.attribution } : {}),
      ...(resolved.creator ? { creator: resolved.creator } : {}),
      fetched: new Date().toISOString().split('T')[0] ?? '',
    };

    const ingestArgs: IngestArgs = {
      projectDir: proj.dir, name, data: got.buffer, provenance,
      alt: args.alt ?? resolved.title ?? '',
    };
    if (args.kind) ingestArgs.kind = args.kind;
    if (args.folder) ingestArgs.folder = args.folder;
    if (!args.kind && resolved.kind === 'icons') ingestArgs.kind = 'icons';
    const { entry, warnings } = ingestAsset(ingestArgs);

    progress.push(pOk('Fetched', `${entry.path} (${Math.round(entry.bytes / 1024)} KiB${entry.width ? `, ${entry.width}×${entry.height}` : ''})`));
    for (const w of warnings) progress.push(pWarn('Note', w));
    if (!args.alt) progress.push(pWarn('No alt given', 'The stored alt is the provider\'s title — replace it with what the image actually shows.'));
    if (provenance.attribution) progress.push(pInfo('Credit required', provenance.attribution));

    const w = entry.width ?? 600, h = entry.height ?? 400;
    const scale = Math.min(1, 600 / Math.max(w, h));
    const stub = entry.kind === 'fonts'
      ? { note: `Font stored at ${entry.path}. Use it via the design's type settings / font_family.` }
      : { id: entry.id, type: 'image', z: 21, pos: [120, 120, Math.round(w * scale), Math.round(h * scale)], src: entry.path, fit: 'cover' };
    const next_action: NextAction = {
      tool: 'add_layers',
      params: { design_path: '<your .design.yaml>', layers_shorthand: [stub] },
      remaining: 0,
      hint: `Stored locally — the design references "${entry.path}", nothing is fetched at render time.${provenance.attribution ? ` This licence REQUIRES the credit line: "${provenance.attribution}" — typeset it on the design (small, low-contrast, but present).` : ''}`,
    };
    const context = buildContext(op, `Fetched ${entry.path} from ${provenance.source}`, [{ type: 'export', path: pathJoin(proj.dir, entry.path), role: 'created' }]);
    const handover = buildHandover('COMPOSE', { project_path: proj.dir });
    return okResult(op, {
      asset: entry, provenance, layer_stub: stub, next_action,
      ...(provenance.attribution ? { attribution_required: provenance.attribution } : {}),
      progress, context, handover,
    });
  } catch (e) {
    if (e instanceof NetError) return errResult(op, e.message, e.hint, progress);
    if (e instanceof AssetError) return errResult(op, e.message, e.hint, progress);
    return errResult(op, `Fetch failed: ${(e as Error).message}`, 'Re-run op:"asset_search" for a fresh ref, or upload the file with op:"asset_add".', progress);
  }
}
