import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { DesignSpec } from '../../schema/types';
import { videoSourceMs } from '../../animation/video-time';
import { resolveImageAssets } from './asset-resolve';
import { renderToSVGString, renderToSVGElement, serializeSVGElement } from './svg-export';
import { specAt } from '../../export/gif-frames';
import { expandShorthand, expandShorthandLayers } from '../shorthand-parser';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined;

describe('videoSourceMs', () => {
  it('starts at the in point, from the offset, at speed', () => {
    expect(videoSourceMs(0, 1000, { offset_ms: 500 })).toBe(500);          // before in → first used frame
    expect(videoSourceMs(1500, 1000, { offset_ms: 500 })).toBe(1000);
    expect(videoSourceMs(1500, 1000, { offset_ms: 500, speed: 2 })).toBe(1500);
  });
  it('holds the last used frame, or loops the used part', () => {
    expect(videoSourceMs(5000, 0, { duration_ms: 2000 })).toBe(1999);
    expect(videoSourceMs(5000, 0, { duration_ms: 2000, loop: true })).toBe(1000);
  });
});

describe('video layers render their frame on the server', () => {
  let dir: string;
  const design = (): string => path.join(dir, 'designs', 'd.design.yaml');
  const spec = (src: string): DesignSpec => ({
    meta: { name: 'v', version: '1' }, document: { width: 640, height: 360, unit: 'px' },
    layers: [{ id: 'clip', type: 'video', x: 0, y: 0, width: 640, height: 360, z: 1, src, fit: 'cover', video: { offset_ms: 0 } }],
  } as unknown as DesignSpec);
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-vframe-'));
    fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets', 'video'), { recursive: true });
    if (hasFfmpeg) {
      spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y',
        path.join(dir, 'assets', 'video', 'take.mp4')], { timeout: 30_000 });
    }
  }, 60_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it.skipIf(!hasFfmpeg)('draws the clip as an image, and a different frame at a different time', () => {
    const s = spec('assets/video/take.mp4');
    expect(resolveImageAssets(s, design(), dir)).toEqual([]);
    const at0 = renderToSVGString(specAt(s, 0, 0));
    const at1 = renderToSVGString(specAt(s, 0, 1500));
    const uri = (svg: string): string => /href="(data:image\/jpeg;base64,[^"]+)"/.exec(svg)?.[1] ?? '';
    expect(uri(at0)).not.toBe('');
    expect(uri(at1)).not.toBe('');
    expect(uri(at0)).not.toBe(uri(at1));
    expect(at0).not.toContain('<video');
  }, 30_000);

  it('a clip that is not stored draws the placeholder and says why', () => {
    const s = spec('assets/video/missing.mp4');
    const notes = resolveImageAssets(s, design(), dir);
    expect(notes[0]).toContain('is not a stored clip');
    const svg = renderToSVGString(s);
    expect(svg).not.toContain('<video');
    expect(svg).toContain('data-layer-id="clip"');
  });

  it('in the browser path (no frame) the file plays in a <video>', () => {
    const svg = serializeSVGElement(renderToSVGElement(spec('assets/video/take.mp4')));
    expect(svg).toMatch(/<video[^>]*data-video-layer="clip"/);
    expect(svg).toContain('object-fit:cover');
  });

  it('shorthand keeps a video a video — explicit, or inferred from the file', () => {
    const a = expandShorthand({ id: 'a', type: 'video', pos: [0, 0, 100, 50], src: 'assets/video/x.mp4', video: { speed: 2 } } as never) as unknown as Record<string, unknown>;
    expect(a).toMatchObject({ type: 'video', video: { speed: 2 } });
    const [b] = expandShorthandLayers([{ id: 'b', pos: [0, 0, 100, 50], src: 'lib/clips/sea.webm' }] as never) as unknown as Array<Record<string, unknown>>;
    expect(b?.['type']).toBe('video');
  });
});
