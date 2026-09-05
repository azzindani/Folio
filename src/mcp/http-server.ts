// §14 — HTTP transport for MCP; zero domain logic. Wraps all three tiers.
import * as http from 'http';
import * as fs from 'fs';
import { TIER1_TOOLS } from './tier1/registry';
import { TIER2_TOOLS } from './tier2/registry';
import { TIER3_TOOLS } from './tier3/registry';
import { ALL_HANDLERS } from './handlers';
import { toMCPResult } from './types';
import { authorize, describeAuth, loadTokens } from './auth';
import { handleOAuth } from './oauth';
import { readBodyCapped, PayloadTooLargeError } from '../utils/http-body';
import { normalizeProjectPaths } from './normalize-paths';
import { rateLimiterFromEnv } from './rate-limit';
import { startUpdateChecks, getUpdateStatus, currentVersion } from './update-check';
import {
  MCP_ERROR, FOLIO_ERROR, isSupportedVersion, isModernRequest, requestedVersion,
  negotiateLegacyVersion, validateModernHeaders, unsupportedVersionError,
  headerMismatchError, completeResult, withCacheHints, discoverResult,
  TOOLS_LIST_TTL_MS, type ServerIdentity, type HeaderBag,
} from './protocol';

// Cap the /mcp request body so a single large POST can't buffer unboundedly
// into the heap and OOM the memory-capped container. 32 MiB is generous for a
// big multi-page add_layers call; raise via FOLIO_MAX_BODY_BYTES if needed.
const MAX_BODY_BYTES = Number(process.env['FOLIO_MAX_BODY_BYTES'] ?? 32 * 1024 * 1024);
// Above this, editorBroadcast won't read a changed file into memory to fan out
// to every connected editor (it sends a path-only event; the editor refetches).
const MAX_BROADCAST_BYTES = Number(process.env['FOLIO_MAX_BROADCAST_BYTES'] ?? 16 * 1024 * 1024);

import type { MCPRequest, MCPResponse, ToolResult, ToolDefinition, ContextField } from './types';
import { withOpScope } from './design-lineage';

