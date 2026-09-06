import { describe, it, expect } from 'vitest';
import { canonicalizeProps } from './engine-edit-tools';
import type { Layer } from '../schema/types';

// A stored text layer keeps its words in content:{type,value} and its typography
// in style:{}. update merged props in shallow, so the natural way to ask for a
// change wrote a sibling the renderer never reads — and reported success.
// Confirmed by rendering a layer holding both forms: content/style won every
// time, so `text`, `font_size`, `size` and `color` were all silent no-ops.

const textLayer = (extra: Record<string, unknown> = {}): Layer => ({
  id: 't', type: 'text', z: 0, x: 0, y: 0, width: 800, height: 60,
  content: { type: 'plain', value: 'OLD' },
  style: { font_size: 40, color: '#111111', font_family: 'Anton' },
  ...extra,
} as unknown as Layer);

const rect = (): Layer => ({ id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10, fill: '#fff' } as unknown as Layer);

describe('a flat alias is routed into the field that would shadow it', () => {
  it('folds text into the canonical content', () => {
    const out = canonicalizeProps(textLayer(), { text: 'NEW' });
    expect(out['content']).toEqual({ type: 'plain', value: 'NEW' });
    expect(out['text']).toBeUndefined();
  });

  it('keeps a non-plain content type when replacing the words', () => {
    const l = textLayer({ content: { type: 'markdown', value: '# OLD' } });
    expect(canonicalizeProps(l, { text: '# NEW' })['content']).toEqual({ type: 'markdown', value: '# NEW' });
  });

  it('folds every typography alias into style', () => {
    const out = canonicalizeProps(textLayer(), {
      font_size: 90, color: '#EE0000', weight: 800, align: 'center',
      tracking: 4, leading: 1.2, font: 'Inter',
    });
    expect(out['style']).toEqual({
      font_size: 90, color: '#EE0000', font_weight: 800, text_align: 'center',
      letter_spacing: 4, line_height: 1.2, font_family: 'Inter',
    });
    for (const k of ['font_size', 'color', 'weight', 'align', 'tracking', 'leading', 'font']) {
      expect(out[k]).toBeUndefined();
    }
  });

  it('keeps the style keys the patch did not mention', () => {
    const out = canonicalizeProps(textLayer(), { size: 90 });
    expect(out['style']).toEqual({ font_size: 90, color: '#111111', font_family: 'Anton' });
  });

  it('lets an explicit style in the same patch win over the alias', () => {
    const out = canonicalizeProps(textLayer(), { font_size: 90, style: { font_size: 12 } });
    expect((out['style'] as Record<string, unknown>)['font_size']).toBe(12);
  });

  it('leaves a layer with no canonical field to shadow alone', () => {
    // No style object → a flat size is read correctly already. Nothing to fix.
    const bare = { id: 't', type: 'text', z: 0, x: 0, y: 0, width: 10, height: 10 } as unknown as Layer;
    const out = canonicalizeProps(bare, { font_size: 90, text: 'NEW' });
    expect(out).toEqual({ font_size: 90, text: 'NEW' });
  });

  it('does not invent a style block on a rect', () => {
    const out = canonicalizeProps(rect(), { color: '#EE0000' });
    expect(out).toEqual({ color: '#EE0000' });
    expect(out['style']).toBeUndefined();
  });

  it('passes geometry and everything else straight through', () => {
    const out = canonicalizeProps(textLayer(), { x: 10, y: 20, width: 30, opacity: 0.5 });
    expect(out).toEqual({ x: 10, y: 20, width: 30, opacity: 0.5 });
  });

  it('leaves an explicit canonical content alone', () => {
    const out = canonicalizeProps(textLayer(), { content: { type: 'plain', value: 'DIRECT' }, text: 'IGNORED' });
    expect(out['content']).toEqual({ type: 'plain', value: 'DIRECT' });
    expect(out['text']).toBe('IGNORED');   // caller was explicit; not second-guessed
  });
});
