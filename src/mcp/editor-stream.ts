// The editor's live-refresh stream: that it opens, and that it hears every edit.
//
// Found live (2026-09-23), two faults on one door:
//
// 1. The runtime (Bun 1.1.38's node:http) holds a response's headers and its
//    FIRST write until a second write or end(). An SSE stream writes one
//    "connected" event and then waits, so nothing reached the browser — no
//    headers, no `open` — until the next broadcast; behind a proxy the idle,
//    headerless request is a candidate for a timeout. A comment written on the
//    next tick flushes the opening, and a comment heartbeat keeps it alive.
//
// 2. Only edits whose reply NAMED the design (a root design_path, or a
//    .design.yaml in context.artifacts) were announced. edit_layer op:update
//    names neither, so an MCP edit to an open page never reached the editor.
//    The truthful signal is the file itself: the design a call targeted is
//    announced when it changed on disk during the call.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type * as http from 'http';

const HEARTBEAT_MS = 25_000;

/** Start an event stream whose opening really goes out. The caller sets CORS first. */
export function openEventStream(req: http.IncomingMessage, res: http.ServerResponse, first: string, heartbeatMs = HEARTBEAT_MS): void {
  // X-Accel-Buffering: no stops a reverse proxy (we sit behind Caddy) from
  // accumulating events instead of passing them straight through.
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(first);
  setImmediate(() => { if (!res.writableEnded) res.write(': open\n\n'); });
  const beat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, heartbeatMs);
  beat.unref?.();
  req.on('close', () => clearInterval(beat));
}

/** The .design.yaml a tool call targets, resolved the way the engine resolves it, or null. */
export function targetDesign(args: Record<string, unknown>): string | null {
  const dp = args['design_path'];
  if (typeof dp !== 'string' || !dp.endsWith('.design.yaml')) return null;
  if (path.isAbsolute(dp)) return path.resolve(dp);
  if (dp.startsWith('~/')) return path.resolve(path.join(os.homedir(), dp.slice(2)));
  const pp = args['project_path'];
  return path.resolve(typeof pp === 'string' && pp ? path.join(pp, dp) : dp);
}

/** A file's modification time in ms, or null when it is not there. */
export function mtimeOf(file: string | null): number | null {
  if (!file) return null;
  try { return fs.statSync(file).mtimeMs; } catch { return null; }
}
