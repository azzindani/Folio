/**
 * Video export from the editor — handed to the MCP server's own background render.
 *
 * The editor's Export menu stopped at stills and HTML, so a deck built as a video
 * had no way out of the editor as one. Rendering frames in the browser would be a
 * second pipeline (a browser raster, its own encoder) whose file could differ
 * from the MCP export. So the editor asks this server, which forwards to
 * animation(op:export) on the MCP server beside it: the same scene plan, resvg
 * frames and ffmpeg encode, in the same one-at-a-time render queue — an editor
 * export never runs beside an MCP one and halves both.
 *
 *   POST /__project_files/__export          {design, type, scenes?, fps?} → {job_id, frames}
 *   GET  /__project_files/__export/status?job_id=…  → {state, percent, eta_ms, download?}
 *
 * Both sit behind the /__project_files auth. The finished file downloads through
 * the ordinary GET /__project_files/<project>/exports/<file>.
 */

import * as path from 'path';

type Rec = Record<string, unknown>;
export type CallTool = (name: string, args: Rec) => Promise<Rec>;

export interface ExportRouteDeps {
  projectsDir: string;
  /** A request path inside the projects dir → its absolute path, or null when it escapes. */
  resolve: (rel: string) => string | null;
  callTool?: CallTool;
}

const TYPES = new Set(['mp4', 'gif', 'webm']);

const json = (status: number, body: Rec): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** The tool result inside a JSON-RPC reply — plain JSON, or one SSE `data:` line. */
export function toolResultFrom(raw: string): Rec {
  const body = raw.startsWith('event:') || raw.includes('\ndata:')
    ? (raw.split('\n').find(l => l.startsWith('data:')) ?? '').slice(5).trim()
    : raw;
  const rpc = JSON.parse(body) as { result?: { content?: Array<{ type?: string; text?: string }> }; error?: { message?: string } };
  if (rpc.error) return { success: false, error: rpc.error.message ?? 'MCP error' };
  return JSON.parse(rpc.result?.content?.find(c => c.type === 'text')?.text ?? '{}') as Rec;
}

/** Call a tool on the MCP server in this container, as the server itself. */
export const callLocalTool: CallTool = async (name, args) => {
  const key = process.env['FOLIO_API_KEY'];
  const r = await fetch(`http://127.0.0.1:${process.env['FOLIO_PORT'] ?? '3333'}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  return toolResultFrom(await r.text());
};

/** A file inside the projects dir as the URL the editor downloads it from. */
export function downloadUrl(projectsDir: string, abs: string): string | null {
  const rel = path.relative(projectsDir, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return `/__project_files/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;
}

/**
 * The Content-Disposition that makes a browser SAVE a file instead of showing it.
 * `filename` carries an ASCII fallback for old clients; `filename*` the real name —
 * export names keep the design's own, em dashes included.
 */
export function attachmentHeader(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function status(url: URL, deps: ExportRouteDeps, call: CallTool): Promise<Response> {
  const r = await call('animation', { op: 'export_status', job_id: url.searchParams.get('job_id') ?? '' });
  const done = r['state'] === 'done';
  const out = typeof r['output_path'] === 'string' ? r['output_path'] : null;
  const receipt = (r['receipt'] ?? {}) as Rec;
  return json(r['success'] === false ? 409 : 200, {
    state: r['success'] === false ? 'failed' : r['state'],
    percent: done ? 100 : r['percent'] ?? 0,
    eta_ms: r['eta_ms'],
    frames_done: r['frames_done'],
    frames_total: r['frames_total'],
    bytes: receipt['bytes'],
    // A file written with something missing (a failed sound mix) must not pass as a clean export.
    warning: receipt['warning'],
    error: r['error'],
    download: done && out ? downloadUrl(deps.projectsDir, out) : undefined,
  });
}

async function start(req: Request, deps: ExportRouteDeps, call: CallTool): Promise<Response> {
  let body: Rec;
  try { body = await req.json() as Rec; } catch { return json(400, { error: 'Send JSON: {design, type}.' }); }
  const rel = typeof body['design'] === 'string' ? body['design'] : '';
  const abs = rel.endsWith('.design.yaml') ? deps.resolve(rel) : null;
  if (!abs) return json(400, { error: 'design must be a .design.yaml path inside the projects folder.' });
  if (typeof body['type'] !== 'string' || !TYPES.has(body['type'])) return json(400, { error: 'type must be mp4, gif or webm.' });
  const args: Rec = { op: 'export', design_path: abs, type: body['type'], background: true };
  if (body['scenes'] === true) args['scenes'] = true;
  if (typeof body['fps'] === 'number') args['fps'] = body['fps'];
  if (typeof body['scale'] === 'number') args['scale'] = body['scale'];
  const r = await call('animation', args);
  if (r['success'] === false) return json(422, { error: r['error'] ?? 'The export was refused.', hint: r['hint'] });
  return json(202, { job_id: r['job_id'], state: r['state'], frames: r['frames'] });
}

/** The two export routes; null for any other request. */
export async function exportRoute(req: Request, url: URL, deps: ExportRouteDeps): Promise<Response | null> {
  const isStatus = url.pathname === '/__project_files/__export/status' && req.method === 'GET';
  const isStart = url.pathname === '/__project_files/__export' && req.method === 'POST';
  if (!isStatus && !isStart) return null;
  const call = deps.callTool ?? callLocalTool;
  try {
    return isStatus ? await status(url, deps, call) : await start(req, deps, call);
  } catch (e) {
    return json(502, { error: `The render server did not answer: ${(e as Error).message}` });
  }
}
