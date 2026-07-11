import { describe, it, expect } from 'vitest';
import { extractPptxTexts } from './pptx-text-extract';
import type { Layer } from '../schema/types';

const text = (over: Record<string, unknown>): Layer =>
  ({ id: 't1', type: 'text', z: 1, x: 40, y: 60, width: 400,
     content: { type: 'plain', value: 'Hello' }, style: { font_size: 48, color: '#112233', font_weight: 700 }, ...over } as unknown as Layer);

describe('extractPptxTexts', () => {
  it('promotes a solid-hex plain text layer and marks it to hide', () => {
    const { texts, hideIds } = extractPptxTexts([text({})]);
    expect(texts).toHaveLength(1);
    expect(hideIds.has('t1')).toBe(true);
    const t = texts[0];
    expect(t.text).toBe('Hello');
    expect(t.x).toBe(40); expect(t.y).toBe(60); expect(t.w).toBe(400);
    expect(t.sizePt).toBe(36);           // 48px × 72/96
    expect(t.color).toBe('#112233');
    expect(t.bold).toBe(true);
  });

  it('applies text_transform uppercase', () => {
    const { texts } = extractPptxTexts([text({ style: { font_size: 20, color: '#000000', text_transform: 'uppercase' } })]);
    expect(texts[0].text).toBe('HELLO');
  });

  it('does NOT promote non-hex/token colours (stays in raster)', () => {
    const { texts, hideIds } = extractPptxTexts([text({ style: { font_size: 20, color: '$accent' } })]);
    expect(texts).toHaveLength(0);
    expect(hideIds.size).toBe(0);
  });

  it('does NOT promote rotated or effect-heavy text', () => {
    expect(extractPptxTexts([text({ rotation: 10 })]).texts).toHaveLength(0);
    expect(extractPptxTexts([text({ effects: { shadows: [{}] } })]).texts).toHaveLength(0);
  });

  it('joins rich spans and maps center align', () => {
    const { texts } = extractPptxTexts([text({
      content: { type: 'rich', spans: [{ text: 'a' }, { text: 'b' }] },
      style: { font_size: 20, color: '#000000', text_align: 'center' },
    })]);
    expect(texts[0].text).toBe('ab');
    expect(texts[0].align).toBe('ctr');
  });

  it('recurses groups but skips descendants of a rotated group', () => {
    const inner = text({ id: 'inner' });
    const group = { id: 'g', type: 'group', z: 0, rotation: 5, layers: [inner] } as unknown as Layer;
    expect(extractPptxTexts([group]).texts).toHaveLength(0);
    const group2 = { id: 'g2', type: 'group', z: 0, layers: [text({ id: 'ok' })] } as unknown as Layer;
    expect(extractPptxTexts([group2]).texts).toHaveLength(1);
  });
});
