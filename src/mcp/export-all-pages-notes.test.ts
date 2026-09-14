import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { exportAnimation } from './engine-runtime-tools';

/**
 * `all_pages` must carry each page's quality up to the batch.
 *
 * It once reported unqualified success on a batch holding a 2fps page: the
 * single-page GIF route had cut the frame rate to fit a frame-memory budget and
 * said so in its `notes`, and the wrapper read only `success` and `output_path`.
 * That budget is gone — frames stream now — but a page can still come back
 * qualified (an fps the format cannot play is clamped, with a note) or choppy
 * (because a low fps was asked for), and both have to reach whoever exported
 * the batch.
 */

let root: string, designPath: string;

/** A layer whose LOOP stretches the scene far past its entrance. */
const looper = (id: string) => ({
  id, type: 'rect', x: 20, y: 20, width: 120, height: 80, z: 1, fill: '#46C08A',
  animation: {
    keyframes: [{ t: 0, opacity: 0.4 }, { t: 3000, opacity: 1 }],
    playback: { duration: 3000, loop: true, direction: 'alternate' },
  },
});

const quick = (id: string) => ({
  id, type: 'rect', x: 20, y: 20, width: 120, height: 80, z: 1, fill: '#46C08A',
  animation: {
    keyframes: [{ t: 0, opacity: 0, y: 20 }, { t: 400, opacity: 1, y: 0 }],
    playback: { duration: 400 },
  },
});

const bg = (id: string) => ({ id, type: 'rect', x: 0, y: 0, width: 320, height: 180, z: 0, fill: '#0F1412' });

let clamped: Record<string, unknown>;
let choppy: Record<string, unknown>;
let clean: Record<string, unknown>;

const run = async (extra: Record<string, unknown>): Promise<Record<string, unknown>> =>
  (await exportAnimation({
    design_path: designPath, type: 'gif', all_pages: true, ...extra,
  } as Parameters<typeof exportAnimation>[0])) as unknown as Record<string, unknown>;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-exp-'));
  fs.mkdirSync(path.join(root, 'p', 'designs'), { recursive: true });
  designPath = path.join(root, 'p', 'designs', 'deck.design.yaml');
  fs.writeFileSync(designPath, yaml.dump({
    _protocol: 'design/v1',
    meta: { id: 'd', name: 'deck', type: 'carousel', created: '2026-01-01', modified: '2026-01-01' },
    document: { width: 320, height: 180, unit: 'px', dpi: 96 },
    pages: [
      { id: 'fast', layers: [bg('b1'), quick('a')] },
      { id: 'slow', layers: [bg('b2'), looper('b')] },
    ],
  }));
  clamped = await run({ fps: 120, duration: 400 });
  choppy = await run({ fps: 4, duration: 1000 });
  clean = await run({ fps: 12, duration: 400 });
}, 180_000);
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('all_pages carries each page’s quality up', () => {
  it('reports the frame rate every page actually got', () => {
    expect(clamped['success']).toBe(true);
    expect(clamped['fps_per_page']).toEqual({ fast: 50, slow: 50 });
  });

  it('names the slowest page, not just the count of files', () => {
    expect(String(choppy['slowest_page'] ?? '')).toMatch(/^(fast|slow) at 4fps$/);
  });

  it('keeps the per-page notes the single-page route emits', () => {
    const notes = (clamped['page_notes'] as string[] | undefined) ?? [];
    expect(notes, `no clamp note survived: ${JSON.stringify(notes)}`).toHaveLength(2);
    expect(notes.every(n => /^(fast|slow): fps 120 .*exported at 50fps/.test(n)), 'notes lost their page').toBe(true);
  });

  it('warns about choppy pages and says what to change', () => {
    expect(String(choppy['warning'])).toContain('2 page(s)');
    expect(String(choppy['hint'])).toContain('fps 12');
  });

  it('still returns one path per page', () => {
    expect((clean['output_paths'] as string[]).length).toBe(2);
    expect(clean['pages']).toBe(2);
  });

  it('says nothing about choppiness when nothing is choppy', () => {
    expect(clean['warning']).toBeUndefined();
  });
});
