import { describe, it, expect } from 'vitest';
import { layerText, hasLayerText } from './layer-text';
import { measureTextLayer } from '../mcp/engine/text-measure';
import type { Layer } from './types';

// Every content shape the schema accepts, read by ONE function — because five
// call sites reading `content?.value` inline each missed the same two.

const text = (content: unknown): Layer =>
  ({ id: 't', type: 'text', x: 0, y: 0, width: 400, content, style: { font_size: 40 } }) as unknown as Layer;

describe('layerText reads every accepted content shape', () => {
  it('the bare scalar the renderer draws and the linters called empty', () => {
    expect(layerText(text('Motion probe'))).toBe('Motion probe');
    expect(hasLayerText(text('Motion probe'))).toBe(true);
  });

  it('the canonical plain and markdown objects', () => {
    expect(layerText(text({ type: 'plain', value: 'Hello' }))).toBe('Hello');
    expect(layerText(text({ type: 'markdown', value: '# Hi' }))).toBe('# Hi');
  });

  it('rich text, which has spans and no value at all', () => {
    expect(layerText(text({ type: 'rich', spans: [{ text: 'Bold ' }, { text: 'and plain' }] })))
      .toBe('Bold and plain');
  });

  it('is honestly empty for the things that ARE empty', () => {
    expect(layerText(text(''))).toBe('');
    expect(layerText(text({ type: 'plain', value: '' }))).toBe('');
    expect(layerText(text({ type: 'rich', spans: [] }))).toBe('');
    expect(hasLayerText(text('   '))).toBe(false);
    expect(layerText(text(undefined))).toBe('');
    expect(layerText(null)).toBe('');
    expect(layerText({ type: 'rect' })).toBe('');
  });

  it('survives junk in the spans instead of throwing', () => {
    expect(layerText(text({ type: 'rich', spans: [null, { text: 'ok' }, { nope: 1 }] }))).toBe('ok');
    expect(layerText(text({ type: 'rich', spans: 'not an array' }))).toBe('');
  });
});

describe('the engine can now measure the text it could not read', () => {
  it('measures a scalar-content layer instead of skipping it', () => {
    const m = measureTextLayer(text('A headline long enough to need more than one line on a narrow box'));
    expect(m, 'a scalar-content text layer got no overflow or autofit check at all').not.toBeNull();
    expect(m?.lines).toBeGreaterThan(1);
  });

  it('measures rich text too', () => {
    const m = measureTextLayer(text({ type: 'rich', spans: [{ text: 'Bold headline here' }] }));
    expect(m).not.toBeNull();
    expect(m?.fontSize).toBe(40);
  });

  it('still returns null for genuinely empty text', () => {
    expect(measureTextLayer(text(''))).toBeNull();
    expect(measureTextLayer(text({ type: 'plain', value: '  ' }))).toBeNull();
  });
});
