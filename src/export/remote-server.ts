import * as http from 'http';

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

  function broadcast(data: string): void {
    for (const c of clients) {
      if (c.alive) {
        try { c.res.write(`data: ${data}\n\n`); } catch { c.alive = false; }
      }
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
      req.on('close', () => { client.alive = false; });
      return;
    }

    if (req.method === 'POST' && req.url === '/command') {
      let body = '';
      req.on('data', chunk => { body += String(chunk); });
      req.on('end', () => {
        try {
          const cmd = JSON.parse(body) as RemoteCommand;
          broadcast(JSON.stringify(cmd));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
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
