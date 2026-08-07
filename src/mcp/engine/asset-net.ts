// Guarded outbound HTTP for the asset finder.
//
// This is the ONLY place in the engine that reaches the internet, so every
// safety rule lives here rather than being re-argued per provider:
//   • https only — no http, no file:, no data:
//   • no private / loopback / link-local hosts (SSRF)
//   • redirects followed by hand, re-checking every hop
//   • a hard byte cap enforced while streaming, not just on content-length
//   • an allowlist for operator-supplied URLs
//
// Search + download hosts are separate lists on purpose. Search talks to four
// known APIs. Downloads go wherever those APIs point (Openverse aggregates
// dozens of provider CDNs), which is safe precisely because a provider we
// trust named the URL — an operator-supplied `url:` is held to the allowlist.
import * as dns from 'dns';

export class NetError extends Error {
  constructor(message: string, public hint: string) { super(message); }
}

/** Kill switch for locked-down deployments: FOLIO_ASSET_NET=off. */
export function netEnabled(): boolean {
  return String(process.env['FOLIO_ASSET_NET'] ?? '').toLowerCase() !== 'off';
}
export function fetchTimeoutMs(): number {
  return parseInt(process.env['FOLIO_ASSET_NET_TIMEOUT'] ?? '', 10) || 15000;
}

/** Hosts the search providers themselves live on. Not operator-configurable. */
export const SEARCH_HOSTS = [
  'api.openverse.org',
  'commons.wikimedia.org',
  'api.iconify.design',
  'api.fontsource.org',
];

/**
 * Hosts a plain `url:` fetch may target.
 *
 * Default is the CDNs our own providers hand back, so a hand-copied result URL
 * still works. FOLIO_ASSET_FETCH_HOSTS extends it; a project may narrow it
 * further (see allowHosts) — that is how "screenshots from Microsoft only"
 * is enforced rather than merely intended.
 */
export function defaultFetchHosts(): string[] {
  const extra = String(process.env['FOLIO_ASSET_FETCH_HOSTS'] ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return [...SEARCH_HOSTS, 'upload.wikimedia.org', 'live.staticflickr.com',
    'cdn.jsdelivr.net', 'fonts.gstatic.com', ...extra];
}

/** Suffix match: "microsoft.com" allows learn.microsoft.com, not evilmicrosoft.com. */
export function hostAllowed(host: string, allow: string[]): boolean {
  const h = host.toLowerCase();
  return allow.some(a => {
    const p = a.replace(/^\*\./, '').toLowerCase();
    return h === p || h.endsWith(`.${p}`);
  });
}

const PRIVATE_V4 = [
  /^127\./, /^10\./, /^169\.254\./, /^192\.168\./, /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/** True for anything that could reach the host's own network. */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, '');
  if (a === 'localhost' || a.endsWith('.localhost') || a.endsWith('.local') || a.endsWith('.internal')) return true;
  if (a === '::1' || a === '::' || a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd')) return true;
  if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7));
  return PRIVATE_V4.some(re => re.test(a));
}

/** Syntactic gate. Cheap, runs on every hop before any socket is opened. */
export function checkUrl(raw: string, allow?: string[]): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new NetError(`Not a valid URL: ${raw}`, 'Pass an absolute https:// URL.'); }
  if (u.protocol !== 'https:') throw new NetError(`Only https is allowed (got ${u.protocol}//)`, 'Use the https URL for this resource.');
  if (isPrivateAddress(u.hostname)) throw new NetError(`Refused: ${u.hostname} is a private/loopback address`, 'The asset finder only reaches public hosts.');
  if (allow && !hostAllowed(u.hostname, allow)) {
    throw new NetError(`Host not allowed: ${u.hostname}`, `Allowed: ${allow.join(', ')}. Set FOLIO_ASSET_FETCH_HOSTS, or add allow_hosts to the project's asset_sources policy.`);
  }
  return u;
}

/** DNS gate — catches a public name that resolves into the private range. */
async function checkResolves(host: string): Promise<void> {
  if (/^[\d.]+$/.test(host) || host.includes(':')) return;  // literal, already checked
  try {
    const addrs = await dns.promises.lookup(host, { all: true });
    for (const a of addrs) {
      if (isPrivateAddress(a.address)) {
        throw new NetError(`Refused: ${host} resolves to a private address (${a.address})`, 'The asset finder only reaches public hosts.');
      }
    }
  } catch (e) {
    if (e instanceof NetError) throw e;
    // Resolution failure is left to fetch() to report with a better message.
  }
}

const UA = 'Folio/0.1 (design engine; +https://folio.casava.space)';
const MAX_HOPS = 4;

interface HopResult { res: Response; url: URL }

/** Follow redirects by hand so every hop is re-gated. */
async function hop(start: URL, allow: string[] | undefined, accept: string): Promise<HopResult> {
  let url = start;
  for (let i = 0; i < MAX_HOPS; i++) {
    await checkResolves(url.hostname);
    const res = await fetch(url.toString(), {
      redirect: 'manual', headers: { 'user-agent': UA, accept },
      signal: AbortSignal.timeout(fetchTimeoutMs()),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new NetError(`Redirect with no Location from ${url.hostname}`, 'The provider returned a malformed redirect; try another result.');
      url = checkUrl(new URL(loc, url).toString(), allow);
      continue;
    }
    return { res, url };
  }
  throw new NetError(`Too many redirects from ${start.hostname}`, 'Try another result, or fetch the file URL directly.');
}

export async function httpJSON<T>(raw: string): Promise<T> {
  if (!netEnabled()) throw new NetError('Asset network access is disabled', 'FOLIO_ASSET_NET=off on this deployment. Upload assets with asset_add instead.');
  const url = checkUrl(raw, SEARCH_HOSTS);
  const { res } = await hop(url, SEARCH_HOSTS, 'application/json');
  if (!res.ok) throw new NetError(`${url.hostname} returned HTTP ${res.status}`, res.status === 429 ? 'Rate limited — wait a few seconds and retry.' : 'Try a different query or source.');
  return await res.json() as T;
}

export interface BytesResult { buffer: Buffer; contentType: string; finalUrl: string }

/** Download with a streaming byte cap — content-length is a hint, not a promise. */
export async function httpBytes(raw: string, maxBytes: number, allow?: string[]): Promise<BytesResult> {
  if (!netEnabled()) throw new NetError('Asset network access is disabled', 'FOLIO_ASSET_NET=off on this deployment. Upload assets with asset_add instead.');
  const url = checkUrl(raw, allow);
  const { res, url: finalUrl } = await hop(url, allow, '*/*');
  if (!res.ok) throw new NetError(`${finalUrl.hostname} returned HTTP ${res.status}`, 'The file may have moved — re-run the search for a fresh URL.');

  const declared = parseInt(res.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new NetError(`File is ${Math.round(declared / 1024)} KiB, over the ${Math.round(maxBytes / 1024)} KiB cap`, 'Pick a smaller result, or pass max_px to downscale on the way in.');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const body = res.body;
  if (!body) throw new NetError('Empty response body', 'Try another result.');
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) throw new NetError(`Download exceeded the ${Math.round(maxBytes / 1024)} KiB cap`, 'Pick a smaller result, or pass max_px to downscale on the way in.');
    chunks.push(Buffer.from(chunk));
  }
  return {
    buffer: Buffer.concat(chunks),
    contentType: (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '',
    finalUrl: finalUrl.toString(),
  };
}
