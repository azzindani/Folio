// Asset finder — search free, openly-licensed sources for photos, icons and
// fonts, without an API key anywhere.
//
//   openverse  → CC/PD photography + illustration (aggregates Flickr, museums…)
//   wikimedia  → Commons: documentary photos, diagrams, historic + PD material
//   iconify    → 200k+ icons across 150 open sets, incl. brand marks
//   fontsource → the Google Fonts / open-source font catalogue
//
// Nothing is downloaded here. Search returns CANDIDATES carrying a `ref`; the
// bytes only land in a project when asset_fetch is called with that ref, and
// the licence attached to the ref is the provider's word, not the model's.
import { httpJSON, NetError, netEnabled } from './asset-net';
import type { ToolResult, NextAction } from '../types';
import { okResult, errResult, buildContext, buildHandover, pOk, pInfo, pWarn } from './utils';

export type AssetSourceId = 'openverse' | 'wikimedia' | 'iconify' | 'font';

export interface AssetCandidate {
  ref: string;                 // hand to asset_fetch
  source: AssetSourceId;
  kind: 'images' | 'icons' | 'fonts';
  title: string;
  width?: number;
  height?: number;
  filetype?: string;
  license?: string;            // human label, e.g. "CC BY-SA 2.0" / "OFL-1.1"
  attribution?: string;        // ready-to-print credit line (when required)
  creator?: string;
  page?: string;               // human landing page for provenance
  preview?: string;            // thumbnail URL (for a human, not the engine)
  note?: string;
}

const clampLimit = (n: unknown): number => Math.min(Math.max(1, Number(n) || 8), 24);

// ── Openverse ────────────────────────────────────────────────
interface OVRow {
  id?: string; title?: string; url?: string; thumbnail?: string; creator?: string;
  license?: string; license_version?: string; attribution?: string;
  foreign_landing_url?: string; width?: number; height?: number; filetype?: string;
}

/** Licence code + version → the label a designer would actually print. */
export function ovLicenseLabel(code?: string, version?: string): string {
  const c = String(code ?? '').toLowerCase();
  if (!c) return 'unknown';
  if (c === 'cc0') return 'CC0 (public domain)';
  if (c === 'pdm') return 'Public Domain Mark';
  return `CC ${c.toUpperCase().replace(/-/g, '-')}${version ? ` ${version}` : ''}`;
}

export async function searchOpenverse(query: string, limit: number, category?: string): Promise<AssetCandidate[]> {
  const qs = new URLSearchParams({
    q: query, page_size: String(limit),
    // Commercial use + modification allowed: a design is both.
    license_type: 'commercial,modification',
    mature: 'false',
  });
  if (category) qs.set('category', category);
  const data = await httpJSON<{ results?: OVRow[] }>(`https://api.openverse.org/v1/images/?${qs}`);
  return (data.results ?? []).filter(r => r.id && r.url).map(r => {
    const c: AssetCandidate = {
      ref: `openverse:${r.id}`, source: 'openverse', kind: 'images',
      title: (r.title ?? 'untitled').slice(0, 120),
      license: ovLicenseLabel(r.license, r.license_version),
    };
    if (r.width) { c.width = r.width; c.height = r.height; }
    if (r.filetype) c.filetype = r.filetype;
    if (r.creator) c.creator = r.creator;
    if (r.attribution) c.attribution = r.attribution;
    if (r.foreign_landing_url) c.page = r.foreign_landing_url;
    if (r.thumbnail) c.preview = r.thumbnail;
    return c;
  });
}

// ── Wikimedia Commons ────────────────────────────────────────
interface WMPage {
  title?: string;
  imageinfo?: {
    url?: string; descriptionurl?: string; width?: number; height?: number;
    mime?: string; size?: number; thumburl?: string;
    extmetadata?: Record<string, { value?: unknown }>;
  }[];
}

/** Commons stashes licence + author in extmetadata as HTML — flatten to text. */
export function wmText(v: unknown): string {
  return String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
}

