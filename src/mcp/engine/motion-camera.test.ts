import { describe, it, expect } from 'vitest';
import { framePose, type CameraPose } from './motion-camera';

const canvas = { width: 1080, height: 1350 };
// Where a canvas point lands under a pose — the same composition both players use.
const land = (p: { x: number; y: number }, pose: CameraPose): { x: number; y: number } => ({
  x: canvas.width / 2 + pose.x + pose.scale * (p.x - canvas.width / 2),
  y: canvas.height / 2 + pose.y + pose.scale * (p.y - canvas.height / 2),
});

describe('framePose', () => {
  it('is the identity when the shot is the whole canvas', () => {
    expect(framePose({ x: 0, y: 0, ...canvas }, canvas)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('centres a padded target and keeps it inside the frame', () => {
    const target = { x: 700, y: 900, width: 200, height: 100 };
    const pose = framePose(target, canvas, 40);
    const centre = land({ x: 800, y: 950 }, pose);
    expect(centre.x).toBeCloseTo(540, 0);
    expect(centre.y).toBeCloseTo(675, 0);
    const left = land({ x: target.x - 40, y: 950 }, pose), right = land({ x: target.x + target.width + 40, y: 950 }, pose);
    expect(left.x).toBeCloseTo(0, 0);        // width is the tighter axis: padded edges touch the frame
    expect(right.x).toBeCloseTo(1080, 0);
  });

  it('is limited by whichever axis the target fills first', () => {
    expect(framePose({ x: 0, y: 600, width: 1080, height: 100 }, canvas).scale).toBe(1);        // wide
    expect(framePose({ x: 500, y: 0, width: 50, height: 1350 }, canvas).scale).toBe(1);         // tall
    expect(framePose({ x: 440, y: 575, width: 200, height: 200 }, canvas).scale).toBeCloseTo(5.4, 4);
  });
});
