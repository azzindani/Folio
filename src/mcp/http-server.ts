// §14 — HTTP transport for MCP; zero domain logic. Wraps all three tiers.
import * as http from 'http';
import * as fs from 'fs';
import { TIER1_TOOLS } from './tier1/registry';
import { TIER2_TOOLS } from './tier2/registry';
import { TIER3_TOOLS } from './tier3/registry';
import * as engine from './engine';
import { toMCPResult } from './types';
import { authorize, describeAuth, loadTokens } from './auth';
import { handleOAuth } from './oauth';
import { readBodyCapped, PayloadTooLargeError } from '../utils/http-body';
import { normalizeProjectPaths } from './normalize-paths';

// Cap the /mcp request body so a single large POST can't buffer unboundedly
// into the heap and OOM the memory-capped container. 32 MiB is generous for a
// big multi-page add_layers call; raise via FOLIO_MAX_BODY_BYTES if needed.
const MAX_BODY_BYTES = Number(process.env['FOLIO_MAX_BODY_BYTES'] ?? 32 * 1024 * 1024);
// Above this, editorBroadcast won't read a changed file into memory to fan out
// to every connected editor (it sends a path-only event; the editor refetches).
const MAX_BROADCAST_BYTES = Number(process.env['FOLIO_MAX_BROADCAST_BYTES'] ?? 16 * 1024 * 1024);

import type { MCPRequest, MCPResponse, ToolResult, ToolDefinition, ContextField } from './types';

type Handler = (args: Record<string, unknown>) => ToolResult;

// §1 — All-tier handler map
const HANDLERS: Record<string, Handler> = {
  get_engine_guide:    (_a) => engine.getEngineGuide({}),
  list_tasks:          (a) => engine.listTasks(a as Parameters<typeof engine.listTasks>[0]),
  create_project:      (a) => engine.createProject(a as Parameters<typeof engine.createProject>[0]),
  list_designs:        (a) => engine.listDesigns(a as Parameters<typeof engine.listDesigns>[0]),
  list_themes:         (a) => engine.listThemes(a as Parameters<typeof engine.listThemes>[0]),
  apply_theme:         (a) => engine.applyTheme(a as Parameters<typeof engine.applyTheme>[0]),
  duplicate_design:    (a) => engine.duplicateDesign(a as Parameters<typeof engine.duplicateDesign>[0]),
  resume_design:       (a) => engine.resumeDesign(a as Parameters<typeof engine.resumeDesign>[0]),
  create_task:         (a) => engine.createTask(a as Parameters<typeof engine.createTask>[0]),
  resume_task:         (a) => engine.resumeTask(a as Parameters<typeof engine.resumeTask>[0]),
  inspect_design:      (a) => engine.inspectDesign(a as Parameters<typeof engine.inspectDesign>[0]),
  add_layers:          (a) => engine.addLayers(a as Parameters<typeof engine.addLayers>[0]),
  create_design:       (a) => engine.createDesign(a as Parameters<typeof engine.createDesign>[0]),
  append_page:         (a) => engine.appendPage(a as Parameters<typeof engine.appendPage>[0]),
  patch_design:        (a) => engine.patchDesign(a as Parameters<typeof engine.patchDesign>[0]),
  seal_design:         (a) => engine.sealDesign(a as Parameters<typeof engine.sealDesign>[0]),
  add_layer:           (a) => engine.addLayer(a as Parameters<typeof engine.addLayer>[0]),
  update_layer:        (a) => engine.updateLayer(a as Parameters<typeof engine.updateLayer>[0]),
  remove_layer:        (a) => engine.removeLayer(a as Parameters<typeof engine.removeLayer>[0]),
  export_design:       (a) => engine.exportDesign(a as Parameters<typeof engine.exportDesign>[0]),
  batch_create:        (a) => engine.batchCreate(a as Parameters<typeof engine.batchCreate>[0]),
  save_as_component:   (a) => engine.saveAsComponent(a as Parameters<typeof engine.saveAsComponent>[0]),
  export_template:     (a) => engine.exportTemplate(a as Parameters<typeof engine.exportTemplate>[0]),
  inject_template:     (a) => engine.injectTemplate(a as Parameters<typeof engine.injectTemplate>[0]),
  list_template_slots: (a) => engine.listTemplateSlots(a as Parameters<typeof engine.listTemplateSlots>[0]),
  open_in_editor:      (a) => engine.openInEditor(a as Parameters<typeof engine.openInEditor>[0]),
  // Phase 4/5: report · presentation · formula · animation · collab.
  generate_report:        (a) => engine.generateReport(a as Parameters<typeof engine.generateReport>[0]),
  bind_data:              (a) => engine.bindData(a as Parameters<typeof engine.bindData>[0]),
  export_report:          (a) => engine.exportReport(a as Parameters<typeof engine.exportReport>[0]),
  create_presentation:    (a) => engine.createPresentation(a as Parameters<typeof engine.createPresentation>[0]),
  export_presentation:    (a) => engine.exportPresentation(a as Parameters<typeof engine.exportPresentation>[0]),
  set_formula_context:    (a) => engine.setFormulaContext(a as Parameters<typeof engine.setFormulaContext>[0]),
  debug_formula:          (a) => engine.debugFormula(a as Parameters<typeof engine.debugFormula>[0]),
  inspect_timeline:       (a) => engine.inspectTimeline(a as Parameters<typeof engine.inspectTimeline>[0]),
  add_keyframe:           (a) => engine.addKeyframeToLayer(a as Parameters<typeof engine.addKeyframeToLayer>[0]),
  export_animation:       (a) => engine.exportAnimation(a as Parameters<typeof engine.exportAnimation>[0]),
  setup_remote_presenter: (a) => engine.setupRemotePresenter(a as Parameters<typeof engine.setupRemotePresenter>[0]),
  setup_collab:           (a) => engine.setupCollab(a as Parameters<typeof engine.setupCollab>[0]),
};

