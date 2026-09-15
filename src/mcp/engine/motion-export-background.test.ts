import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { dispatchAnimation } from '../dispatch';
import type { ToolResult } from '../types';

// Driven through dispatch, the door a client uses — not the engine function.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-bgexport-'));
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

describe('animation op:export in the background', () => {
  it('background:true replies at once with a job, and op:export_status hands back the written file', async () => {
    const r = await call({ op: 'export', design_path: dPath, type: 'gif', background: true });
    expect(r, JSON.stringify(r)).toMatchObject({ success: true, background: true, frames: 6 });
    const id = String(r['job_id']);
    let s = await call({ op: 'export_status', job_id: id });
    for (let i = 0; i < 400 && (s['state'] === 'queued' || s['state'] === 'running'); i++) {
      await new Promise<void>(res => { setTimeout(res, 25); });
      s = await call({ op: 'export_status', job_id: id });
    }
    expect(s, JSON.stringify(s)).toMatchObject({ success: true, state: 'done' });
    expect((s['receipt'] as Record<string, unknown>)['frames']).toBe(6);
    expect(fs.statSync(String(r['output_path'])).size).toBeGreaterThan(0);
  });

  it('a short clip still renders in place, and a refusal comes straight back even with background:true', async () => {
    const r = await call({ op: 'export', design_path: dPath, type: 'gif' });
    expect(r['job_id']).toBeUndefined();
    expect(r).toMatchObject({ success: true, frames: 6 });
    const long = await call({ op: 'export', design_path: dPath, type: 'gif', background: true, duration: 90_000 });
    expect(long.success).toBe(false);
    expect(long['job_id']).toBeUndefined();
  });
});
