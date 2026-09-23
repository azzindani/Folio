import { describe, it, expect } from 'vitest';
import type { Layer } from '../../schema/types';
import { poseAffine, compose, mapBox, IDENTITY } from './layout-pose';
import { components, layoutNotes } from './layout-review';
import { noteKind } from './layout-review-compare';

const posed = (l: Record<string, unknown>, pose: Record<string, number>): Layer =>
  ({ ...l, _frame_pose: { dx: 0, dy: 0, rotation: 0, scale_x: 1, scale_y: 1, skew_x: 0, skew_y: 0, ...pose } }) as unknown as Layer;

describe('poseAffine', () => {
  it('is null at rest, a shift for an offset, and a scale about the anchor', () => {
    expect(poseAffine({ id: 'a', type: 'rect', x: 0, y: 0, width: 10, height: 10 } as Layer)).toBeNull();
    expect(poseAffine(posed({ id: 'a', type: 'rect', x: 0, y: 0, width: 10, height: 10 }, { dx: 5, dy: -3 }))).toEqual({ sx: 1, sy: 1, tx: 5, ty: -3 });
    // ×2 about the centre (50,50) of a 100×100 box keeps the centre still.
    const a = poseAffine(posed({ id: 'a', type: 'rect', x: 0, y: 0, width: 100, height: 100 }, { scale_x: 2, scale_y: 2 }));
    expect(a && mapBox(a, { x: 50, y: 50, w: 0, h: 0 })).toMatchObject({ x: 50, y: 50 });
  });

  it('composes outer after inner', () => {
    const c = compose({ sx: 2, sy: 2, tx: 10, ty: 0 }, { sx: 1, sy: 1, tx: 5, ty: 5 });
    expect(mapBox(c, { x: 0, y: 0, w: 10, h: 10 })).toEqual({ x: 20, y: 10, w: 20, h: 20 });
    expect(compose(IDENTITY, c)).toEqual(c);
  });
});

describe('components under a camera', () => {
  it('measures a world child where the camera puts it on screen', () => {
    const world = posed({ id: '__camera', type: 'group', x: 0, y: 0, width: 4000, height: 1080, layers: [
      { id: 'far', type: 'image', x: 2000, y: 200, width: 600, height: 400 },
    ] }, { dx: -1800 });
    const c = components([world], 1920, 1080, new Set());
    expect(c.map(x => [x.id, x.box.x, x.box.y])).toEqual([['far', 200, 200]]);
  });
});

describe('edge notes', () => {
  const page = (comps: Array<{ id: string; type: string; x: number; w: number }>): Parameters<typeof layoutNotes>[0] => ({
    canvas: '1920×1080', ink: 0.2, occupied: 0.5, content_box: null, empty: [], balance: null, thirds: [], type_scale: null,
    components: comps.map(c => ({ id: c.id, type: c.type, box: { x: c.x, y: 100, width: c.w, height: 300 }, share: { w: c.w / 1920, h: 0.28, area: (c.w * 300) / (1920 * 1080) } })),
  });

  it('says an image or a card row runs edge to edge or is cut — never a text box, which is not its ink', () => {
    const notes = layoutNotes(page([
      { id: 'row', type: 'auto_layout', x: 20, w: 1880 },
      { id: 'photo', type: 'image', x: 1500, w: 700 },
      { id: 'headline', type: 'text', x: -40, w: 2000 },
    ]));
    expect(notes).toContain('"row" (auto_layout) runs edge to edge: 1880 of 1920 px wide.');
    expect(notes.some(n => n.startsWith('"photo" (image) is cut by the canvas edge'))).toBe(true);
    expect(notes.some(n => n.includes('headline'))).toBe(false);
    expect(notes.map(noteKind)).toEqual(expect.arrayContaining(['edge_to_edge:row', 'cut_by_edge:photo']));
  });
});
