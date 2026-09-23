// Footage to search for and fetch — the clip half of asset_search / asset_fetch.
//
// Two open sources that need no key:
//   Wikimedia Commons — per-file licences (CC0, CC BY, CC BY-SA…), recorded as
//     provenance like any Commons image. Originals are often Ogg Theora, which
//     is not a stored clip type; Commons already transcodes every video to VP9
//     WebM, so the fetch takes the largest of those at or under 720p.
//   NASA Image and Video Library — NASA media is generally not copyrighted
//     (third-party material in a video is the exception, noted). The fetch takes
//     the smallest MP4 rendition: NASA videos run long and heavy.

import type { AssetCandidate } from './asset-search';
import { slugify, type ResolvedAsset } from './asset-fetch';
import { httpJSON, NetError } from './asset-net';

interface WMVideoInfo {
  url?: string; mime?: string; size?: number; width?: number; height?: number; duration?: number;
  descriptionurl?: string; thumburl?: string;
  derivatives?: Array<{ src?: string; type?: string; width?: number; height?: number }>;
  extmetadata?: Record<string, { value?: unknown }>;
}

const text = (v: unknown): string => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
const WM_API = 'https://commons.wikimedia.org/w/api.php';

/** The VP9 WebM rendition to store: the tallest at or under 720 lines. */
export function pickWebm(derivatives: WMVideoInfo['derivatives']): { src: string; width?: number; height?: number } | null {
  const webm = (derivatives ?? []).filter(d => d.src && /video\/webm/.test(d.type ?? '') && (d.height ?? 0) > 0 && (d.height ?? 0) <= 720);
  webm.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const best = webm[0];
  return best?.src ? { src: best.src, ...(best.width ? { width: best.width } : {}), ...(best.height ? { height: best.height } : {}) } : null;
}

export async function searchWikimediaVideo(query: string, limit: number): Promise<AssetCandidate[]> {
  const qs = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: `filetype:video ${query}`,
    gsrnamespace: '6', gsrlimit: String(Math.min(24, limit * 2)),
    prop: 'videoinfo', viprop: 'url|size|mime|derivatives|extmetadata', viextmetadatafilter: 'LicenseShortName|Artist',
  });
  const data = await httpJSON<{ query?: { pages?: Record<string, { title?: string; videoinfo?: WMVideoInfo[] }> } }>(`${WM_API}?${qs}`);
  const rows = Object.values(data.query?.pages ?? {}).flatMap(p => {
    const info = p.videoinfo?.[0];
    const title = String(p.title ?? '').replace(/^File:/i, '');
    if (!info || !title || !pickWebm(info.derivatives)) return [];
    const license = text(info.extmetadata?.['LicenseShortName']?.value) || 'see file page';
    const artist = text(info.extmetadata?.['Artist']?.value);
    const name = title.replace(/\.[a-z0-9]+$/i, '').slice(0, 120);
    const c: AssetCandidate = { ref: `wikimedia-video:${title}`, source: 'wikimedia', kind: 'video', title: name, filetype: 'webm', license };
    if (info.duration) c.duration_ms = Math.round(info.duration * 1000);
    if (info.width) { c.width = info.width; c.height = info.height; }
    if (artist) { c.creator = artist; c.attribution = `${name} by ${artist} (${license}), via Wikimedia Commons`; }
    if (info.descriptionurl) c.page = info.descriptionurl;
    return [c];
  });
  // Short clips first — footage for a layer, not a documentary.
  return rows.sort((a, b) => (a.duration_ms ?? Infinity) - (b.duration_ms ?? Infinity)).slice(0, limit);
}

export async function resolveWikimediaVideo(title: string): Promise<ResolvedAsset> {
  const file = title.replace(/^File:/i, '');
  const qs = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', titles: `File:${file}`,
    prop: 'videoinfo', viprop: 'url|mime|derivatives|extmetadata', viextmetadatafilter: 'LicenseShortName|Artist',
  });
  const data = await httpJSON<{ query?: { pages?: Record<string, { videoinfo?: WMVideoInfo[] }> } }>(`${WM_API}?${qs}`);
  const info = Object.values(data.query?.pages ?? {})[0]?.videoinfo?.[0];
  const pick = pickWebm(info?.derivatives);
  if (!info || !pick) throw new NetError(`Wikimedia Commons has no playable rendition of "${file}"`, 'Re-run asset_search with what:"clip" and pick another result.');
  const license = text(info.extmetadata?.['LicenseShortName']?.value) || 'see file page';
  const artist = text(info.extmetadata?.['Artist']?.value);
  const base = file.replace(/\.[a-z0-9]+$/i, '');
  const r: ResolvedAsset = { url: pick.src, kind: 'video', ext: 'webm', suggestedName: slugify(base, 'commons-clip'), license, title: base };
  if (pick.width) { r.width = pick.width; r.height = pick.height; }
  if (artist) { r.creator = artist; r.attribution = `${base} by ${artist} (${license}), via Wikimedia Commons`; }
  if (info.descriptionurl) r.page = info.descriptionurl;
  return r;
}

// ── NASA Image and Video Library ─────────────────────────────
interface NasaItem { data?: Array<{ nasa_id?: string; title?: string; center?: string; description?: string; date_created?: string }> }

const NASA = 'https://images-api.nasa.gov';
const NASA_LICENSE = 'NASA media (not copyrighted unless noted)';

export async function searchNasaVideo(query: string, limit: number): Promise<AssetCandidate[]> {
  const qs = new URLSearchParams({ q: query, media_type: 'video', page_size: String(Math.min(24, limit)) });
  const data = await httpJSON<{ collection?: { items?: NasaItem[] } }>(`${NASA}/search?${qs}`);
  return (data.collection?.items ?? []).flatMap(it => {
    const d = it.data?.[0];
    if (!d?.nasa_id) return [];
    const c: AssetCandidate = {
      ref: `nasa-video:${d.nasa_id}`, source: 'nasa', kind: 'video', title: text(d.title).slice(0, 120) || d.nasa_id,
      filetype: 'mp4', license: NASA_LICENSE, creator: `NASA${d.center ? ` ${d.center}` : ''}`,
      page: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`,
      note: 'Length is known once fetched; NASA videos often run minutes — trim with animation(op:video).',
    };
    return [c];
  }).slice(0, limit);
}

/** The smallest MP4 rendition NASA lists — mobile, then small, then preview, then medium. */
export function pickNasaMp4(hrefs: string[]): string | null {
  for (const tag of ['~mobile.mp4', '~small.mp4', '~preview.mp4', '~medium.mp4']) {
    const hit = hrefs.find(h => h.endsWith(tag));
    if (hit) return hit.replace(/^http:/, 'https:');
  }
  return null;
}

export async function resolveNasaVideo(id: string): Promise<ResolvedAsset> {
  const data = await httpJSON<{ collection?: { items?: Array<{ href?: string }> } }>(`${NASA}/asset/${encodeURIComponent(id)}`);
  const url = pickNasaMp4((data.collection?.items ?? []).map(i => String(i.href ?? '')));
  if (!url) throw new NetError(`NASA lists no MP4 for "${id}"`, 'Pick another result from asset_search what:"clip".');
  return {
    url, kind: 'video', ext: 'mp4', suggestedName: slugify(id, 'nasa-clip'), license: NASA_LICENSE, creator: 'NASA', title: id,
    page: `https://images.nasa.gov/details/${encodeURIComponent(id)}`,
    attribution: `${id} — NASA (images.nasa.gov)`,
  };
}
