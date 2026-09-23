import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import * as yaml from 'js-yaml';
import { setScene, sceneTimeline } from './motion-scene-op';
import { renderFrame } from './motion-frame';
import { exportAnimation } from './motion-export';

const hasFfmpeg = ((): boolean => { try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true; } catch { return false; } })();

let dir = '', design = '';
const ground = (fill: string): unknown => ({ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 120, height: 80, fill });
const mover = (): unknown => ({
  id: 'dot', type: 'rect', z: 1, x: 10, y: 30, width: 20, height: 20, fill: '#FFFFFF',
  animation: { keyframes: [{ t: 0, x: 0 }, { t: 500, x: 60 }], playback: { duration: 500, origin: 'offset' } },
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-scene-'));
  fs.mkdirSync(path.join(dir, 'p', 'designs'), { recursive: true });
  design = path.join(dir, 'p', 'designs', 'piece.design.yaml');
  fs.writeFileSync(design, yaml.dump({
    _protocol: 'design/v1',
    meta: { id: 'd', name: 'piece', type: 'carousel', created: '2026-01-01', modified: '2026-01-01' },
    document: { width: 120, height: 80, unit: 'px', dpi: 96 },
    pages: [
      { id: 'a', layers: [ground('#FF0000'), mover()] },
      { id: 'b', layers: [ground('#0000FF'), mover()] },
      { id: 'c', layers: [ground('#00AA00')] },
    ],
  }));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const saved = (): Array<Record<string, unknown>> => (yaml.load(fs.readFileSync(design, 'utf8')) as { pages: Array<Record<string, unknown>> }).pages;

describe('animation(op:scene)', () => {
  it('writes how a page enters and how long it stays, and answers with the plan', () => {
    const r = setScene({ design_path: design, page_id: 'b', transition: { type: 'wipe-left', duration: 300 }, length_ms: 2000 });
    expect(r.success).toBe(true);
    expect(saved()[1]).toMatchObject({ transition: { type: 'wipe-left', duration: 300 }, auto_advance: 2000 });
    expect(r['scenes']).toEqual([
      { page_id: 'a', start_ms: 0, length_ms: 2000, transition: 'cut' },
      { page_id: 'b', start_ms: 2000, length_ms: 2000, transition: 'wipe-left 300ms' },
      { page_id: 'c', start_ms: 4000, length_ms: 1500, transition: 'cut' },
    ]);
  });

  it('takes a bare type name, and clears with none and length 0', () => {
    setScene({ design_path: design, page_id: 'b', transition: 'fade', length_ms: 900 });
    expect(saved()[1]['transition']).toEqual({ type: 'fade' });
    setScene({ design_path: design, page_id: 'b', transition: 'none', length_ms: 0 });
    expect(saved()[1]).not.toHaveProperty('transition');
    expect(saved()[1]).not.toHaveProperty('auto_advance');
  });

  it('refuses an unknown transition without touching the file', () => {
    const before = fs.readFileSync(design, 'utf8');
    const r = setScene({ design_path: design, page_id: 'b', transition: 'spiral' });
    expect(r.success).toBe(false);
    expect(String(r['error'])).toContain('spiral');
    expect(fs.readFileSync(design, 'utf8')).toBe(before);
  });

  it('accepts a transition sent as a JSON string through the real tool handler', async () => {
    // The live failure: a client with a stale tool list stringified the object,
    // and the op read the whole string as a transition name.
    const { ALL_HANDLERS } = await import('../handlers');
    const r = await ALL_HANDLERS['animation']({
      op: 'scene', design_path: design, page_id: 'b', transition: '{"type": "slide-left", "duration": 500}',
    });
    expect(r.success).toBe(true);
    expect(saved()[1]['transition']).toEqual({ type: 'slide-left', duration: 500 });
    // The first import of the whole handler graph is most of this test (3.9 s alone on a loaded host):
    // under a full parallel run it crossed the 5 s default without anything being wrong.
  }, 20_000);

  it('says a transition on the first page never plays', () => {
    const r = setScene({ design_path: design, page_id: 'a', transition: 'fade' });
    expect((r['notes'] as string[]).join(' ')).toMatch(/first scene/);
  });
});

describe('scenes across timeline, frame and export', () => {
  // benchmark r1: a single-page looping GIF asked op:scene for its length.
  it('takes the only page without page_id, and says a still page-less piece has no length to set', () => {
    const dir = path.dirname(design);
    const one = path.join(dir, 'one.design.yaml');
    fs.writeFileSync(one, yaml.dump({ meta: { id: 'o', name: 'O', type: 'carousel' }, document: { width: 64, height: 64 }, pages: [{ id: 'only', layers: [] }] }));
    const r = setScene({ design_path: one, length_ms: 4000 });
    expect(r, JSON.stringify(r)).toMatchObject({ success: true, page_id: 'only', length_ms: 4000 });
    const poster = path.join(dir, 'poster.design.yaml');
    fs.writeFileSync(poster, yaml.dump({ meta: { id: 'p', name: 'P', type: 'poster' }, document: { width: 64, height: 64 }, layers: [] }));
    const none = setScene({ design_path: poster, length_ms: 4000 });
    expect(none.success).toBe(false);
    expect(String(none.error)).toContain('Nothing here moves');
  });

  // benchmark r6 b21: an 8 s loop whose motion ends at 7.6 s had no way to last 8 s.
  it('makes a page-less piece last length_ms by holding its tracks, never cutting motion, and 0 takes it back', () => {
    const sting = path.join(path.dirname(design), 'sting.design.yaml');
    const late = { ...(mover() as object), id: 'late', animation: { keyframes: [{ t: 0, x: 0 }, { t: 600, x: 20 }], playback: { duration: 600, delay: 1000, origin: 'offset' } } };
    fs.writeFileSync(sting, yaml.dump({ _protocol: 'design/v1', meta: { id: 's', name: 'S', type: 'poster' }, document: { width: 64, height: 64 }, layers: [ground('#000000'), mover(), late] }));
    const tracks = (): Record<string, number> => Object.fromEntries(((yaml.load(fs.readFileSync(sting, 'utf8')) as { layers: Array<{ id: string; animation?: { playback: { duration: number } } }> }).layers)
      .filter(l => l.animation).map(l => [l.id, l.animation?.playback.duration ?? 0]));
    const r = setScene({ design_path: sting, length_ms: 2000 });
    expect(r, JSON.stringify(r)).toMatchObject({ success: true, scene_ms: 2000, tracks_held: 2 });
    expect(tracks()).toEqual({ dot: 2000, late: 1000 });
    const cut = setScene({ design_path: sting, length_ms: 1200 });
    expect(String(cut.error)).toMatch(/late still moves until 1600 ms/);
    expect(setScene({ design_path: sting, length_ms: 0 })).toMatchObject({ success: true, scene_ms: 1600 });
    expect(tracks()).toEqual({ dot: 500, late: 600 });
    expect(setScene({ design_path: sting, transition: 'fade' }).success).toBe(false);
  });

  it('timeline lays out every scene and marks the transitions', () => {
    setScene({ design_path: design, page_id: 'b', transition: 'fade' });
    const r = sceneTimeline({ design_path: design });
    expect(r['total_ms']).toBe(5500);
    expect(String(r['ascii'])).toContain('▒');
  });

  it('frame renders a moment mid-transition and says which', () => {
    setScene({ design_path: design, page_id: 'b', transition: { type: 'fade', duration: 400 } });
    const r = renderFrame({ design_path: design, scenes: true, t: 2200 });
    expect(r).toMatchObject({ success: true, scene: { page_id: 'b', local_ms: 200 }, transition: { type: 'fade', from: 'a', progress: 0.5 } });
    expect(r['_attachments']).toHaveLength(1);
  });

  it('export plays every page as one gif and lists the scenes', async () => {
    setScene({ design_path: design, page_id: 'b', transition: { type: 'slide-left', duration: 300 } });
    const r = await exportAnimation({ design_path: design, type: 'gif', scenes: true, fps: 10 });
    expect(r).toMatchObject({ success: true, duration: 5500, frames: 55 });
    expect(r['scenes']).toHaveLength(3);
    expect(fs.readFileSync(String(r['output_path'])).subarray(0, 6).toString('ascii')).toBe('GIF89a');
  }, 60_000);

  it('refuses scenes with all_pages and as svg, and says when only page 1 was exported', async () => {
    expect((await exportAnimation({ design_path: design, type: 'gif', scenes: true, all_pages: true })).success).toBe(false);
    expect(String((await exportAnimation({ design_path: design, type: 'svg', scenes: true }))['hint'])).toContain('mp4');
    const one = await exportAnimation({ design_path: design, type: 'gif', fps: 5 });
    expect((one['notes'] as string[]).join(' ')).toContain('scenes:true');
  }, 60_000);

  it.skipIf(!hasFfmpeg)('an mp4 of the piece has one frame per sample of every scene', async () => {
    const r = await exportAnimation({ design_path: design, type: 'mp4', scenes: true, fps: 10 });
    expect(r).toMatchObject({ success: true, frames: 55 });
    const n = execSync(`ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "${String(r['output_path'])}"`).toString().trim();
    expect(n).toBe('55');
  }, 60_000);
});
