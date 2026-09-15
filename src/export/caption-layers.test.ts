import { describe, it, expect } from 'vitest';
import type { DesignSpec } from '../schema/types';
import type { CaptionPlan } from './caption-plan';
import { captionLayers, withCaptions, CAPTION_Z } from './caption-layers';

const doc = { width: 1920, height: 1080 };
const plan = (text: string): CaptionPlan => ({ cues: [{ id: 'c', text, from_ms: 0, to_ms: 1000 }], notes: [] });
type Box = { id: string; type: string; x: number; y: number; z: number; width: number; height: number; style?: { font_size?: number }; content?: { value?: string } };
const boxes = (layers: unknown[]): Box[] => layers as Box[];

describe('captionLayers', () => {
  it('draws the caption over a box near the bottom, above every layer, centred', () => {
    const [box, text] = boxes(captionLayers(plan('Every format from one spec'), undefined, doc, 500));
    expect(box).toMatchObject({ id: '__caption_box', type: 'rect', z: CAPTION_Z });
    expect(text).toMatchObject({ id: '__caption_text', type: 'text', z: CAPTION_Z + 1, content: { value: 'Every format from one spec' } });
    expect(text?.style?.font_size).toBe(49);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBe(1080 - 65);
    expect((box?.x ?? 0) * 2 + (box?.width ?? 0)).toBeCloseTo(1920, -1);
    expect((text?.x ?? 0) * 2 + (text?.width ?? 0)).toBeCloseTo(1920, -1);
  });

  it('grows the box for a caption that wraps', () => {
    const one = boxes(captionLayers(plan('Short line'), undefined, doc, 0))[0];
    const two = boxes(captionLayers(plan('A much longer caption that cannot possibly fit on a single line at this size on the canvas'), undefined, doc, 0))[0];
    expect(two?.height ?? 0).toBeGreaterThan((one?.height ?? 0) * 1.5);
  });

  it('sits at the top with no box when styled so, and draws nothing between cues', () => {
    const layers = boxes(captionLayers(plan('Top'), { position: 'top', background: 'none', margin: 40 }, doc, 0));
    expect(layers.map(l => l.id)).toEqual(['__caption_text']);
    expect(layers[0]?.y).toBe(40 + Math.round(49 * 0.35));
    expect(captionLayers(plan('Gone'), undefined, doc, 1000)).toEqual([]);
  });
});

describe('withCaptions', () => {
  const frame = { document: { ...doc, unit: 'px', dpi: 72 }, pages: [{ id: 'p', layers: [{ id: 'bg', type: 'rect', z: 0 }] }] } as unknown as DesignSpec;

  it('adds the caption to the frame\'s page, and returns the frame untouched when none is on screen', () => {
    expect(withCaptions(frame, plan('Hi'), undefined, 2000)).toBe(frame);
    expect(withCaptions(frame, null, undefined, 0)).toBe(frame);
    expect(withCaptions(frame, plan('Hi'), undefined, 0).pages?.[0]?.layers?.map(l => l.id)).toEqual(['bg', '__caption_box', '__caption_text']);
    expect(frame.pages?.[0]?.layers).toHaveLength(1);
  });
});
