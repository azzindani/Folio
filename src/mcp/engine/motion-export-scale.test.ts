import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { dispatchAnimation } from '../dispatch';
import { decodeJsonStringArgs } from '../json-string-args';
import { variantName } from './motion-export-raster';
import type { ToolResult } from '../types';

// Asked for by the user after exporting from the editor: the full-size 12fps GIF
// stuttered, and neither GIF nor MP4 could be rendered smaller or at another fps.

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-scaleexport-'));
let dPath = '';
let n = 0;
beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({
    meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 160, height: 120 },
    layers: [{ id: 'dot', type: 'rect', z: 1, x: 40, y: 30, width: 80, height: 60, fill: '#E4572E',
      animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 500, opacity: 1 }], playback: { duration: 500 } } }],
  }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const call = async (a: Record<string, unknown>): Promise<ToolResult> => dispatchAnimation(a);

describe('animation op:export at a chosen size and fps', () => {
  it('renders a GIF at half size and 20fps, into a file of its own', async () => {
    const r = await call({ op: 'export', design_path: dPath, type: 'gif', scale: 0.5, fps: 20 });
    expect(r, JSON.stringify(r)).toMatchObject({ success: true, width: 80, height: 60, fps: 20, frames: 10 });
    expect(String(r['output_path']).endsWith(`exports${path.sep}d-80x60-20fps.gif`)).toBe(true);
    expect(fs.existsSync(String(r['output_path']))).toBe(true);
  }, 30_000);

  it('keeps the plain name for the defaults, clamps the scale, and decodes a string from a client', async () => {
    const plain = await call({ op: 'export', design_path: dPath, type: 'gif' });
    expect(String(plain['output_path']).endsWith(`exports${path.sep}d.gif`)).toBe(true);
    expect(await call({ op: 'export', design_path: dPath, type: 'gif', scale: 5 })).toMatchObject({ width: 160, height: 120 });
    expect(await call({ op: 'export', design_path: dPath, type: 'gif', scale: 0.01 })).toMatchObject({ width: 16, height: 12 });
    // A client that sends numbers as strings: the tool-call door decodes them by the registry schema.
    expect(await call(decodeJsonStringArgs('animation', { op: 'export', design_path: dPath, type: 'gif', scale: '0.5' }))).toMatchObject({ success: true, width: 80 });
  }, 30_000); // four real GIF renders: 5s timed out on a loaded Windows runner

  it('never joins a running full-size render: another size is another job', async () => {
    const full = await call({ op: 'export', design_path: dPath, type: 'gif', background: true });
    const half = await call({ op: 'export', design_path: dPath, type: 'gif', background: true, scale: 0.5 });
    expect(half['job_id']).not.toBe(full['job_id']);
    expect(half['output_path']).not.toBe(full['output_path']);
    expect(String(half['note'])).not.toContain('joined');
    // Let both renders finish: a job still writing when afterAll removes the temp dir fails the teardown on Windows.
    for (const id of [full['job_id'], half['job_id']]) {
      let s = await call({ op: 'export_status', job_id: String(id) });
      for (let i = 0; i < 400 && (s['state'] === 'queued' || s['state'] === 'running'); i++) {
        await new Promise<void>(res => { setTimeout(res, 25); });
        s = await call({ op: 'export_status', job_id: String(id) });
      }
      expect(s['state'], JSON.stringify(s)).toBe('done');
    }
  }, 30_000);

  it('names video variants the same way', () => {
    const doc = { width: 1920, height: 1080 };
    expect(variantName('promo', 'mp4', doc, {})).toBe('promo.mp4');
    expect(variantName('promo', 'mp4', doc, { fps: 30 })).toBe('promo.mp4');
    expect(variantName('promo', 'mp4', doc, { scale: 2 / 3, fps: 24 })).toBe('promo-1280x720-24fps.mp4');
    expect(variantName('promo', 'svg', doc, { scale: 0.5 })).toBe('promo.svg');
  });
});
