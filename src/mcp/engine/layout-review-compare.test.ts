import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { noteKind, compareSnapshots, rememberReview, memoryPath, type Snapshot } from './layout-review-compare';
import type { PageLayout } from './layout-review';
import { diagnoseDesign } from '../engine-export-tools';
import { moveLayers } from '../engine-transform-tools';

const page = (o: Partial<PageLayout>): PageLayout => ({
  canvas: '1920×1080', ink: 0.1, occupied: 0.3, content_box: null, empty: [], balance: null, thirds: [], components: [], type_scale: null, notes: [], ...o,
});

describe('noteKind', () => {
  it('names what a note is about, whatever its numbers', () => {
    expect(noteKind('52% of the canvas is one empty area: x 0–1800, y 360–960.')).toBe('empty_area');
    expect(noteKind('Visual weight sits 19% left of centre (left/right 82/18).')).toBe('weight_across');
    expect(noteKind('Visual weight sits 8% below centre (top/bottom 41/59).')).toBe('weight_down');
    expect(noteKind('"hero" (image) covers 54% of the canvas.')).toBe('oversized:hero');
    expect(noteKind('Could not render this to measure it.')).toBeNull();
  });
});

describe('compareSnapshots', () => {
  it('reports the moves and which notes went away or appeared', () => {
    const before: Snapshot = { ink: 0.1, occupied: 0.3, empty_max: 0.5, weight_off: 0.25, kinds: ['empty_area', 'weight_across'] };
    const now: Snapshot = { ink: 0.18, occupied: 0.55, empty_max: 0.12, weight_off: 0.03, kinds: ['oversized:hero'] };
    expect(compareSnapshots(before, now)).toEqual({ ink: 0.08, occupied: 0.25, empty_max: -0.38, weight_off: -0.22, resolved: ['empty_area', 'weight_across'], new: ['oversized:hero'] });
  });
});

describe('rememberReview + the revise loop', () => {
  let tmp: string;
  let fp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-compare-'));
    fs.mkdirSync(path.join(tmp, 'designs'), { recursive: true });
    fp = path.join(tmp, 'designs', 'd.design.yaml');
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('says nothing the first time, then compares; other pages keep their baseline', () => {
    expect(rememberReview(fp, [page({ page: 'a', ink: 0.1 }), page({ page: 'b' })])).toBeNull();
    const d = rememberReview(fp, [page({ page: 'a', ink: 0.3 })]);
    expect(d?.['a']?.ink).toBe(0.2);
    const kept = JSON.parse(fs.readFileSync(memoryPath(fp), 'utf8')) as { pages: Record<string, unknown> };
    expect(Object.keys(kept.pages).sort()).toEqual(['a', 'b']);
  });

  it('a move to the centre shows up as the weight note resolved', () => {
    fs.writeFileSync(fp, `_protocol: design/v1\nmeta:\n  name: T\n  type: poster\ndocument:\n  width: 1920\n  height: 1080\n  unit: px\n  dpi: 96\nlayers:
  - { id: bg, type: rect, x: 0, 'y': 0, width: 1920, height: 1080, z: 0, fill: { type: solid, color: '#ffffff' } }
  - { id: card, type: rect, x: 1300, 'y': 300, width: 500, height: 400, z: 1, fill: { type: solid, color: '#1f2937' } }
`);
    type R = { review?: PageLayout[]; since_last?: Record<string, { weight_off: number; resolved: string[] }> };
    const first = diagnoseDesign({ design_path: fp, review: true }) as unknown as R;
    expect(first.since_last).toBeUndefined();
    expect(first.review?.[0]?.notes.some(n => n.includes('right of centre'))).toBe(true);
    moveLayers({ design_path: fp, layer_id: 'card', to: 'center' });
    const second = diagnoseDesign({ design_path: fp, review: true }) as unknown as R;
    expect(second.since_last?.['page']?.resolved).toContain('weight_across');
    expect(second.since_last?.['page']?.weight_off ?? 0).toBeLessThan(-0.2);
  }, 30_000);

  it('measures a stored image as ink — a photo is not empty space', () => {
    // Found live: the review rendered without resolving assets, so every photo
    // drew nothing and an FHD slide's hero image read as "56% empty".
    fs.mkdirSync(path.join(tmp, 'assets', 'images'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'assets', 'images', 'block.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#111827"/></svg>');
    fs.writeFileSync(fp, `_protocol: design/v1\nmeta:\n  name: T\n  type: poster\ndocument:\n  width: 1920\n  height: 1080\n  unit: px\n  dpi: 96\nlayers:
  - { id: bg, type: rect, x: 0, 'y': 0, width: 1920, height: 1080, z: 0, fill: { type: solid, color: '#ffffff' } }
  - { id: hero, type: image, x: 960, 'y': 0, width: 960, height: 1080, z: 1, src: assets/images/block.svg, fit: cover }
`);
    const r = diagnoseDesign({ design_path: fp, project_path: tmp, review: true }) as unknown as { review?: PageLayout[] };
    const p = r.review?.[0];
    expect(p?.balance?.left_right[1] ?? 0).toBeGreaterThan(90);
    expect(p?.empty[0]?.x ?? 999).toBeLessThan(100);
    expect(p?.empty[0]?.width ?? 0).toBeLessThanOrEqual(980);
  }, 30_000);
});