type Handler = (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;

// §1 — All-tier handler map. Single source of truth = handlers.ALL_HANDLERS
// (TIER1∪TIER2∪TIER3). Do NOT re-declare the map here — a local copy silently
// drifts from the advertised ALL_TOOLS schema, so a newly-registered tool
// (e.g. diagnose_design/render_preview/align_layers) advertises but 404s on
// call ("Unknown tool"). Importing the shared map keeps dispatch ≡ schema.
const HANDLERS: Record<string, Handler> = ALL_HANDLERS;

// Tools whose results signal that a .design.yaml file just changed.
// The editor SSE channel notifies any connected editor instance so it can
// reload the file without the user re-opening it.
// Consolidated tool names that can write a design file (some only on certain
// ops, e.g. manage_design op:rename, templates op:inject) — over-inclusion only
// triggers a harmless extra editor refresh, so list every tool that may mutate.
const FILE_MUTATING_TOOLS = new Set([
  'create_design', 'add_layers', 'edit_layer', 'patch_design', 'seal_design',
  'append_page', 'themes', 'manage_design', 'tasks',
  'templates', 'report', 'presentation', 'animation',
]);

// Static concat of three static registries, so the order is already stable —
// which is what the spec's deterministic-ordering SHOULD is asking for, and
// what lets a client (and the model's prompt cache) hold on to the list.
const ALL_TOOLS: ToolDefinition[] = [...TIER1_TOOLS, ...TIER2_TOOLS, ...TIER3_TOOLS];

// §1b — Protocol identity. Reported on modern results and from server/discover;
// self-reported and explicitly not a security signal, per spec.
function identity(): ServerIdentity {
  return { name: 'folio-mcp-http', version: currentVersion() };
}
const CAPABILITIES: Record<string, unknown> = { tools: {} };
const INSTRUCTIONS = 'Folio compiles YAML design specs into SVG posters, carousels, decks and interactive reports. Start with create_project, then create_design; call get_engine_guide for authoring rules.';

// §2a — Per-identity rate limiter for POST /mcp (the only event-loop-blocking
// route). Keyed by token-name + client IP so it isolates clients in both
// multi-token and shared-single-key deploys. null = disabled (env opt-out).
const rateLimiter = rateLimiterFromEnv();

/** Best client IP for rate-limit keying. Uses the LAST X-Forwarded-For hop —
 *  the value our trusted edge proxy (Caddy) appended, which is the real peer and
 *  cannot be spoofed by a client injecting its own XFF header (a client-set value
 *  lands to the left of it). No XFF (direct deploy) → the socket peer. Falls back
 *  to a constant so a missing address can't crash keying. */
function clientIp(req: http.IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  const hops = (Array.isArray(xff) ? xff.join(',') : (xff ?? '')).split(',').map(s => s.trim()).filter(Boolean);
  return (hops.length ? hops[hops.length - 1] : req.socket?.remoteAddress ?? 'unknown') || 'unknown';
}

// §2 — SSE client registries
//   sseClients      — generic /mcp/sse stream (every tool response)
//   editorClients   — /editor/events stream (file_changed events only)
const sseClients = new Set<http.ServerResponse>();
const editorClients = new Set<http.ServerResponse>();

// §3 — Auth · CORS · reply helpers
/** Read one cookie out of a raw Cookie header (EventSource can send cookies but
 *  not an Authorization header, so a cookie is the only credential it has). */
function cookieValue(header: string | string[] | undefined, name: string): string {
  const raw = Array.isArray(header) ? header.join('; ') : (header ?? '');
  for (const pair of raw.split(';')) {
    const [k, ...rest] = pair.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function setCORS(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // The 2026-07-28 metadata headers must survive CORS preflight or a
  // browser-based modern client is blocked before it ever reaches us.
  // Mcp-Param-* is the x-mcp-header mirror: we annotate no tool with it today,
  // but a preflight that omits it would reject such a client outright.
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Param-*, Last-Event-ID');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
}
function jsonReply(res: http.ServerResponse, status: number, body: unknown): void {
  setCORS(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// §4 — MCP JSON-RPC dispatch.
// Returns the wire-level response and (when applicable) the raw ToolResult
// so the router can fire an editor file-changed event for mutating tools.
interface DispatchResult { response: MCPResponse; raw?: ToolResult; toolName?: string }

/** @param modern — serve 2026-07-28 semantics (per-request metadata, stamped
 *  results) rather than the handshake-era shape. Chosen per request by
 *  isModernRequest, so both eras share this one dispatch. */
export async function handleMCP(req: MCPRequest, modern = false): Promise<DispatchResult> {
  const { id, method, params } = req;
  const asRecord = (v: object): Record<string, unknown> => v as unknown as Record<string, unknown>;
  /** Modern results carry resultType + serverInfo; legacy results must not. */
  const shape = (result: object): unknown =>
    modern ? completeResult(asRecord(result), identity()) : result;
  switch (method) {
    case 'initialize': {
      const negotiated = negotiateLegacyVersion((params as { protocolVersion?: unknown } | undefined)?.protocolVersion);
      return { response: { jsonrpc: '2.0', id, result: { protocolVersion: negotiated, capabilities: CAPABILITIES, serverInfo: identity() } } };
    }
    case 'notifications/initialized':
      return { response: { jsonrpc: '2.0', id, result: null } };
    // Mandatory for servers in 2026-07-28. Answered in either era: it is also
    // the probe a dual-era client uses to find out which era we speak.
    case 'server/discover':
      return { response: { jsonrpc: '2.0', id, result: discoverResult(identity(), CAPABILITIES, INSTRUCTIONS) } };
    case 'tools/list': {
      const base = { tools: ALL_TOOLS };
      // cacheScope stays private: /mcp is authenticated, so there is nothing to
      // gain from letting a shared intermediary hold the response.
      return { response: { jsonrpc: '2.0', id, result: modern
        ? withCacheHints(completeResult(asRecord(base), identity()), TOOLS_LIST_TTL_MS, 'private')
        : base } };
    }
    case 'tools/call': {
      const name = (params as { name?: string } | undefined)?.name ?? '';
      const rawArgs = (params as { arguments?: Record<string, unknown> } | undefined)?.arguments ?? {};
      // LLM-friendliness: rewrite project_path/path/design_path so a design
      // always lands under FOLIO_PROJECTS_DIR — the only root the editor can
      // serve. Resolves bare names ("rainforest"), misguessed ".../projects/x"
      // paths, and paths an LLM rooted at HOME instead of the projects dir
      // (e.g. /home/folio/AIPosterProject). See normalizeProjectPaths.
      const args = normalizeProjectPaths(rawArgs);
      const fn = HANDLERS[name];
      if (!fn) return { response: { jsonrpc: '2.0', id, result: shape(toMCPResult({ success: false, op: name, error: `Unknown tool: ${name}`, hint: `Available: ${Object.keys(HANDLERS).join(', ')}`, progress: [], token_estimate: 0 })) }, toolName: name };
      try {
        // Every write this call makes is attributed to it — see design-lineage.
        // Eight of the tools are multiplexed on an `op`, so the tool name alone
        // would record "manage_design" for a recolour, a resize and a rename
        // alike — a history that cannot answer what actually happened. Record
        // the action, not just the door it came through.
        const subOp = typeof args['op'] === 'string' ? `:${args['op']}` : '';
        const raw = await withOpScope(`${name}${subOp}`, args, () => fn(args));
        return { response: { jsonrpc: '2.0', id, result: shape(toMCPResult(raw)) }, raw, toolName: name };
      } catch (err) {
        return { response: { jsonrpc: '2.0', id, result: shape(toMCPResult({ success: false, op: name, error: (err as Error).message, hint: 'Unexpected engine error.', progress: [], token_estimate: 0 })) }, toolName: name };
      }
    }
    default:
      return { response: { jsonrpc: '2.0', id, error: { code: MCP_ERROR.MethodNotFound, message: `Method not found: ${method}` } } };
  }
}

// §5 — Read full request body, bounded to MAX_BODY_BYTES (see top of file).
function readBody(req: http.IncomingMessage): Promise<string> {
  return readBodyCapped(req, MAX_BODY_BYTES);
}

// §6 — Broadcast to all open SSE connections
function sseBroadcast(data: unknown): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

// §6b — Broadcast a file-change event to editor SSE subscribers.
// Includes the new file content so the editor can reload without a
// separate fetch (and without the MCP server having to read it again).
function editorBroadcast(event: 'file_changed' | 'file_removed', filePath: string, op: string): void {
  let content: string | null = null;
  if (event === 'file_changed' && filePath) {
    // Skip files above the cap: reading a huge design into memory and fanning
    // it out to every connected editor is a memory/CPU multiplier. The event
    // still fires with content:null so the editor knows the file changed.
    try {
      if (fs.statSync(filePath).size <= MAX_BROADCAST_BYTES) content = fs.readFileSync(filePath, 'utf-8');
    } catch { content = null; }
  }
  const payload = `event: ${event}\ndata: ${JSON.stringify({ event, op, path: filePath, content, ts: Date.now() })}\n\n`;
  for (const client of editorClients) {
    try { client.write(payload); } catch { editorClients.delete(client); }
  }
}

// §6c — Pull a YAML file path out of a tool response so we can announce
// it on /editor/events. Tools record their artifacts in context.artifacts
// with role="created" | "modified" | "opened"; we look for a .design.yaml.
function findChangedDesignPath(result: ToolResult): string | null {
  const ctx = result.context as ContextField | undefined;
  const artifacts = ctx?.artifacts ?? [];
  for (const a of artifacts) {
    if (typeof a.path === 'string' && a.path.endsWith('.design.yaml')) return a.path;
  }
  // Fallback: tools sometimes return path / output_path / design_path on the
  // result root.
  for (const key of ['design_path', 'path', 'output_path']) {
    const v = (result as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.endsWith('.design.yaml')) return v;
  }
  return null;
}

// §7 — Request router
async function router(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';
  // Path without the query string — used for route matching so that
  // ?token=... on /editor/events doesn't break the exact-match checks
  // below. Keep `url` available for OAuth/query-param extraction.
  const pathOnly = url.split('?')[0] ?? url;

  if (method === 'OPTIONS') { setCORS(res); res.writeHead(204); res.end(); return; }

  if (pathOnly === '/health' && method === 'GET') {
    const upd = getUpdateStatus();
    jsonReply(res, 200, {
      status: 'ok',
      version: upd.current,                 // was hardcoded '1.0.0' — report the real package version
      update_available: upd.update_available,
      tiers: ['1', '2', '3'],
      auth: loadTokens().mode,
    });
    return;
  }

  // Unauthenticated like /health: the running version + whether upstream has a
  // newer release. Lets a monitor / cron alert on a stale deployment without
  // holding an API token. Reports only THIS server's own version state.
  if (pathOnly === '/version' && method === 'GET') {
    jsonReply(res, 200, getUpdateStatus()); return;
  }

  // OAuth and well-known endpoints run BEFORE the bearer check so the
  // claude.ai connector setup can discover metadata, register, and walk
  // the authorize/token dance without already having a token.
  if (await handleOAuth(req, res)) return;

  // EventSource has no way to send Authorization headers, so /editor/events
  // also accepts ?token=<x>. We synthesize a Bearer header from the query
  // param so the standard authorize() path validates it the same way.
  if (pathOnly === '/editor/events' && method === 'GET' && !req.headers['authorization']) {
    const qs = url.split('?')[1] ?? '';
    const tok = new URLSearchParams(qs).get('token');
    // …and the folio_session cookie. The editor strips ?token= from its address
    // bar on first load and swaps it for that cookie, so by the time the page
    // opens its EventSource there is no query token left to send — which is why
    // live refresh died on any editor session that had been through the strip.
    const cookieTok = cookieValue(req.headers['cookie'], 'folio_session');
    const use = tok || cookieTok;
    if (use) req.headers['authorization'] = `Bearer ${use}`;
  }

  const tokenName = authorize(req);
  if (tokenName === null) { jsonReply(res, 401, { error: 'Unauthorized', hint: 'Send Authorization: Bearer <token>' }); return; }

  // §7a — Whoami endpoint: clients can verify which token was accepted.
  if (pathOnly === '/tokens/whoami' && method === 'GET') {
    jsonReply(res, 200, { token: tokenName, auth_mode: loadTokens().mode }); return;
  }

  if (pathOnly === '/mcp/sse' && method === 'GET') {
    setCORS(res);
    // X-Accel-Buffering: no stops a reverse proxy (we sit behind Caddy) from
    // accumulating events instead of passing them straight through.
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: {"status":"connected"}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Editor live-refresh stream. The editor URL minted by open_in_editor
  // includes ?mcp_url=<base>; the editor opens an EventSource against
  // <base>/editor/events and reloads the design when file_changed fires.
  if (pathOnly === '/editor/events' && method === 'GET') {
    setCORS(res);
    // X-Accel-Buffering: no stops a reverse proxy (we sit behind Caddy) from
    // accumulating events instead of passing them straight through.
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: connected\ndata: {"status":"connected"}\n\n`);
    editorClients.add(res);
    req.on('close', () => editorClients.delete(res));
    return;
  }

  if (pathOnly === '/mcp' && method === 'POST') {
    // Rate-limit BEFORE reading the body so a flood is rejected cheaply. Keyed
    // by token+IP; emits 429 + Retry-After (the standard back-off signal) so the
    // event loop can't be monopolised by one client's burst of heavy calls.
    if (rateLimiter) {
      const dec = rateLimiter.take(`${tokenName}|${clientIp(req)}`, Date.now());
      res.setHeader('X-RateLimit-Limit', String(rateLimiter.burst));
      res.setHeader('X-RateLimit-Remaining', String(dec.remaining));
      if (!dec.ok) {
        const retryS = Math.max(1, Math.ceil(dec.retryAfterMs / 1000));
        res.setHeader('Retry-After', String(retryS));
        process.stderr.write(`[mcp] token=${tokenName} RATE-LIMITED retry=${retryS}s\n`);
        jsonReply(res, 429, { jsonrpc: '2.0', id: null, error: { code: FOLIO_ERROR.RateLimited, message: `Rate limit exceeded — retry after ${retryS}s.` } });
        return;
      }
    }
    let body: string;
    try { body = await readBody(req); }
    catch (e) {
      if (e instanceof PayloadTooLargeError) {
        jsonReply(res, 413, { error: 'Payload too large', hint: `Body exceeds ${MAX_BODY_BYTES} bytes (raise FOLIO_MAX_BODY_BYTES).` });
        return;
      }
      jsonReply(res, 400, { error: 'Failed to read request body' });
      return;
    }
    let parsed: MCPRequest;
    try { parsed = JSON.parse(body) as MCPRequest; } catch { jsonReply(res, 400, { jsonrpc: '2.0', id: 0, error: { code: -32700, message: 'Parse error' } }); return; }
    // JSON-RPC notifications (the `notifications/*` namespace, e.g.
    // notifications/initialized) take 202 Accepted + EMPTY body per the MCP
    // Streamable-HTTP spec. Returning a response object to a notification makes
    // strict SDK clients (LM Studio) reject the connection.
    if (typeof parsed.method === 'string' && parsed.method.startsWith('notifications/')) {
      setCORS(res); res.writeHead(202); res.end(); return;
    }
    // §7c — Era selection. A modern request (2026-07-28+, carrying its version
    // and identity per-request) gets the stateless contract and its header
    // validation; everything else — which is every client talking to us today —
    // keeps the handshake-era behaviour byte for byte. See ./protocol.ts.
    const headers = req.headers as HeaderBag;
    const modern = isModernRequest(headers, parsed.method, parsed.params);
    if (modern) {
      const mismatch = validateModernHeaders(headers, parsed.method, parsed.params);
      if (mismatch) {
        jsonReply(res, 400, { jsonrpc: '2.0', id: parsed.id ?? null, error: headerMismatchError(mismatch) });
        return;
      }
      const wanted = requestedVersion(headers, parsed.params);
      if (!isSupportedVersion(wanted)) {
        jsonReply(res, 400, { jsonrpc: '2.0', id: parsed.id ?? null, error: unsupportedVersionError(wanted) });
        return;
      }
    }
    const { response, raw, toolName } = await handleMCP(parsed, modern);
    // On the modern transport an unimplemented method is 404 + -32601, which is
    // how a dual-era client tells "method I don't have" from "not an MCP
    // endpoint at all" — a bare 404 would send it hunting for a legacy server.
    if (modern && response.error?.code === MCP_ERROR.MethodNotFound) {
      jsonReply(res, 404, response);
      return;
    }
    // Audit: which named token invoked which tool. Token VALUES are never logged.
    if (parsed.method === 'tools/call' && toolName) {
      process.stderr.write(`[mcp] token=${tokenName} tool=${toolName} ok=${raw?.success ?? false}\n`);
    }
    sseBroadcast(response);
    // Notify any connected editor that a design file just changed.
    if (raw && raw.success && toolName && FILE_MUTATING_TOOLS.has(toolName)) {
      const filePath = findChangedDesignPath(raw);
      if (filePath) editorBroadcast('file_changed', filePath, toolName);
    }
    jsonReply(res, 200, response);
    return;
  }

  // Streamable-HTTP: 2026-07-28 removed the GET stream endpoint and protocol
  // sessions outright, and requires exactly this — 405 for GET (open SSE
  // stream) and DELETE (end session) on the MCP endpoint. It was already the
  // right answer for LM Studio, which needs "no stream offered" rather than an
  // error. Mcp-Session-Id and Last-Event-ID are ignored: we mint no sessions
  // and no stream of ours is resumable.
  if (pathOnly === '/mcp' && (method === 'GET' || method === 'DELETE')) {
    setCORS(res);
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: FOLIO_ERROR.MethodNotAllowed, message: 'Method Not Allowed: POST JSON-RPC to /mcp; this endpoint exposes no GET stream.' } }));
    return;
  }

  jsonReply(res, 404, { error: 'Not found' });
}

// §8 — Server factory + entry point
export function startHttpServer(): void {
  const port = parseInt(process.env['FOLIO_PORT'] ?? '3333', 10);
  http.createServer((req, res) => {
    router(req, res).catch((err: unknown) => {
      jsonReply(res, 500, { error: (err as Error).message ?? 'Internal server error' });
    });
  }).listen(port, () => {
    process.stderr.write(`folio-mcp-http listening on :${port}\n`);
    process.stderr.write(`[mcp] auth: ${describeAuth()}\n`);
    startUpdateChecks();
    if (rateLimiter) {
      process.stderr.write(`[mcp] rate limit: ${rateLimiter.burst} burst, ${rateLimiter.perSec}/s per token+IP\n`);
      // Evict idle buckets so the Map can't grow unbounded. unref() keeps the
      // timer from holding the process open.
      setInterval(() => rateLimiter.sweep(Date.now()), 60_000).unref();
    } else {
      process.stderr.write(`[mcp] rate limit: disabled\n`);
    }
  });
}

if (process.argv[1]?.endsWith('http-server.ts') || process.argv[1]?.endsWith('http-server.js')) startHttpServer();
