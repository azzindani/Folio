import { describe, it, expect } from 'vitest';
import { isDeliberatePosterRatio, honorPosterRatio } from './poster-ratio';
import type { Layer } from '../schema/types';

describe('isDeliberatePosterRatio', () => {
  it('accepts standard portrait/square ratios', () => {
    expect(isDeliberatePosterRatio(1080, 1350)).toBe(true);  // 4:5
    expect(isDeliberatePosterRatio(1080, 1080)).toBe(true);  // 1:1
    expect(isDeliberatePosterRatio(1080, 1920)).toBe(true);  // 9:16
    expect(isDeliberatePosterRatio(1080, 1440)).toBe(true);  // 3:4
  });
  it('rejects landscape and non-standard ratios', () => {
    expect(isDeliberatePosterRatio(1920, 1080)).toBe(false); // landscape
    expect(isDeliberatePosterRatio(1080, 1800)).toBe(false); // 3:5 (the bug's output)
    expect(isDeliberatePosterRatio(1080, 1700)).toBe(false); // arbitrary
    expect(isDeliberatePosterRatio(0, 1350)).toBe(false);
  });
});

function poster(groupH: number): { group: Layer } {
  const group = {
    id: 'sections_1', type: 'group', z: 1, x: 0, y: 0, width: 1080, height: groupH,
    layers: [
      { id: 'sections_1_bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: groupH, fill: { type: 'solid', color: '#FAF5EC' } },
      { id: 'sections_1_title', type: 'text', z: 1, x: 80, y: 100, width: 900, height: 120, content: { type: 'plain', value: 'Hi' }, style: { font_size: 80 } },
      { id: 'sections_1_body', type: 'text', z: 2, x: 80, y: 300, width: 900, height: 400, content: { type: 'plain', value: 'Body' }, style: { font_size: 28 } },
    ],
  } as unknown as Layer;
  return { group };
}

describe('honorPosterRatio', () => {
  it('grows a tall 4:5 poster sideways and scales content to fill (no dead margins, bg fills)', () => {
    const { group } = poster(1800);
    const res = honorPosterRatio(group, [], 1080, 1350); // 4:5 requested, content 1080x1800
    expect(res).toEqual({ width: 1440, height: 1800 });   // 1440/1800 === 4/5
    const g = group as unknown as Record<string, unknown>;
    expect([g['width'], g['height']]).toEqual([1440, 1800]);
    const kids = g['layers'] as Record<string, unknown>[];
    const bg = kids.find(k => k['id'] === 'sections_1_bg')!;
    expect([bg['x'], bg['y'], bg['width'], bg['height']]).toEqual([0, 0, 1440, 1800]); // stretched to fill
    const sx = 1440 / 1080; // 1.333…
    const title = kids.find(k => k['id'] === 'sections_1_title')!;
    // x AND width scale horizontally → the text area fills the widened canvas
    // with the SAME proportional margin (80→107), not a centered 900-wide column
    // stranded with ~260px dead bands on each side.
    expect(title['x']).toBe(Math.round(80 * sx));      // 107
    expect(title['width']).toBe(Math.round(900 * sx)); // 1200 — text area = canvas − margin
    // right margin stays proportional & small (≈ left), not the old 280px gap
    expect(1440 - (Number(title['x']) + Number(title['width']))).toBeLessThan(140);
    expect(title['y']).toBe(100); // vertical layout untouched (y unchanged)
    expect((title['style'] as Record<string, unknown>)['font_size']).toBe(80); // font NOT scaled
  });

  it('returns null when content FITS the requested height (legacy content-fit / sage-block keeps charge)', () => {
    const { group } = poster(1200);
    expect(honorPosterRatio(group, [], 1080, 1350)).toBeNull(); // gh (1200) ≤ reqH (1350)
    // group untouched
    expect((group as unknown as Record<string, unknown>)['height']).toBe(1200);
  });

  it('returns null for a non-standard ratio (legacy content-fit stays in charge)', () => {
    const { group } = poster(1800);
    expect(honorPosterRatio(group, [], 1080, 1700)).toBeNull();
  });

  it('bails when the preset uses relative (auto_layout) children', () => {
    const group = {
      id: 'feature_grid_1', type: 'group', z: 1, x: 0, y: 0, width: 1080, height: 1800,
      layers: [{ id: 'row', type: 'auto_layout', z: 0, x: 0, y: 0, width: 1080, height: 400, layers: [] }],
    } as unknown as Layer;
    expect(honorPosterRatio(group, [], 1080, 1350)).toBeNull();
  });
});
