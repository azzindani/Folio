import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startCollabServer } from './collab-server';
import type { CollabServerHandle } from './collab-server';

let handle: CollabServerHandle | null = null;
let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-collab-')); });
afterEach(() => {
  handle?.close(); handle = null;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeDesign(dir: string): string {
  const p = path.join(dir, 'test.design.yaml');
  fs.writeFileSync(p, '_protocol: "design/v1"\nmeta:\n  name: Test\n');
  return p;
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = '';
      res.on('data', d => { body += String(d); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
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

describe('startCollabServer', () => {
  it('starts on a random port', async () => {
    const dPath = makeDesign(tmpDir);
    handle = await startCollabServer({ design_path: dPath, port: 0 });
    expect(handle.port).toBeGreaterThan(0);
  });

  it('starts even when design does not exist', async () => {
    handle = await startCollabServer({ design_path: path.join(tmpDir, 'missing.yaml'), port: 0 });
    expect(handle.port).toBeGreaterThan(0);
  });

  it('GET /design returns design content', async () => {
    const dPath = makeDesign(tmpDir);
    handle = await startCollabServer({ design_path: dPath, port: 0 });
    const r = await httpGet(`http://localhost:${handle.port}/design`);
    expect(r.status).toBe(200);
    expect(r.body).toContain('design/v1');
  });

  it('GET /design returns 404 when file missing', async () => {
    handle = await startCollabServer({ design_path: path.join(tmpDir, 'missing.yaml'), port: 0 });
    const r = await httpGet(`http://localhost:${handle.port}/design`);
    expect(r.status).toBe(404);
  });

  it('GET /unknown returns 404', async () => {
    const dPath = makeDesign(tmpDir);
    handle = await startCollabServer({ design_path: dPath, port: 0 });
    const r = await httpGet(`http://localhost:${handle.port}/unknownroute`);
    expect(r.status).toBe(404);
  });

  it('POST /patch writes updated content', async () => {
    const dPath = makeDesign(tmpDir);
    handle = await startCollabServer({ design_path: dPath, port: 0 });
    const newContent = '_protocol: "design/v1"\nmeta:\n  name: Updated\n';
    const r = await httpPost(
      `http://localhost:${handle.port}/patch`,
      JSON.stringify({ content: newContent }),
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
    expect(fs.readFileSync(dPath, 'utf-8')).toBe(newContent);
  });

  it('POST /patch returns 400 for invalid JSON', async () => {
    const dPath = makeDesign(tmpDir);
    handle = await startCollabServer({ design_path: dPath, port: 0 });
    const r = await httpPost(`http://localhost:${handle.port}/patch`, 'bad');
    expect(r.status).toBe(400);
  });

  it('GET /events returns SSE content-type', async () => {
    const dPath = makeDesign(tmpDir);
    handle = await startCollabServer({ design_path: dPath, port: 0 });
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`http://localhost:${handle!.port}/events`, res => {
        expect(res.headers['content-type']).toContain('text/event-stream');
        res.destroy();
        resolve();
      });
      req.on('error', (e) => { if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') resolve(); else reject(e); });
    });
  });

  it('OPTIONS returns 204', async () => {
    const dPath = makeDesign(tmpDir);
    handle = await startCollabServer({ design_path: dPath, port: 0 });
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
});
