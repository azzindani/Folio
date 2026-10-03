import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { measureRoute, type Readers } from './server-clip-measure';

let dir = '', calls: string[] = [];
const readers: Readers = {
  shots: async (f, a, b) => { calls.push(`shots ${path.basename(f)} ${a}-${b}`); return [1500, 4200]; },
  silences: async (f, a, b) => { calls.push(`silences ${path.basename(f)} ${a}-${b}`); return [[2000, 2600]]; },
};
const resolve = (rel: string): string | null => { const a = path.resolve(dir, rel); return a.startsWith(dir) ? a : null; };
const get = (q: string): [Request, URL] => [new Request(`http://x/__project_files/__clip/measure?${q}`), new URL(`http://x/__project_files/__clip/measure?${q}`)];
const design = (clip: string): string => `_protocol: design/v1\nmeta: {id: t, name: T, type: poster, created: '', modified: ''}\ndocument: {width: 100, height: 100, unit: px, dpi: 96}\nlayers:\n  - ${clip}\n`;

beforeEach(() => {
  calls = [];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-measure-'));
  fs.mkdirSync(path.join(dir, 'p', 'designs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'p', 'assets', 'video'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'p', 'assets', 'video', 'a.mp4'), 'not really a video');
  fs.writeFileSync(path.join(dir, 'p', 'designs', 'd.design.yaml'), design('{id: a, type: video, x: 0, y: 0, width: 100, height: 100, src: assets/video/a.mp4, in: 0, out: 5000, video: {offset_ms: 1000, duration_ms: 5000}}'));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('GET /__project_files/__clip/measure', () => {
  it('measures the part of the file the clip plays, shots and silences on the file clock', async () => {
    const [req, url] = get('design=p/designs/d.design.yaml&layer=a');
    const res = await measureRoute(req, url, { resolve, readers });
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true, from: 1000, to: 6000, shots: [1500, 4200], silences: [[2000, 2600]] });
    expect(calls).toEqual(['shots a.mp4 1000-6000', 'silences a.mp4 1000-6000']);
  });

  it('answers the same file again from the cache, and measures again when the file changes', async () => {
    const ask = async (): Promise<unknown> => { const [req, url] = get('design=p/designs/d.design.yaml&layer=a'); return (await measureRoute(req, url, { resolve, readers }))?.json(); };
    await ask(); await ask();
    expect(calls.length).toBe(2);
    const file = path.join(dir, 'p', 'assets', 'video', 'a.mp4');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    await ask();
    expect(calls.length).toBe(4);
  });

  it('a sound-less file still gives its shots', async () => {
    const [req, url] = get('design=p/designs/d.design.yaml&layer=a');
    const res = await measureRoute(req, url, { resolve, readers: { ...readers, silences: async () => { throw new Error('no audio'); } } });
    expect(await res?.json()).toMatchObject({ ok: true, shots: [1500, 4200], silences: [] });
  });

  it('refuses what it cannot measure, and says why', async () => {
    const run = async (q: string): Promise<{ status: number; body: Record<string, unknown> }> => {
      const [req, url] = get(q); const r = await measureRoute(req, url, { resolve, readers });
      return { status: r?.status ?? 0, body: await r?.json() as Record<string, unknown> };
    };
    expect((await run('design=../x.design.yaml&layer=a')).status).toBe(400);
    expect((await run('design=p/designs/d.design.yaml&layer=nope')).status).toBe(404);
    fs.writeFileSync(path.join(dir, 'p', 'designs', 'd.design.yaml'), design('{id: a, type: video, x: 0, y: 0, width: 1, height: 1, src: assets/video/gone.mp4, in: 0, video: {offset_ms: 0, duration_ms: 1000}}'));
    expect((await run('design=p/designs/d.design.yaml&layer=a')).body['error']).toContain('not in the project');
    fs.writeFileSync(path.join(dir, 'p', 'designs', 'd.design.yaml'), design('{id: a, type: video, x: 0, y: 0, width: 1, height: 1, src: assets/video/a.mp4, in: 0, video: {offset_ms: 0, duration_ms: 700000}}'));
    expect((await run('design=p/designs/d.design.yaml&layer=a')).body['hint']).toBe('Trim the clip first.');
  });

  it('is not its business for other paths or methods', async () => {
    expect(await measureRoute(new Request('http://x/__project_files/__clip', { method: 'POST' }), new URL('http://x/__project_files/__clip'), { resolve, readers })).toBeNull();
    expect(await measureRoute(new Request('http://x/__project_files/__clip/measure', { method: 'POST' }), new URL('http://x/__project_files/__clip/measure'), { resolve, readers })).toBeNull();
  });
});
