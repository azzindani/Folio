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

  // A tilted camera used to frame the wrong place, so a dive could only lean its content.
  it('still centres the target when the camera is turned, and turns the world with it', () => {
    const target = { x: 700, y: 900, width: 200, height: 100 };
    const pose = framePose(target, canvas, 0, undefined, 12);
    // The same composition with the turn: C + T + s·R(p − C).
    const turned = (p: { x: number; y: number }): { x: number; y: number } => {
      const a = (12 * Math.PI) / 180, dx = p.x - canvas.width / 2, dy = p.y - canvas.height / 2;
      return {
        x: canvas.width / 2 + pose.x + pose.scale * (dx * Math.cos(a) - dy * Math.sin(a)),
        y: canvas.height / 2 + pose.y + pose.scale * (dx * Math.sin(a) + dy * Math.cos(a)),
      };
    };
    const centre = turned({ x: 800, y: 950 });
    expect(centre.x).toBeCloseTo(540, 0);
    expect(centre.y).toBeCloseTo(675, 0);
    // Turned, not just moved: the target's top edge is no longer level.
    const l = turned({ x: 700, y: 900 }), r = turned({ x: 900, y: 900 });
    expect(Math.abs(r.y - l.y)).toBeGreaterThan(40);
    expect(framePose(target, canvas, 0, undefined, 0)).toEqual(framePose(target, canvas));
  });

  it('is limited by whichever axis the target fills first', () => {
    expect(framePose({ x: 0, y: 600, width: 1080, height: 100 }, canvas).scale).toBe(1);        // wide
    expect(framePose({ x: 500, y: 0, width: 50, height: 1350 }, canvas).scale).toBe(1);         // tall
    expect(framePose({ x: 440, y: 575, width: 200, height: 200 }, canvas).scale).toBeCloseTo(5.4, 4);
  });
});
