import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { readBodyCapped, PayloadTooLargeError } from '../utils/http-body';

// Cap incoming design-patch bodies so a runaway client can't buffer an
// unbounded write into the heap. 32 MiB is far above any real design.
const PATCH_MAX_BODY_BYTES = Number(process.env['FOLIO_MAX_BODY_BYTES'] ?? 32 * 1024 * 1024);

export interface CollabOptions {
  design_path: string;
  port?: number;
}

export interface CollabServerHandle {
  port: number;
  close(): void;
}

type SSEClient = { res: http.ServerResponse; alive: boolean };

/** SSE-based collaborative design server. Watches .design.yaml for changes and pushes to clients. */
export function startCollabServer(opts: CollabOptions): Promise<CollabServerHandle> {
  const designPath = path.resolve(opts.design_path);
  const clients: SSEClient[] = [];

  // Write to live clients; drop dead/erroring ones in place so the array
  // never accumulates stale connections over a long-running session.
  function broadcast(event: string, data: string): void {
    const msg = `event: ${event}\ndata: ${data}\n\n`;
    for (let i = clients.length - 1; i >= 0; i--) {
      const c = clients[i];
      if (!c.alive) { clients.splice(i, 1); continue; }
      try { c.res.write(msg); } catch { clients.splice(i, 1); }
    }
  }

  let debounce: ReturnType<typeof setTimeout> | null = null;
  let watcher: fs.FSWatcher | null = null;
  if (fs.existsSync(designPath)) {
    watcher = fs.watch(designPath, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        try {
          const content = fs.readFileSync(designPath, 'utf-8');
          broadcast('design-changed', JSON.stringify({ content }));
        } catch { /* file may be mid-write */ }
      }, 50);
    });
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('event: connected\ndata: {}\n\n');
      const client: SSEClient = { res, alive: true };
      clients.push(client);
      req.on('close', () => {
        client.alive = false;
        const i = clients.indexOf(client);
        if (i >= 0) clients.splice(i, 1);
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/design') {
      try {
        const content = fs.readFileSync(designPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Design not found' }));
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/patch') {
      readBodyCapped(req, PATCH_MAX_BODY_BYTES).then(body => {
        const { content } = JSON.parse(body) as { content: string };
        fs.writeFileSync(designPath, content, 'utf-8');
        broadcast('patch-applied', JSON.stringify({ by: 'remote' }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch(err => {
        const tooLarge = err instanceof PayloadTooLargeError;
        res.writeHead(tooLarge ? 413 : 400);
        res.end(JSON.stringify({ error: tooLarge ? 'Payload too large' : 'Invalid patch' }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise(resolve => {
    server.listen(opts.port ?? 0, () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () => { if (debounce) clearTimeout(debounce); watcher?.close(); server.close(); },
      });
    });
  });
}
