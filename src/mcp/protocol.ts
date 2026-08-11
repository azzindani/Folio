// MCP protocol revision support — pure logic, no HTTP objects.
//
// Folio is a DUAL-ERA server (spec: "Versioning and Compatibility"). Two eras
// share one endpoint:
//
//   modern (2026-07-28+)  every request carries its own version, identity and
//                         capabilities in `_meta`; no handshake, no session.
//   legacy (≤2025-11-25)  `initialize` opens the conversation.
//
// The era is chosen per request, not per connection: an `initialize` selects
// legacy, per-request modern `_meta` selects modern. That is exactly what the
// spec permits a dual-era server to do, and it is why upgrading cannot break
// the clients already talking to us — they simply never take the modern path.
//
// Everything here is a pure function so the wire contract can be tested
// without standing up a server.

// ── §1 · Protocol revisions ──────────────────────────────────

export const LATEST_PROTOCOL_VERSION = '2026-07-28';

/** First revision to carry version + identity as per-request metadata. */
export const MODERN_MIN_VERSION = '2026-07-28';

/** Newest first — this is the order advertised to clients. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  '2026-07-28',
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
];

/** Revisions before 2025-06-18 did not define MCP-Protocol-Version. The spec
 *  lets a server supporting those clients read a missing header as 2025-03-26
 *  rather than rejecting it; we do, because dropping them buys nothing. */
export const ASSUMED_LEGACY_VERSION = '2025-03-26';

// ── §2 · Reserved `_meta` keys ───────────────────────────────
// Namespaced per the spec's `_meta` naming rules.

export const META = {
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
  logLevel: 'io.modelcontextprotocol/logLevel',
} as const;

// ── §3 · Error codes ─────────────────────────────────────────
// The 2026-07-28 allocation policy partitions the JSON-RPC server-error range:
//   -32000..-32019  implementation-defined (ours go here)
//   -32020..-32099  RESERVED for the MCP specification
// Anything of our own must stay out of the reserved band.

export const MCP_ERROR = {
  HeaderMismatch: -32020,
  MissingRequiredClientCapability: -32021,
  UnsupportedProtocolVersion: -32022,
  MethodNotFound: -32601,
} as const;

/** Folio-defined codes, inside the implementation-defined sub-range. */
export const FOLIO_ERROR = {
  MethodNotAllowed: -32000,
  RateLimited: -32015,
} as const;

// ── §4 · Header access ───────────────────────────────────────

export type HeaderBag = Record<string, string | string[] | undefined>;

/** Case-insensitive header read. Header NAMES are case-insensitive per RFC
 *  9110; values are not, so the value is returned verbatim. */
export function readHeader(headers: HeaderBag, name: string): string {
  const want = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== want) continue;
    const v = headers[key];
    return Array.isArray(v) ? v.join(', ') : (v ?? '');
  }
  return '';
}

/** Decode the spec's Base64 sentinel, `=?base64?<b64>?=`, used when a tool name
 *  or parameter value is not safe as a plain ASCII header value. Markers are
 *  case-sensitive and must appear exactly. Non-sentinel values pass through.
 *  Servers MUST decode before comparing a header to its body value. */
export function decodeHeaderValue(value: string): string {
  if (!value.startsWith('=?base64?') || !value.endsWith('?=')) return value;
  const b64 = value.slice('=?base64?'.length, -'?='.length);
  try {
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    return value;
  }
}

// ── §5 · Version resolution ──────────────────────────────────

export function isSupportedVersion(version: string): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}

/** Revisions are ISO dates, so lexicographic order IS chronological order. */
export function isModernVersion(version: string): boolean {
  return version >= MODERN_MIN_VERSION;
}

/** Read `_meta` off a request's params. Absent or malformed → empty. */
export function readMeta(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) return {};
  const meta = (params as { _meta?: unknown })._meta;
  if (typeof meta !== 'object' || meta === null) return {};
  return meta as Record<string, unknown>;
}

/** The version a request claims, from `_meta` first then the header. Empty
 *  string when neither is present (a pre-2025-06-18 client). */
export function requestedVersion(headers: HeaderBag, params: unknown): string {
  const fromMeta = readMeta(params)[META.protocolVersion];
  if (typeof fromMeta === 'string' && fromMeta) return fromMeta;
  return readHeader(headers, 'MCP-Protocol-Version');
}

/** Is this request to be served under modern semantics?
 *
 *  `initialize` is always legacy — the spec makes the handshake itself the
 *  era selector, so a client that sends one gets legacy treatment no matter
 *  what version it names. Everything else is modern iff it claims 2026-07-28
 *  or later. A request naming no version at all is legacy. */
export function isModernRequest(headers: HeaderBag, method: string, params: unknown): boolean {
  if (method === 'initialize' || method === 'notifications/initialized') return false;
  const v = requestedVersion(headers, params);
  return v !== '' && isModernVersion(v);
}

/** Newest handshake-based revision — what a legacy `initialize` gets when it
 *  asks for something we do not serve. */
export const NEWEST_LEGACY_VERSION = '2025-11-25';

/** Pick the revision to echo from a legacy `initialize`.
 *
 *  Echoing the client's own revision is the whole point: answering with one
 *  hard-coded version tells every client we are older than we are, and gives
 *  up whatever the newer revision would have offered them. A modern version
 *  named inside a handshake is still a handshake, so it does not qualify. */
