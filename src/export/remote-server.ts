import * as http from 'http';
import { readBodyCapped, PayloadTooLargeError } from '../utils/http-body';

// Remote-clicker commands are tiny JSON ({type, slide?}); cap hard so a
// stray client can't buffer a large body into the heap.
const COMMAND_MAX_BODY_BYTES = Number(process.env['FOLIO_REMOTE_MAX_BODY_BYTES'] ?? 64 * 1024);

export interface RemoteServerHandle {
  port: number;
  close(): void;
}

export interface RemoteCommand {
  type: 'next' | 'prev' | 'goto' | 'start' | 'stop';
  slide?: number;
}

type SSEClient = { res: http.ServerResponse; alive: boolean };

/** Start SSE-based remote clicker server. Returns handle with port + close(). */
export function startRemoteServer(port = 0): Promise<RemoteServerHandle> {
  const clients: SSEClient[] = [];

  // Write to live clients; drop dead/erroring ones in place so the array
  // never accumulates stale connections.
  function broadcast(data: string): void {
    for (let i = clients.length - 1; i >= 0; i--) {
      const c = clients[i];
      if (!c.alive) { clients.splice(i, 1); continue; }
      try { c.res.write(`data: ${data}\n\n`); } catch { clients.splice(i, 1); }
    }
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
      res.write('data: {"type":"connected"}\n\n');
      const client: SSEClient = { res, alive: true };
      clients.push(client);
      req.on('close', () => {
        client.alive = false;
        const i = clients.indexOf(client);
        if (i >= 0) clients.splice(i, 1);
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/command') {
      readBodyCapped(req, COMMAND_MAX_BODY_BYTES).then(body => {
        const cmd = JSON.parse(body) as RemoteCommand;
        broadcast(JSON.stringify(cmd));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch(err => {
        const tooLarge = err instanceof PayloadTooLargeError;
        res.writeHead(tooLarge ? 413 : 400);
        res.end(JSON.stringify({ error: tooLarge ? 'Payload too large' : 'Invalid JSON' }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise(resolve => {
    server.listen(port, () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () => server.close(),
      });
    });
  });
}

/** Returns JS snippet to embed in presentation HTML for remote clicker. */
export function getClientScript(port: number): string {
  return `(function(){
  var es=new EventSource('http://localhost:${port}/events');
  es.onmessage=function(e){
    try{
      var cmd=JSON.parse(e.data);
      if(cmd.type==='next')window.__folioNext&&window.__folioNext();
      else if(cmd.type==='prev')window.__folioPrev&&window.__folioPrev();
      else if(cmd.type==='goto'&&typeof cmd.slide==='number')window.__folioGoto&&window.__folioGoto(cmd.slide);
      else if(cmd.type==='start')window.__folioStart&&window.__folioStart();
      else if(cmd.type==='stop')window.__folioStop&&window.__folioStop();
    }catch(ex){}
  };
})();`;
}
