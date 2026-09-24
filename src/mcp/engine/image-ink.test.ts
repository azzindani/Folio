// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DesignSpec } from '../../schema/types';
import { collectFindings } from './diagnose-collect';
import { imageInk } from './image-ink';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-ink-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
fs.mkdirSync(path.join(root, 'assets', 'icons'), { recursive: true });
fs.mkdirSync(path.join(root, 'designs'), { recursive: true });
// An icon inked only in its middle half — the transparent margin of a 24-unit icon, exaggerated.
const icon = path.join(root, 'assets', 'icons', 'pad.svg');
fs.writeFileSync(icon, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" fill="#2B3527"/></svg>');
const design = path.join(root, 'designs', 'ride.design.yaml');

const ride = (lineY: number): DesignSpec => ({ meta: { id: 'r', name: 'R', type: 'poster' }, document: { width: 1080, height: 1080 },
  layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: '#EDE5D0' },
    { id: 'hedge', type: 'rect', z: 1, x: 380, y: lineY, width: 200, height: 6, fill: '#6F8759' },
    { id: 'rider', type: 'image', z: 2, x: 100, y: 500, width: 80, height: 80, src: 'assets/icons/pad.svg', fit: 'contain',
      animation: { keyframes: [{ t: 0, x: 0 }, { t: 1000, x: 300 }], playback: { duration: 1000, origin: 'offset' } } }] } as unknown as DesignSpec);
const hits = (lineY: number): string[] => collectFindings(ride(lineY), design, root).filter(f => f.code === 'motion_collision').map(f => f.message);

describe('image ink', () => {
  it('measures what an icon draws: its middle half', () => {
    const ink = imageInk(icon);
    expect(ink?.x).toBeCloseTo(0.25, 1);
    expect(ink?.w).toBeCloseTo(0.5, 1);
  });

  it('lets an icon\'s empty margin pass over a line, and still stops its ink landing on one (r8 bike and hedge)', () => {
    expect(hits(505)).toEqual([]);
    expect(hits(536)).toEqual([expect.stringMatching(/"rider" comes to rest over/)]);
  });
});
