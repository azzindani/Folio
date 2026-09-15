import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { applyMotion } from './motion';
import { sequenceMotion } from './motion-sequence';
import { animateText } from './text-animate-op';
import { cameraMotion } from './motion-camera-op';
import { wiggleMotion } from './motion-wiggle-op';
import { morphMotion } from './motion-morph-op';
import type { ToolResult } from '../types';

// Found live: every page-scoped motion op handed back an op:frame / op:export
// next_action without the page_id it had just worked on, so following it
// rendered page ONE — a still of the wrong shot, reported as the right one.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-nextpage-'));
let dPath = '';
let n = 0;
const page = (id: string): unknown => ({ id, layers: [
  { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: '#111111' },
  { id: 'title', type: 'text', z: 2, x: 80, y: 100, width: 920, content: { type: 'plain', value: 'Two words' }, style: { font_size: 60, font_family: 'Inter', color: '#FAF5EC' } },
  { id: 'blob', type: 'path', z: 3, x: 300, y: 500, width: 200, height: 200, d: 'M0 0 L200 0 L200 200 L0 200 Z', fill: '#E4572E' },
  { id: 'dot', type: 'path', z: 1, x: 300, y: 500, width: 200, height: 200, d: 'M100 0 C160 0 200 40 200 100 C200 160 160 200 100 200 C40 200 0 160 0 100 C0 40 40 0 100 0 Z', fill: '#E4572E' },
] });

beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({ meta: { id: 'd', name: 'D', type: 'carousel' }, document: { width: 1080, height: 1080 }, pages: [page('p1'), page('p2')] }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const nextParams = (r: ToolResult): Record<string, unknown> => {
  expect(r.success, JSON.stringify(r)).toBe(true);
  return ((r['next_action'] as { params?: Record<string, unknown> } | undefined)?.params) ?? {};
};

describe('page-scoped motion ops point their next_action at the same page', () => {
  const calls: Array<[string, () => ToolResult]> = [
    ['motion', () => applyMotion({ design_path: dPath, page_id: 'p2', preset: 'fade_in', layer_ids: ['title'] })],
    ['sequence', () => sequenceMotion({ design_path: dPath, page_id: 'p2', steps: [{ preset: 'fade_in', layer_ids: ['title'] }] } as Parameters<typeof sequenceMotion>[0])],
    ['text', () => animateText({ design_path: dPath, page_id: 'p2', layer_id: 'title', by: 'word', preset: 'rise' })],
    ['camera', () => cameraMotion({ design_path: dPath, page_id: 'p2', shots: [{ t: 0, target: 'all' }, { t: 900, target: 'blob' }] })],
    ['wiggle', () => wiggleMotion({ design_path: dPath, page_id: 'p2', layer_id: 'blob', amplitude: { x: 6 } })],
    ['morph', () => morphMotion({ design_path: dPath, page_id: 'p2', layer_id: 'blob', to_layer: 'dot' })],
  ];
  for (const [name, call] of calls) {
    it(`op:${name}`, () => expect(nextParams(call())['page_id']).toBe('p2'));
  }

  it('leaves page_id out when the call named none', () => {
    expect('page_id' in nextParams(wiggleMotion({ design_path: dPath, layer_id: 'blob', amplitude: { x: 6 } }))).toBe(false);
  });
});
