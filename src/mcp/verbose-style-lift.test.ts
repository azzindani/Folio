import { describe, it, expect } from 'vitest';
import { expandShorthandLayers } from './shorthand-expand';
import { lintComposition } from './engine/design-lint';
import type { ShorthandLayer } from './shorthand-parser';
import type { Layer } from '../schema/types';

// A model that learned the canonical schema (from inspect_design / docs) sends
// text layers with styling nested under `style:{}` and content under
// `content:{value}`, through the `layers_shorthand` param. The shorthand path
// used to read only FLAT fields, dropping every color/font/align → all text
// defaulted to a flat $text with one size → a blank-looking, undesigned poster.

const verboseText = {
  id: 'point1', type: 'text', z: 20, x: 60, y: 240, width: 960, height: 'auto',
  content: { type: 'plain', value: '• This poster proves YES' },
  style: { font_family: '$heading', font_size: 32, font_weight: 600, color: '$primary', align: 'left', line_height: 1.4 },
} as unknown as ShorthandLayer;

function style(l: Layer): Record<string, unknown> {
  return ((l as unknown as { style?: Record<string, unknown> }).style) ?? {};
}

describe('verbose-shaped layers through layers_shorthand keep their style', () => {
  it('lifts style.color / font / size / align onto the expanded text (not defaulted to $text)', () => {
    const [l] = expandShorthandLayers([verboseText]);
    const s = style(l);
    expect(s.color).toBe('$primary');          // was being flattened to '$text'
    expect(s.font_family).toBe('$heading');
    expect(s.font_size).toBe(32);              // model's size survives (was → 48 default)
    expect(s.align).toBe('left');
    expect(s.line_height).toBe(1.4);
    // content still survives (the alias that already worked)
    const v = (l as unknown as { content?: { value?: string } }).content?.value;
    expect(v).toBe('• This poster proves YES');
  });

  it('an explicit flat field still wins over the nested style', () => {
    const sh = { ...(verboseText as Record<string, unknown>), color: '#FF0000' } as unknown as ShorthandLayer;
    const [l] = expandShorthandLayers([sh]);
    expect(style(l).color).toBe('#FF0000');
  });

  it('still defaults a genuinely color-less text to $text (no regression)', () => {
    const bare = { type: 'text', x: 60, y: 100, width: 400, height: 80, text: 'hi' } as unknown as ShorthandLayer;
    expect(style(expandShorthandLayers([bare])[0]).color).toBe('$text');
  });
});

describe('lint recognizes a TOKEN-filled full-canvas background', () => {
  const bg = (color: string): Layer => ({
    id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350,
    fill: { type: 'solid', color },
  } as unknown as Layer);

  it('a $surface (token) background does NOT trigger the "no background" note', () => {
    const notes = lintComposition([bg('$surface')], 1080, 1350);
    expect(notes.some(n => n.includes('No full-canvas background'))).toBe(false);
  });

  it('still warns when there genuinely is no background rect', () => {
    const txt = { id: 't', type: 'text', z: 1, x: 60, y: 60, width: 400, height: 80,
      content: { type: 'plain', value: 'hi' }, style: { color: '#111', font_size: 40 } } as unknown as Layer;
    const notes = lintComposition([txt], 1080, 1350);
    expect(notes.some(n => n.includes('No full-canvas background'))).toBe(true);
  });
});
