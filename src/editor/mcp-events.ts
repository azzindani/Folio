/**
 * mcp-events — minimal SSE client that lets the editor live-refresh
 * when an MCP server edits the design file behind the scenes.
 *
 * Wire-up:
 *   1. The user (or an LLM via open_in_editor) opens the editor with
 *      `?mcp_url=http://host:3333` and optionally `?file=/path/to/design.yaml`.
 *   2. This module opens `EventSource(${mcpUrl}/editor/events)`.
 *   3. On `file_changed` matching the open file, it calls onFileChanged
 *      with the new YAML content (broadcast inline by the server).
 *
 * The MCP server must be reachable from the browser and must allow CORS
 * (it does — see src/mcp/http-server.ts).
 */
export interface MCPEventOptions {
  /** Base URL of the MCP HTTP server (e.g. http://localhost:3333) */
  mcpUrl: string;
  /** Absolute path of the design file currently open in the editor.
   *  Pass undefined to receive every file_changed event. */
  designPath?: string;
  /** Called with the new YAML content of the watched file. */
  onFileChanged: (yamlContent: string, payload: FileChangedPayload) => void;
  /** Optional: called when the SSE connection is established. */
  onOpen?: () => void;
  /** Optional: called when the connection drops or errors. */
  onError?: (err: Event) => void;
}

export interface FileChangedPayload {
  event: 'file_changed' | 'file_removed';
  op: string;
  path: string;
  content: string | null;
  ts: number;
}

export interface MCPEventSubscription {
  /** Close the SSE connection. */
  close: () => void;
}

/** Open a subscription to the MCP server's editor-events stream. */
export function subscribeMCPEvents(opts: MCPEventOptions): MCPEventSubscription {
  const url = new URL('/editor/events', opts.mcpUrl).toString();
  const es = new EventSource(url);

  if (opts.onOpen) es.addEventListener('open', () => opts.onOpen!());
  if (opts.onError) es.addEventListener('error', (e) => opts.onError!(e));

  es.addEventListener('file_changed', (e) => {
    let payload: FileChangedPayload;
    try { payload = JSON.parse((e as MessageEvent).data) as FileChangedPayload; }
    catch { return; }

    if (opts.designPath && payload.path !== opts.designPath) return;
    if (typeof payload.content !== 'string') return;
    opts.onFileChanged(payload.content, payload);
  });

  return { close: () => es.close() };
}

/** Read MCP wiring out of `location.search` (browser) or a query string. */
export function parseMCPParams(search: string = typeof location !== 'undefined' ? location.search : ''): {
  mcpUrl?: string;
  designPath?: string;
  page?: number;
} {
  const p = new URLSearchParams(search);
  const out: { mcpUrl?: string; designPath?: string; page?: number } = {};
  const mcpUrl = p.get('mcp_url');
  if (mcpUrl) out.mcpUrl = mcpUrl;
  const file = p.get('file');
  if (file) out.designPath = file;
  const page = p.get('page');
  if (page && /^\d+$/.test(page)) out.page = parseInt(page, 10);
  return out;
}
