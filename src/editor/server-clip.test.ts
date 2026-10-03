import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { clipArgs, clipRoute } from './server-clip';

describe('clipArgs — what the editor may ask the engine', () => {
  const abs = '/p/x/designs/d.design.yaml';
  it('a freeze needs where (scene ms) and how long; nothing else is passed through', () => {
    expect(clipArgs({ layer_id: 'a', freeze: { at: 2000, duration_ms: 800, evil: 1 } }, abs)).toEqual({ op: 'video', design_path: abs, layer_id: 'a', freeze: { at: 2000, duration_ms: 800 } });
    expect(clipArgs({ layer_id: 'a', freeze: { at: 'later', duration_ms: 800 } }, abs)).toContain('freeze needs');
  });
  it('on_beats is true or the four options the engine reads — and exactly one of the two ops', () => {
    expect(clipArgs({ layer_id: 'a', page_id: 'p1', on_beats: true }, abs)).toMatchObject({ page_id: 'p1', on_beats: true });
    expect(clipArgs({ layer_id: 'a', on_beats: { every: 4, end: false, audio_id: 'x', max_shift_ms: 200 } }, abs)).toMatchObject({ on_beats: { every: 4, end: false, max_shift_ms: 200 } });
    expect((clipArgs({ layer_id: 'a', on_beats: { every: 4, audio_id: 'x' } }, abs) as { on_beats: object }).on_beats).not.toHaveProperty('audio_id');
    expect(clipArgs({ layer_id: 'a' }, abs)).toContain('exactly one');
    expect(clipArgs({ layer_id: 'a', freeze: { at: 1, duration_ms: 1 }, on_beats: true }, abs)).toContain('exactly one');
    expect(clipArgs({ freeze: { at: 1, duration_ms: 1 } }, abs)).toContain('layer_id');
  });
});

describe('the /__project_files/__clip route', () => {
  let dir = '', file = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-clip-route-'));
    fs.mkdirSync(path.join(dir, 'p', 'designs'), { recursive: true });
    file = path.join(dir, 'p', 'designs', 'd.design.yaml');
    fs.writeFileSync(file, 'before: 1\n');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const resolve = (rel: string): string | null => { const a = path.resolve(dir, rel); return a.startsWith(dir) ? a : null; };
  const post = (body: unknown, method = 'POST', p = '/__project_files/__clip'): [Request, URL] => [new Request(`http://x${p}`, { method, body: method === 'POST' ? JSON.stringify(body) : undefined }), new URL(`http://x${p}`)];
  const ok = { design: 'p/designs/d.design.yaml', layer_id: 'a', freeze: { at: 1000, duration_ms: 500 } };

  it('hands the request to animation(op:video) and answers with the file the engine wrote', async () => {
    let seen: Record<string, unknown> = {};
    const [req, url] = post(ok);
    const res = await clipRoute(req, url, { resolve, callTool: async (name, args) => { seen = { name, ...args }; fs.writeFileSync(file, 'after: 2\n'); return { success: true, clips: [{ id: 'a' }], hold_ms: 500, secret: 'no' }; } });
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true, content: 'after: 2\n', result: { clips: [{ id: 'a' }], hold_ms: 500 } });
    expect(seen).toMatchObject({ name: 'animation', op: 'video', design_path: file, layer_id: 'a', freeze: { at: 1000, duration_ms: 500 } });
  });
  it('is no other route: another path or method is left to the server', async () => {
    expect(await clipRoute(...post(ok, 'GET'), { resolve })).toBeNull();
    expect(await clipRoute(...post(ok, 'POST', '/__project_files/__export'), { resolve })).toBeNull();
  });
  it('refuses a path outside the projects folder, a non-design, a missing file and a bad request', async () => {
    for (const design of ['../../etc/passwd.design.yaml', 'p/designs/d.yaml', 'p/designs/none.design.yaml']) {
      expect((await clipRoute(...post({ ...ok, design }), { resolve }))?.status).toBe(400);
    }
    expect((await clipRoute(...post({ design: ok.design, layer_id: 'a' }), { resolve }))?.status).toBe(400);
  });
  it('carries the engine\'s refusal as a 422 and a dead engine as a 502, leaving the file alone', async () => {
    const refused = await clipRoute(...post(ok), { resolve, callTool: async () => ({ success: false, error: 'not while "a" plays', hint: 'pick a moment inside' }) });
    expect(refused?.status).toBe(422);
    expect(await refused?.json()).toEqual({ ok: false, error: 'not while "a" plays', hint: 'pick a moment inside' });
    const dead = await clipRoute(...post(ok), { resolve, callTool: async () => { throw new Error('ECONNREFUSED'); } });
    expect(dead?.status).toBe(502);
    expect(fs.readFileSync(file, 'utf8')).toBe('before: 1\n');
  });
});
