// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { exportRoute, toolResultFrom, downloadUrl, type CallTool } from './server-export';

// Found by the user after Play all shipped: the editor could not export the video.

const PROJECTS = '/home/folio/projects';
const resolve = (rel: string): string | null => (rel.includes('..') ? null : `${PROJECTS}/${decodeURIComponent(rel)}`);
const post = (body: unknown): [Request, URL] => {
  const url = new URL('http://editor/__project_files/__export');
  return [new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), url];
};
const get = (p: string): [Request, URL] => { const url = new URL(`http://editor${p}`); return [new Request(url), url]; };
const deps = (callTool: CallTool): Parameters<typeof exportRoute>[2] => ({ projectsDir: PROJECTS, resolve, callTool });

describe('editor video export route', () => {
  it('starts the MCP background render, a deck as one piece', async () => {
    const call = vi.fn<CallTool>(async () => ({ success: true, job_id: 'exp_1', state: 'queued', frames: 957 }));
    const res = await exportRoute(...post({ design: 'promo/designs/promo.design.yaml', type: 'mp4', scenes: true }), deps(call));
    expect(res?.status).toBe(202);
    expect(await res?.json()).toEqual({ job_id: 'exp_1', state: 'queued', frames: 957 });
    expect(call).toHaveBeenCalledWith('animation', { op: 'export', design_path: `${PROJECTS}/promo/designs/promo.design.yaml`, type: 'mp4', background: true, scenes: true });
  });

  it('refuses a path outside the projects folder, a non-design file and an unknown type', async () => {
    const call = vi.fn<CallTool>(async () => ({ success: true }));
    for (const body of [{ design: '../etc/passwd.design.yaml', type: 'mp4' }, { design: 'p/notes.md', type: 'mp4' }, { design: 'p/d.design.yaml', type: 'avi' }]) {
      expect((await exportRoute(...post(body), deps(call)))?.status).toBe(400);
    }
    expect(call).not.toHaveBeenCalled();
  });

  it('passes an engine refusal through with its hint', async () => {
    const call: CallTool = async () => ({ success: false, error: 'scenes play as one file in gif, mp4 or webm', hint: 'Export type mp4' });
    const res = await exportRoute(...post({ design: 'p/d.design.yaml', type: 'gif', scenes: true }), deps(call));
    expect(res?.status).toBe(422);
    expect(await res?.json()).toMatchObject({ error: 'scenes play as one file in gif, mp4 or webm', hint: 'Export type mp4' });
  });

  it('reports progress, then the URL the editor downloads the file from', async () => {
    const running: CallTool = async () => ({ success: true, state: 'running', percent: 42, eta_ms: 9000, frames_done: 400, frames_total: 957 });
    const running_res = await exportRoute(...get('/__project_files/__export/status?job_id=exp_1'), deps(running));
    expect(await running_res?.json()).toMatchObject({ state: 'running', percent: 42, eta_ms: 9000 });
    const done: CallTool = async () => ({ success: true, state: 'done', output_path: `${PROJECTS}/promo/exports/folio-—-product-promo.mp4`, receipt: { bytes: 2372748 } });
    const body = await (await exportRoute(...get('/__project_files/__export/status?job_id=exp_1'), deps(done)))?.json();
    expect(body).toMatchObject({ state: 'done', percent: 100, bytes: 2372748, download: '/__project_files/promo/exports/folio-%E2%80%94-product-promo.mp4' });
  });

  it('answers 502 when the render server is down, and ignores every other path', async () => {
    const dead: CallTool = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:3333'); };
    const res = await exportRoute(...post({ design: 'p/d.design.yaml', type: 'mp4' }), deps(dead));
    expect(res?.status).toBe(502);
    expect(await exportRoute(...get('/__project_files/p/designs/d.design.yaml'), deps(dead))).toBeNull();
  });
});

describe('talking to the MCP server', () => {
  it('reads a tool result from plain JSON, from an SSE frame, and from an RPC error', () => {
    const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"success":true,"job_id":"exp_2"}' }] } });
    expect(toolResultFrom(rpc)).toEqual({ success: true, job_id: 'exp_2' });
    expect(toolResultFrom(`event: message\ndata: ${rpc}\n\n`)).toEqual({ success: true, job_id: 'exp_2' });
    expect(toolResultFrom('{"jsonrpc":"2.0","id":1,"error":{"message":"Unauthorized"}}')).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('never hands out a download outside the projects folder', () => {
    expect(downloadUrl(PROJECTS, '/etc/passwd')).toBeNull();
    expect(downloadUrl(PROJECTS, `${PROJECTS}/a b/exports/x.gif`)).toBe('/__project_files/a%20b/exports/x.gif');
  });
});
