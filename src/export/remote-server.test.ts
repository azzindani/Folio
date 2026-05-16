import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { startRemoteServer, getClientScript } from './remote-server';
import type { RemoteServerHandle } from './remote-server';

let handle: RemoteServerHandle | null = null;
afterEach(() => { handle?.close(); handle = null; });

function httpGet(url: string): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = '';
      res.on('data', d => { body += String(d); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers as Record<string, string> }));
    });
    req.on('error', reject);
    req.setTimeout(500, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(url: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: Number(u.port), path: u.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = http.request(opts, res => {
      let out = '';
      res.on('data', d => { out += String(d); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: out }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

describe('startRemoteServer', () => {
  it('starts on a random port', async () => {
    handle = await startRemoteServer(0);
    expect(handle.port).toBeGreaterThan(0);
  });

  it('returns 200 for unknown routes with 404', async () => {
    handle = await startRemoteServer(0);
    const r = await httpGet(`http://localhost:${handle.port}/unknown`);
    expect(r.status).toBe(404);
  });

  it('OPTIONS returns 204', async () => {
    handle = await startRemoteServer(0);
    await new Promise<void>((resolve, reject) => {
      const opts = {
        hostname: 'localhost', port: handle!.port, path: '/events',
        method: 'OPTIONS',
      };
      const req = http.request(opts, res => {
        expect(res.statusCode).toBe(204);
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  });

  it('POST /command returns ok:true for valid JSON', async () => {
    handle = await startRemoteServer(0);
    const r = await httpPost(`http://localhost:${handle.port}/command`, JSON.stringify({ type: 'next' }));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
  });

  it('POST /command returns 400 for invalid JSON', async () => {
    handle = await startRemoteServer(0);
    const r = await httpPost(`http://localhost:${handle.port}/command`, 'not-json');
    expect(r.status).toBe(400);
  });

  it('GET /events returns SSE headers', async () => {
    handle = await startRemoteServer(0);
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`http://localhost:${handle!.port}/events`, res => {
        expect(res.headers['content-type']).toContain('text/event-stream');
        res.destroy();
        resolve();
      });
      req.on('error', (e) => { if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') resolve(); else reject(e); });
    });
  });

  it('CORS headers are present', async () => {
    handle = await startRemoteServer(0);
    const r = await httpPost(`http://localhost:${handle.port}/command`, JSON.stringify({ type: 'prev' }));
    expect(r.status).toBe(200);
  });
});

describe('getClientScript', () => {
  it('returns a string containing EventSource', () => {
    const s = getClientScript(3737);
    expect(s).toContain('EventSource');
  });

  it('embeds the port number', () => {
    const s = getClientScript(9999);
    expect(s).toContain('9999');
  });

  it('contains all command types', () => {
    const s = getClientScript(3737);
    expect(s).toContain('next');
    expect(s).toContain('prev');
    expect(s).toContain('goto');
    expect(s).toContain('start');
    expect(s).toContain('stop');
  });

  it('calls window.__folioNext', () => {
    expect(getClientScript(3737)).toContain('__folioNext');
  });
});
