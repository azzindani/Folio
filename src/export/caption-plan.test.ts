import { describe, it, expect } from 'vitest';
import type { DesignSpec, SceneCaption, CaptionCue } from '../schema/types';
import { planCaptions, captionAt } from './caption-plan';

const deck = (cues: CaptionCue[], s1: SceneCaption[] = [], s2: SceneCaption[] = []): DesignSpec => ({
  document: { width: 1920, height: 1080, unit: 'px', dpi: 72 },
  pages: [{ id: 's1', layers: [], captions: s1 }, { id: 's2', layers: [], captions: s2 }],
  captions: { cues },
} as unknown as DesignSpec);

const timeline = { total_ms: 8000, scenes: [{ page_id: 's1', start_ms: 0, length_ms: 4000 }, { page_id: 's2', start_ms: 4000, length_ms: 4000 }] };
const spans = (spec: DesignSpec): Array<[string, number, number]> => planCaptions(spec, timeline).cues.map(c => [c.text, c.from_ms, c.to_ms]);

describe('planCaptions', () => {
  it('shares a scene between untimed captions by word count, and places them from the scene\'s start', () => {
    expect(spans(deck([], [], [{ text: 'One two' }, { text: 'three four five six' }]))).toEqual([
      ['One two', 4000, 5333], ['three four five six', 5333, 8000],
    ]);
  });

  it('keeps the times the model set: a start ends the shared run before it, a duration is kept', () => {
    expect(spans(deck([], [{ text: 'Hello there' }, { text: 'Later', at: 3000, duration: 800 }]))).toEqual([
      ['Hello there', 0, 3000], ['Later', 3000, 3800],
    ]);
  });

  it('merges design cues with scene captions in time order', () => {
    const plan = planCaptions(deck([{ text: 'Piece-wide', from_ms: 2000, to_ms: 3500 }], [{ text: 'First', at: 0, duration: 1500 }]), timeline);
    expect(plan.cues.map(c => [c.id, c.from_ms])).toEqual([['s1-caption-1', 0], ['cue-1', 2000]]);
  });

  it('trims an overlap, cuts at the end of the piece, and leaves out what cannot show — with notes', () => {
    const plan = planCaptions(deck([
      { text: 'Early words here', from_ms: 0, to_ms: 3000 }, { text: 'Overlapping line', from_ms: 2000, to_ms: 4000 },
      { text: 'Runs past the end', from_ms: 6500, to_ms: 9000 }, { text: 'Backwards', from_ms: 5000, to_ms: 4000 }, { text: 'Too late', from_ms: 8200, to_ms: 9000 },
    ]), timeline);
    expect(plan.cues.map(c => [c.text, c.from_ms, c.to_ms])).toEqual([
      ['Early words here', 0, 2000], ['Overlapping line', 2000, 4000], ['Runs past the end', 6500, 8000],
    ]);
    const said = plan.notes.join(' ');
    expect(said).toMatch(/overlap by 1000ms/);
    expect(said).toMatch(/"Backwards" ends before it starts/);
    expect(said).toMatch(/"Too late" starts at 8\.2s, after the piece ends/);
  });

  it('notes a caption too fast to read and one that flashes past', () => {
    const plan = planCaptions(deck([
      { text: 'This sentence has far too many characters for two seconds', from_ms: 0, to_ms: 2000 },
      { text: 'Quick', from_ms: 3000, to_ms: 3700 },
    ]), timeline);
    expect(plan.notes.join(' ')).toMatch(/needs 29 characters a second/);
    expect(plan.notes.join(' ')).toMatch(/"Quick" is on screen 0\.7s/);
  });

  it('answers which caption is on screen at a moment', () => {
    const plan = planCaptions(deck([{ text: 'A', from_ms: 1000, to_ms: 2000 }]), timeline);
    expect([999, 1000, 1999, 2000].map(t => captionAt(plan, t)?.text ?? null)).toEqual([null, 'A', 'A', null]);
  });
});