export function negotiateLegacyVersion(asked: unknown): string {
  if (typeof asked !== 'string' || !asked) return NEWEST_LEGACY_VERSION;
  return isSupportedVersion(asked) && !isModernVersion(asked) ? asked : NEWEST_LEGACY_VERSION;
}

// ── §6 · Modern request validation ───────────────────────────
// Headers mirror body fields so gateways can route and authorize without
// parsing JSON. That only holds if the two agree, so the server MUST reject
// any disagreement — otherwise a load balancer and the server can be made to
// act on different values, which is the security hole the rule exists to shut.
// Failures are 400 + HeaderMismatch (-32020).

/** Methods that must carry Mcp-Name, and the body field it mirrors. */
const NAME_SOURCE: Record<string, 'name' | 'uri'> = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
};

/** Validate a modern request's headers against its body.
 *  @returns null when valid, else the mismatch detail for the error message.
 *
 *  Note: we annotate no tool parameter with `x-mcp-header`, so no
 *  `Mcp-Param-*` header is ever expected — per spec a server MUST NOT expect
 *  headers for parameters it did not annotate. */
export function validateModernHeaders(
  headers: HeaderBag, method: string, params: unknown,
): string | null {
  const versionHeader = readHeader(headers, 'MCP-Protocol-Version');
  if (!versionHeader) return 'MCP-Protocol-Version header is required';
  const metaVersion = readMeta(params)[META.protocolVersion];
  if (typeof metaVersion === 'string' && metaVersion && metaVersion !== versionHeader) {
    return `MCP-Protocol-Version header '${versionHeader}' does not match body value '${metaVersion}'`;
  }

  const methodHeader = readHeader(headers, 'Mcp-Method');
  if (!methodHeader) return 'Mcp-Method header is required';
  if (methodHeader !== method) {
    return `Mcp-Method header '${methodHeader}' does not match body value '${method}'`;
  }

  const source = NAME_SOURCE[method];
  if (!source) return null;
  const nameHeader = readHeader(headers, 'Mcp-Name');
  if (!nameHeader) return `Mcp-Name header is required for ${method}`;
  const bodyValue = (params as Record<string, unknown> | undefined)?.[source];
  if (typeof bodyValue !== 'string') return `params.${source} is required for ${method}`;
  const decoded = decodeHeaderValue(nameHeader);
  if (decoded !== bodyValue) {
    return `Mcp-Name header '${decoded}' does not match body value '${bodyValue}'`;
  }
  return null;
}

// ── §7 · Errors ──────────────────────────────────────────────

export interface JSONRPCErrorBody { code: number; message: string; data?: unknown }

/** 400 + -32022. `data.supported` is the client's fall-forward path: it picks a
 *  mutually supported revision from the list and retries. */
export function unsupportedVersionError(requested: string): JSONRPCErrorBody {
  return {
    code: MCP_ERROR.UnsupportedProtocolVersion,
    message: 'Unsupported protocol version',
    data: { supported: [...SUPPORTED_PROTOCOL_VERSIONS], requested },
  };
}

/** 400 + -32020. */
export function headerMismatchError(detail: string): JSONRPCErrorBody {
  return { code: MCP_ERROR.HeaderMismatch, message: `Header mismatch: ${detail}` };
}

// ── §8 · Result shaping ──────────────────────────────────────

export interface ServerIdentity { name: string; version: string }
export type CacheScope = 'public' | 'private';

/** How long a client may reuse a cached list. The tool table is fixed for the
 *  life of the process, so this is really "how fast a redeploy is noticed". */
export const TOOLS_LIST_TTL_MS = 300_000;
export const DISCOVER_TTL_MS = 3_600_000;

function mergeMeta(result: Record<string, unknown>, add: Record<string, unknown>): Record<string, unknown> {
  const existing = result['_meta'];
  const base = (typeof existing === 'object' && existing !== null) ? existing as Record<string, unknown> : {};
  return { ...result, _meta: { ...base, ...add } };
}

/** Stamp a modern result: `resultType` (required on every result in this
 *  revision) plus the server's self-reported identity. Identity is for display
 *  and logging only — clients are told not to make decisions on it. */
export function completeResult(
  result: Record<string, unknown>, identity: ServerIdentity,
): Record<string, unknown> {
  return mergeMeta({ resultType: 'complete', ...result }, {
    [META.serverInfo]: { name: identity.name, version: identity.version },
  });
}

/** Add the caching hints required on list/read results. */
export function withCacheHints(
  result: Record<string, unknown>, ttlMs: number, cacheScope: CacheScope,
): Record<string, unknown> {
  return { ...result, ttlMs, cacheScope };
}

/** The DiscoverResult for `server/discover` — mandatory for servers in this
 *  revision. Clients may call it to learn our versions up front; on stdio it
 *  doubles as the probe that tells a dual-era client which era we speak. */
export function discoverResult(
  identity: ServerIdentity,
  capabilities: Record<string, unknown>,
  instructions?: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
    capabilities,
  };
  if (instructions) base['instructions'] = instructions;
  return withCacheHints(completeResult(base, identity), DISCOVER_TTL_MS, 'public');
}

