// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DesignSpec } from '../../schema/types';
import { readYAML } from './utils';
import { captionsMotion } from './motion-captions-op';
import { dispatchAnimation } from '../dispatch';

type Reply = { success: boolean; error?: string; captions?: Array<Record<string, unknown>>; notes?: string[]; file?: string; next_action?: { params?: Record<string, unknown> } };
const call = (a: Record<string, unknown>): Reply => captionsMotion(a as unknown as Parameters<typeof captionsMotion>[0]) as unknown as Reply;

describe('animation(op:captions)', () => {
  let root = '';
  let design = '';
  const spec = (): DesignSpec => readYAML<DesignSpec>(design);
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-captions-'));
    fs.mkdirSync(path.join(root, 'designs'), { recursive: true });
    design = path.join(root, 'designs/deck.design.yaml');
    const page = (id: string, fill: string): Record<string, unknown> => ({ id, auto_advance: 3000, layers: [{ id: `${id}-bg`, type: 'rect', z: 0, x: 0, y: 0, width: 320, height: 180, fill }] });
    fs.writeFileSync(design, JSON.stringify({ meta: { id: 'deck', name: 'Deck', type: 'carousel', created: '', modified: '' }, document: { width: 320, height: 180, unit: 'px', dpi: 72 }, pages: [page('s1', '#223344'), page('s2', '#445566')] }));
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('sets a scene\'s captions from its first frame and points at a frame to look at', () => {
    const r = call({ design_path: design, page_id: 's2', lines: [{ text: 'Every format' }, 'from one spec'] });
    expect(r.success).toBe(true);
    expect(spec().pages?.[1]?.captions).toEqual([{ text: 'Every format' }, { text: 'from one spec' }]);
    expect(r.captions).toEqual([
      { text: 'Every format', from_ms: 3000, to_ms: 4200, scene: 's2' },
      { text: 'from one spec', from_ms: 4200, to_ms: 6000, scene: 's2' },
    ]);
    expect(r.next_action?.params).toMatchObject({ op: 'frame', t: 3600, scenes: true });
  });

  it('sets piece captions and merges style, noting a caption too fast to read', () => {
    call({ design_path: design, style: { position: 'top' } });
    const r = call({ design_path: design, cues: [{ text: 'A very long line of words that will never be read in time', from_ms: 0, to_ms: 1200 }], style: { font_size: 20 } });
    expect(spec().captions?.style).toEqual({ position: 'top', font_size: 20 });
    expect(r.notes?.join(' ')).toMatch(/characters a second/);
  });

  it('clears one scene or everything', () => {
    call({ design_path: design, page_id: 's1', lines: ['One'] });
    call({ design_path: design, cues: [{ text: 'Two', from_ms: 3000, to_ms: 4500 }] });
    call({ design_path: design, page_id: 's1', clear: true });
    expect(spec().pages?.[0]?.captions).toBeUndefined();
    expect(spec().captions?.cues).toHaveLength(1);
    call({ design_path: design, clear: true });
    expect(spec().captions).toBeUndefined();
  });

  it('refuses mixed-up input and writes nothing', () => {
    const before = fs.readFileSync(design, 'utf8');
    expect(call({ design_path: design, page_id: 's1', cues: [] }).error).toMatch(/a scene takes lines/);
    expect(call({ design_path: design, lines: ['x'] }).error).toMatch(/pass page_id/);
    expect(call({ design_path: design, style: { glow: 3 } }).error).toMatch(/not a caption style/);
    expect(call({ design_path: design, cues: [{ text: 'x', from_ms: 5 }] }).error).toMatch(/needs text, from_ms and to_ms/);
    expect(call({ design_path: design, format: 'ass' }).error).toMatch(/srt" or "vtt/);
    expect(fs.readFileSync(design, 'utf8')).toBe(before);
  });

  it('writes a subtitle file on request, and op:frame draws the caption into the frame', async () => {
    const r = call({ design_path: design, page_id: 's1', lines: ['Hello'], format: 'vtt' });
    expect(fs.readFileSync(String(r.file), 'utf8')).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nHello\n');
    const frame = await dispatchAnimation({ op: 'frame', design_path: design, scenes: true, t: 1500 });
    expect(frame, JSON.stringify(frame).slice(0, 300)).toMatchObject({ success: true });
  }, 60_000);
});
