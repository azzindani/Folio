import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { exportAnimation } from './engine-runtime-tools';

/**
 * `all_pages` reported unqualified success on a batch containing a 2fps page.
 *
 * The single-page GIF route degrades the frame rate when a scene will not fit
 * the frame-memory budget, and it says so: "Sampled at 2fps instead of 20".
 * The all_pages wrapper read only `success` and `output_path` off each result
 * and threw the rest away, so exporting eight pages returned eight paths and
 * nothing else — while one of them was a flipbook.
 *
 * Found by exporting a real deck and measuring the GIFs afterwards, which is
 * not a thing the caller should have to do.
 */

let root: string, designPath: string;

/** A layer whose LOOP stretches the scene far past its entrance. */
const looper = (id: string) => ({
  id, type: 'rect', x: 20, y: 20, width: 200, height: 120, z: 1, fill: '#46C08A',
  animation: {
    keyframes: [{ t: 0, opacity: 0.4 }, { t: 3000, opacity: 1 }],
    playback: { duration: 3000, loop: true, direction: 'alternate' },
  },
});

const quick = (id: string) => ({
  id, type: 'rect', x: 20, y: 20, width: 200, height: 120, z: 1, fill: '#46C08A',
  animation: {
    keyframes: [{ t: 0, opacity: 0, y: 20 }, { t: 400, opacity: 1, y: 0 }],
    playback: { duration: 400 },
  },
});

const bg = (id: string) => ({ id, type: 'rect', x: 0, y: 0, width: 1920, height: 1080, z: 0, fill: '#0F1412' });

let shared: Record<string, unknown>;
let clean: Record<string, unknown>;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-exp-'));
  fs.mkdirSync(path.join(root, 'p', 'designs'), { recursive: true });
  designPath = path.join(root, 'p', 'designs', 'deck.design.yaml');
  fs.writeFileSync(designPath, yaml.dump({
    _protocol: 'design/v1',
    meta: { id: 'd', name: 'deck', type: 'carousel', created: '2026-01-01', modified: '2026-01-01' },
    document: { width: 1920, height: 1080, unit: 'px', dpi: 96 },
    pages: [
      { id: 'fast', layers: [bg('b1'), quick('a')] },
      { id: 'slow', layers: [bg('b2'), looper('b')] },
    ],
  }));
  shared = run();
  clean = run({ duration: 400, fps: 10 });
}, 180_000);
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const run = (extra: Record<string, unknown> = {}) => exportAnimation({
  design_path: designPath, type: 'gif', all_pages: true, fps: 30, ...extra,
} as Parameters<typeof exportAnimation>[0]) as unknown as Record<string, unknown>;

describe('all_pages carries each page’s quality up', () => {
  it('reports the frame rate every page actually got', () => {
    const r = shared;
    expect(r['success']).toBe(true);
    const per = r['fps_per_page'] as Record<string, number> | undefined;
    expect(per, 'the batch said nothing about frame rate').toBeDefined();
    expect(Object.keys(per ?? {})).toEqual(['fast', 'slow']);
  });

  it('names the slowest page, not just the count of files', () => {
    const r = shared;
    expect(String(r['slowest_page'] ?? '')).toMatch(/^(fast|slow) at \d+fps$/);
  });

  it('keeps the per-page notes the single-page route emits', () => {
    const r = shared;
    const notes = (r['page_notes'] as string[] | undefined) ?? [];
    // The looping page cannot fit 30fps, so its own route must have said so.
    expect(notes.some(n => /Sampled at \d+fps instead of 30/.test(n)),
      `no sampling note survived: ${JSON.stringify(notes)}`).toBe(true);
    expect(notes.every(n => /^(fast|slow): /.test(n)), 'notes lost their page').toBe(true);
  });

  it('still returns one path per page', () => {
    const r = shared;
    expect((r['output_paths'] as string[]).length).toBe(2);
    expect(r['pages']).toBe(2);
  });

  it('says nothing about choppiness when nothing is choppy', () => {
    // A short explicit duration fits the budget on both pages.
    expect(clean['warning']).toBeUndefined();
  });
});
