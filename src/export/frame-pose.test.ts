import { describe, it, expect } from 'vitest';
import { poseTransform, REST_POSE } from './frame-pose';
import type { Layer } from '../schema/types';

const box = { id: 'b', type: 'rect', z: 1, x: 100, y: 100, width: 200, height: 100 } as unknown as Layer;

describe('poseTransform', () => {
  it('is empty at rest', () => {
    expect(poseTransform(box, REST_POSE)).toBe('');
  });

  it('translates by the offset alone when nothing pivots', () => {
    expect(poseTransform(box, { ...REST_POSE, dx: 12, dy: -8.5 })).toBe('translate(12 -8.5)');
  });

  it('scales about the anchor of the drawn box — bottom for a bar growing up', () => {
    expect(poseTransform(box, { ...REST_POSE, scale_y: 0.5 }, 'bottom'))
      .toBe('translate(200 200) scale(1 0.5) translate(-200 -200)');
  });

  it('composes in CSS order: offset, then rotate, skew, scale about the pivot', () => {
    const t = poseTransform(box, { ...REST_POSE, dx: 10, rotation: 90, skew_x: 45, scale_x: 2, scale_y: 2 });
    expect(t).toBe('translate(10 0) translate(200 150) rotate(90) matrix(1 0 1 1 0 0) scale(2 2) translate(-200 -150)');
  });

  it('still translates a layer whose box cannot be measured', () => {
    const unknown = { id: 'u', type: 'rect', z: 1 } as unknown as Layer;
    expect(poseTransform(unknown, { ...REST_POSE, dy: 20, scale_x: 2 })).toBe('translate(0 20)');
  });
});
