import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { previewMotion } from './motion-preview';
import { decodePNG } from '../../utils/png-codec';

/**
 * op:preview on a paged design rendered blank cells from page 2 onward.
 *
 * `specAt` narrows `spec.pages` to the ONE page it posed, and framedSpec then
 * indexed that one-element array with the ORIGINAL page index — so anything
 * past the first page read `undefined` and fell through to an empty layer
 * list. The reply was entirely plausible: right scene length, right timecodes,
 * right pose count, six white squares.
 *
 * Page 1 worked, which is exactly why it shipped: the probe that verified the
 * feature used a single-page poster. op:frame and render_preview both read
 * index 0 after specAt; only this caller asked for the old index.
 */

let root: string, designPath: string;

const animatedRect = (id: string, x: number) => ({
  id, type: 'rect', x, y: 400, width: 300, height: 200, z: 1, fill: '#7C5CFF',
  animation: {
    keyframes: [{ t: 0, opacity: 0, y: 40 }, { t: 600, opacity: 1, y: 0 }],
    playback: { duration: 600 },
  },
});

/** Three pages; each carries a differently-placed animated block. */
const deck = () => ({
  _protocol: 'design/v1',
  meta: { id: 'd', name: 'deck', type: 'carousel', created: '2026-01-01', modified: '2026-01-01' },
  document: { width: 800, height: 800, unit: 'px', dpi: 96 },
  pages: [
    { id: 'one', layers: [{ id: 'bg1', type: 'rect', x: 0, y: 0, width: 800, height: 800, z: 0, fill: '#101010' }, animatedRect('a', 60)] },
    { id: 'two', layers: [{ id: 'bg2', type: 'rect', x: 0, y: 0, width: 800, height: 800, z: 0, fill: '#101010' }, animatedRect('b', 260)] },
    { id: 'three', layers: [{ id: 'bg3', type: 'rect', x: 0, y: 0, width: 800, height: 800, z: 0, fill: '#101010' }, animatedRect('c', 460)] },
  ],
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-pv-'));
  fs.mkdirSync(path.join(root, 'p', 'designs'), { recursive: true });
  designPath = path.join(root, 'p', 'designs', 'deck.design.yaml');
  fs.writeFileSync(designPath, yaml.dump(deck()));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** The inline filmstrip PNG the tool returns. */
function strip(pageId: string): Buffer {
  const r = previewMotion({ design_path: designPath, page_id: pageId, frames: 3, strip_only: true }) as
    unknown as { success: boolean; _attachments?: Array<{ type: string; data: string }> };
  expect(r.success, `preview failed for ${pageId}`).toBe(true);
  const img = (r._attachments ?? []).find(a => a.type === 'image');
  expect(img, `no filmstrip returned for ${pageId}`).toBeDefined();
  return Buffer.from(img?.data ?? '', 'base64');
}

/**
 * Did the PAGE draw, or is the cell an empty white square?
 *
 * Counts pixels of the page's own dark ground (#101010). The blank the bug
 * produced was white, and a white cell inside the strip's dark chrome still
 * makes a perfectly respectable-sized PNG — so file size proves nothing and an
 * earlier version of this test passed against the broken code.
 */
function groundPixels(png: Buffer): number {
  const { pixels } = decodePNG(png);
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] ?? 0, g = pixels[i + 1] ?? 0, b = pixels[i + 2] ?? 0;
    if (Math.abs(r - 0x10) < 10 && Math.abs(g - 0x10) < 10 && Math.abs(b - 0x10) < 10) n++;
  }
  return n;
}

const looksDrawn = (png: Buffer): boolean => groundPixels(png) > 500;

describe('op:preview on a paged design', () => {
  it('draws page 1 — the case that always worked', () => {
    expect(looksDrawn(strip('one'))).toBe(true);
  });

  it('draws pages 2 and 3, which came back blank', () => {
    for (const pid of ['two', 'three']) {
      expect(looksDrawn(strip(pid)), `page "${pid}" previewed blank`).toBe(true);
    }
  });

  it('renders each page DIFFERENTLY — not page 1 three times', () => {
    const [a, b, c] = [strip('one'), strip('two'), strip('three')];
    expect(a.equals(b), 'page 2 previewed identically to page 1').toBe(false);
    expect(b.equals(c), 'page 3 previewed identically to page 2').toBe(false);
  });

  it('still refuses a page id that does not exist', () => {
    const r = previewMotion({ design_path: designPath, page_id: 'nope' }) as unknown as
      { success: boolean; error?: string };
    expect(r.success).toBe(false);
    expect(r.error).toContain('Page not found');
  });
});
