/**
 * Unit tests for the palette loader. The setup-asset-fetch polyfill
 * resolves relative URLs to disk reads, so `fetch('/styles/palettes/x.yaml')`
 * lands on public/styles/palettes/x.yaml during tests.
 */
import { describe, it, expect } from 'vitest';
import { loadPaletteIndex, peekPaletteIndex } from './palette-loader';

describe('loadPaletteIndex', () => {
  it('resolves to an array', async () => {
    const entries = await loadPaletteIndex();
    expect(Array.isArray(entries)).toBe(true);
  });

  it('subsequent calls return the cached value', async () => {
    const a = await loadPaletteIndex();
    const b = await loadPaletteIndex();
    expect(a).toBe(b);
  });

  it('peekPaletteIndex returns the cached array after load', async () => {
    await loadPaletteIndex();
    const peeked = peekPaletteIndex();
    expect(Array.isArray(peeked)).toBe(true);
  });
});
