import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { inspectTimeline, addKeyframeToLayer, addLayers, createPresentation } from '../engine';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-tl-engine-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function makePresentation(): string {
  return createPresentation({
    project_path: tmpDir,
    name: 'TL Test',
    pages: [{ id: 'slide_1', label: 'Slide 1' }],
  })['design_path'] as string;
}

function writePosterDesign(dPath: string): void {
  const yaml = [
    '_protocol: "design/v1"',
    'meta:',
    '  id: "x1"',
    '  name: "Poster"',
    '  type: "poster"',
    '  created: ""',
    '  modified: ""',
    'document:',
    '  width: 1080',
    '  height: 1080',
    '  unit: "px"',
    'layers:',
    '  - id: layer1',
    '    type: rect',
    '    z: 1',
    '    x: 0',
    '    y: 0',
    '    width: 100',
    '    height: 100',
  ].join('\n');
  fs.mkdirSync(path.dirname(dPath), { recursive: true });
  fs.writeFileSync(dPath, yaml);
}

describe('inspectTimeline', () => {
  it('returns empty tracks for design with no animated layers', () => {
    const dPath = makePresentation();
    const r = inspectTimeline({ design_path: dPath });
    expect(r.success).toBe(true);
    expect(r['track_count']).toBe(0);
    expect(r['ascii']).toContain('no animated layers');
  });

  it('fails when design does not exist', () => {
    const r = inspectTimeline({ design_path: path.join(tmpDir, 'missing.design.yaml') });
    expect(r.success).toBe(false);
  });

  it('filters by page_id when provided', () => {
    const dPath = makePresentation();
    const r = inspectTimeline({ design_path: dPath, page_id: 'slide_1' });
    expect(r.success).toBe(true);
    expect(r['track_count']).toBe(0);
  });

  it('returns error for unknown page_id', () => {
    const dPath = makePresentation();
    const r = inspectTimeline({ design_path: dPath, page_id: 'no_such_page' });
    expect(r.success).toBe(false);
  });

  it('returns tracks and ascii for animated layers', () => {
    const dPath = makePresentation();
    addLayers({
      design_path: dPath,
      page_id: 'slide_1',
      layers: [{
        id: 'rect1', type: 'rect', z: 1, x: 0, y: 0, width: 100, height: 100,
        animation: {
          keyframes: [{ t: 0, opacity: 0 }, { t: 1000, opacity: 1 }],
          playback: { duration: 1000 },
        },
      }],
    });
    const r = inspectTimeline({ design_path: dPath, page_id: 'slide_1' });
    expect(r.success).toBe(true);
    expect(r['track_count']).toBe(1);
    expect(r['ascii']).toContain('◆');
  });

  it('reads top-level layers when no page_id', () => {
    const dPath = path.join(tmpDir, 'designs', 'poster.design.yaml');
    writePosterDesign(dPath);
    const r = inspectTimeline({ design_path: dPath });
    expect(r.success).toBe(true);
    expect(r['track_count']).toBe(0); // no animation on layer1
  });
});

describe('addKeyframeToLayer', () => {
  it('fails when design does not exist', () => {
    const r = addKeyframeToLayer({
      design_path: path.join(tmpDir, 'missing.design.yaml'),
      layer_id: 'l1',
      keyframe: { t: 500, opacity: 0.5 },
    });
    expect(r.success).toBe(false);
  });

  it('fails when layer_id not found', () => {
    const dPath = makePresentation();
    const r = addKeyframeToLayer({ design_path: dPath, layer_id: 'no_such_layer', keyframe: { t: 500 } });
    expect(r.success).toBe(false);
  });

  it('adds keyframe to a top-level layer', () => {
    const dPath = path.join(tmpDir, 'designs', 'poster.design.yaml');
    writePosterDesign(dPath);
    const r = addKeyframeToLayer({ design_path: dPath, layer_id: 'layer1', keyframe: { t: 0, opacity: 0 } });
    expect(r.success).toBe(true);
    expect(r['layer_id']).toBe('layer1');
    expect(fs.readFileSync(dPath, 'utf-8')).toContain('keyframes');
  });

  it('adds keyframe to a page layer', () => {
    const dPath = makePresentation();
    addLayers({
      design_path: dPath,
      page_id: 'slide_1',
      layers: [{ id: 'pl1', type: 'rect', z: 1, x: 0, y: 0, width: 50, height: 50 }],
    });
    const r = addKeyframeToLayer({ design_path: dPath, layer_id: 'pl1', keyframe: { t: 500, opacity: 0.5 } });
    expect(r.success).toBe(true);
    const raw = fs.readFileSync(dPath, 'utf-8');
    expect(raw).toContain('keyframes');
  });

  it('returns layer_id and keyframe in result', () => {
    const dPath = makePresentation();
    addLayers({
      design_path: dPath,
      page_id: 'slide_1',
      layers: [{ id: 'lx', type: 'rect', z: 1, x: 0, y: 0, width: 50, height: 50 }],
    });
    const kf = { t: 100, x: 10, opacity: 0.8 };
    const r = addKeyframeToLayer({ design_path: dPath, layer_id: 'lx', keyframe: kf });
    expect(r['keyframe']).toEqual(kf);
  });
});