export async function searchWikimedia(query: string, limit: number): Promise<AssetCandidate[]> {
  const qs = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'search', gsrsearch: `filetype:bitmap|drawing ${query}`,
    gsrnamespace: '6', gsrlimit: String(limit),
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '400',
  });
  const data = await httpJSON<{ query?: { pages?: Record<string, WMPage> } }>(`https://commons.wikimedia.org/w/api.php?${qs}`);
  const pages = Object.values(data.query?.pages ?? {});
  return pages.flatMap(p => {
    const info = p.imageinfo?.[0];
    const title = String(p.title ?? '');
    if (!info?.url || !title) return [];
    const meta = info.extmetadata ?? {};
    const license = wmText(meta['LicenseShortName']?.value) || wmText(meta['License']?.value) || 'see file page';
    const artist = wmText(meta['Artist']?.value);
    const c: AssetCandidate = {
      ref: `wikimedia:${title.replace(/^File:/i, '')}`, source: 'wikimedia', kind: 'images',
      title: title.replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '').slice(0, 120),
      license,
    };
    if (info.width) { c.width = info.width; c.height = info.height; }
    if (info.mime) c.filetype = info.mime.split('/')[1];
    if (artist) {
      c.creator = artist;
      c.attribution = `${c.title} by ${artist} (${license}), via Wikimedia Commons`;
    }
    if (info.descriptionurl) c.page = info.descriptionurl;
    if (info.thumburl) c.preview = info.thumburl;
    return [c];
  });
}

// ── Iconify ──────────────────────────────────────────────────
interface IconifyCollection { name?: string; author?: { name?: string }; license?: { title?: string; spdx?: string } }
interface IconifySearch { icons?: string[]; collections?: Record<string, IconifyCollection> }

export async function searchIconify(query: string, limit: number): Promise<AssetCandidate[]> {
  const qs = new URLSearchParams({ query, limit: String(Math.max(32, limit)) });
  const data = await httpJSON<IconifySearch>(`https://api.iconify.design/search?${qs}`);
  return (data.icons ?? []).slice(0, limit).flatMap(id => {
    const [prefix, name] = id.split(':');
    if (!prefix || !name) return [];
    const col = data.collections?.[prefix];
    const c: AssetCandidate = {
      ref: `iconify:${id}`, source: 'iconify', kind: 'icons',
      title: name.replace(/-/g, ' '),
      filetype: 'svg',
      license: col?.license?.spdx ?? col?.license?.title ?? 'open source',
      page: `https://icon-sets.iconify.design/${prefix}/${name}/`,
      note: col?.name ? `${col.name} set` : undefined,
    };
    if (col?.author?.name) c.creator = col.author.name;
    return [c];
  });
}

// ── Fontsource (Google Fonts + other open families) ──────────
interface FSRow { id?: string; family?: string; category?: string; weights?: number[]; styles?: string[]; license?: string; variable?: boolean; defSubset?: string }

// The full catalogue is ~500 KiB and changes rarely; one fetch per process is
// plenty and keeps substring search possible (the API only matches exactly).
let fontCache: { rows: FSRow[]; at: number } | null = null;
const FONT_TTL_MS = 60 * 60 * 1000;

export function resetFontCache(): void { fontCache = null; }

async function fontCatalogue(): Promise<FSRow[]> {
  if (fontCache && Date.now() - fontCache.at < FONT_TTL_MS) return fontCache.rows;
  const rows = await httpJSON<FSRow[]>('https://api.fontsource.org/v1/fonts');
  fontCache = { rows: Array.isArray(rows) ? rows : [], at: Date.now() };
  return fontCache.rows;
}

export async function searchFonts(query: string, limit: number): Promise<AssetCandidate[]> {
  const rows = await fontCatalogue();
  const q = query.trim().toLowerCase();
  // A category word ("serif", "monospace") is a legitimate font query too.
  const byCat = rows.filter(r => String(r.category ?? '').toLowerCase() === q);
  const byName = rows.filter(r => String(r.family ?? '').toLowerCase().includes(q));
  const seen = new Set<string>();
  const picked = [...byName, ...byCat].filter(r => r.id && !seen.has(r.id) && seen.add(r.id));
  return picked.slice(0, limit).map(r => ({
    ref: `font:${r.id}`, source: 'font' as const, kind: 'fonts' as const,
    title: r.family ?? r.id ?? '',
    filetype: 'ttf',
    license: r.license ?? 'open source',
    page: `https://fontsource.org/fonts/${r.id}`,
    note: `${r.category ?? 'sans-serif'} · weights ${(r.weights ?? [400]).join('/')}${r.variable ? ' · variable' : ''}`,
  }));
}

// ── Multiplexer ──────────────────────────────────────────────
export type SearchWhat = 'photo' | 'illustration' | 'diagram' | 'icon' | 'font' | 'logo';

const CATEGORY: Partial<Record<SearchWhat, string>> = {
  photo: 'photograph',
  illustration: 'illustration',
};

/**
 * Route a query to the providers that can actually answer it.
 *
 * Each provider is awaited independently: one being slow or rate-limited must
 * not empty the whole result set, so failures come back as notes.
 */