// Tools whose results signal that a .design.yaml file just changed.
// The editor SSE channel notifies any connected editor instance so it can
// reload the file without the user re-opening it.
const FILE_MUTATING_TOOLS = new Set([
  'create_design', 'patch_design', 'seal_design', 'apply_theme',
  'add_layer', 'add_layers', 'update_layer', 'remove_layer', 'append_page',
  'inject_template', 'save_as_component', 'duplicate_design',
  'batch_create', 'bind_data', 'generate_report', 'add_keyframe',
]);

const ALL_TOOLS: ToolDefinition[] = [...TIER1_TOOLS, ...TIER2_TOOLS, ...TIER3_TOOLS];

// §2 — SSE client registries
//   sseClients      — generic /mcp/sse stream (every tool response)
//   editorClients   — /editor/events stream (file_changed events only)
const sseClients = new Set<http.ServerResponse>();
const editorClients = new Set<http.ServerResponse>();

// §3 — Auth · CORS · reply helpers
function setCORS(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

function handleMCP(req: MCPRequest): DispatchResult {
  const { id, method, params } = req;
  switch (method) {
    case 'initialize':
      return { response: { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'folio-mcp-http', version: '1.0.0' } } } };
    case 'notifications/initialized':
      return { response: { jsonrpc: '2.0', id, result: null } };
    case 'tools/list':
      return { response: { jsonrpc: '2.0', id, result: { tools: ALL_TOOLS } } };
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
      if (!fn) return { response: { jsonrpc: '2.0', id, result: toMCPResult({ success: false, op: name, error: `Unknown tool: ${name}`, hint: `Available: ${Object.keys(HANDLERS).join(', ')}`, progress: [], token_estimate: 0 }) }, toolName: name };
      try {
        const raw = fn(args);
        return { response: { jsonrpc: '2.0', id, result: toMCPResult(raw) }, raw, toolName: name };
      } catch (err) {
        return { response: { jsonrpc: '2.0', id, result: toMCPResult({ success: false, op: name, error: (err as Error).message, hint: 'Unexpected engine error.', progress: [], token_estimate: 0 }) }, toolName: name };
      }
    }
    default:
      return { response: { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } } };
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
    jsonReply(res, 200, { status: 'ok', version: '1.0.0', tiers: ['1', '2', '3'], auth: loadTokens().mode }); return;
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
    if (tok) req.headers['authorization'] = `Bearer ${tok}`;
  }

  const tokenName = authorize(req);
  if (tokenName === null) { jsonReply(res, 401, { error: 'Unauthorized', hint: 'Send Authorization: Bearer <token>' }); return; }

  // §7a — Whoami endpoint: clients can verify which token was accepted.
  if (pathOnly === '/tokens/whoami' && method === 'GET') {
    jsonReply(res, 200, { token: tokenName, auth_mode: loadTokens().mode }); return;
  }

  if (pathOnly === '/mcp/sse' && method === 'GET') {
    setCORS(res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
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
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: connected\ndata: {"status":"connected"}\n\n`);
    editorClients.add(res);
    req.on('close', () => editorClients.delete(res));
    return;
  }

  if (pathOnly === '/mcp' && method === 'POST') {
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
    const { response, raw, toolName } = handleMCP(parsed);
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
  });
}

if (process.argv[1]?.endsWith('http-server.ts') || process.argv[1]?.endsWith('http-server.js')) startHttpServer();