export async function runSearch(what: SearchWhat, query: string, limit: number)
  : Promise<{ results: AssetCandidate[]; failures: string[] }> {
  const n = clampLimit(limit);
  const jobs: { id: string; run: () => Promise<AssetCandidate[]> }[] = [];
  if (what === 'icon' || what === 'logo') {
    jobs.push({ id: 'iconify', run: () => searchIconify(query, n) });
    if (what === 'logo') jobs.push({ id: 'wikimedia', run: () => searchWikimedia(`${query} logo`, Math.ceil(n / 2)) });
  } else if (what === 'font') {
    jobs.push({ id: 'fontsource', run: () => searchFonts(query, n) });
  } else if (what === 'diagram') {
    jobs.push({ id: 'wikimedia', run: () => searchWikimedia(query, n) });
  } else {
    jobs.push({ id: 'openverse', run: () => searchOpenverse(query, n, CATEGORY[what]) });
    jobs.push({ id: 'wikimedia', run: () => searchWikimedia(query, Math.ceil(n / 2)) });
  }
  const settled = await Promise.all(jobs.map(async j => {
    try { return { id: j.id, rows: await j.run() }; }
    catch (e) {
      const msg = e instanceof NetError ? e.message : (e as Error).message;
      return { id: j.id, rows: [] as AssetCandidate[], error: msg };
    }
  }));
  const results: AssetCandidate[] = [];
  const failures: string[] = [];
  // Interleave, so a provider that returned 8 rows cannot bury one that
  // returned 2 — both viewpoints stay visible in a truncated list.
  const lists = settled.map(s => s.rows);
  for (let i = 0; i < Math.max(...lists.map(l => l.length), 0); i++) {
    for (const l of lists) if (l[i]) results.push(l[i] as AssetCandidate);
  }
  for (const s of settled) if (s.error) failures.push(`${s.id}: ${s.error}`);
  return { results: results.slice(0, n), failures };
}

// ── MCP op ───────────────────────────────────────────────────
const WHATS: SearchWhat[] = ['photo', 'illustration', 'diagram', 'icon', 'font', 'logo'];

/**
 * manage_design {op:"asset_search"} — find openly-licensed material.
 *
 * Returns candidates only. Nothing is written, nothing is downloaded, and the
 * design is untouched until asset_fetch is called with a ref.
 */
export async function assetSearch(args: { query?: string; what?: string; limit?: number; project_path?: string }): Promise<ToolResult> {
  const op = 'asset_search';
  if (!netEnabled()) {
    return errResult(op, 'Asset search is disabled on this deployment', 'FOLIO_ASSET_NET=off. Upload files with op:"asset_add" instead.');
  }
  const query = String(args.query ?? '').trim();
  if (!query) return errResult(op, 'query is required', 'Pass what you are looking for, e.g. query:"office desk overhead", what:"photo".');
  const what = (WHATS.includes(args.what as SearchWhat) ? args.what : 'photo') as SearchWhat;

  let found: { results: AssetCandidate[]; failures: string[] };
  try {
    found = await runSearch(what, query, args.limit ?? 8);
  } catch (e) {
    const msg = e instanceof NetError ? e.message : (e as Error).message;
    return errResult(op, `Search failed: ${msg}`, e instanceof NetError ? e.hint : 'Retry, or upload the asset yourself with op:"asset_add".');
  }

  const progress = [pOk('Searched', `${found.results.length} result(s) for "${query}" (${what})`)];
  for (const f of found.failures) progress.push(pWarn('Source unavailable', f));
  if (!found.results.length) {
    progress.push(pInfo('Nothing matched', 'Try fewer words, or a different `what`.'));
  }

  const first = found.results[0];
  const next_action: NextAction | undefined = first ? {
    tool: 'manage_design',
    params: {
      op: 'asset_fetch',
      project_path: args.project_path ?? '<your project>',
      ref: first.ref,
      alt: '<describe what the image shows>',
    },
    remaining: 0,
    hint: `Pick a ref and fetch it. Fetching stores the file AND its licence; asset_list then reports any credit line you must typeset.`,
  } : undefined;

  const context = buildContext(op, `asset_search "${query}" → ${found.results.length}`);
  const handover = buildHandover('COMPOSE', args.project_path ? { project_path: args.project_path } : {});
  return okResult(op, {
    query, what, results: found.results,
    ...(found.failures.length ? { unavailable: found.failures } : {}),
    licensing: 'Every result here allows commercial use and modification, but many require a CREDIT LINE. attribution is the exact text; it must appear on the design.',
    hint: found.results.length
      ? 'These are candidates, not files. Fetch one with op:"asset_fetch" + its ref. width/height are the native pixels — size the layer to that aspect.'
      : 'No matches. Openverse/Commons index real photographs — for an abstract idea, search the concrete object instead ("stack of paper" not "bureaucracy").',
    ...(next_action ? { next_action } : {}),
    progress, context, handover,
  });
}
