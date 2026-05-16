import { describe, it, expect } from 'vitest';
import { loadEffectsPackIndex, peekEffectsPackIndex } from './effects-pack-loader';

describe('loadEffectsPackIndex', () => {
  it('resolves to an array', async () => {
    const entries = await loadEffectsPackIndex();
    expect(Array.isArray(entries)).toBe(true);
  });

  it('subsequent calls return the cached value', async () => {
    const a = await loadEffectsPackIndex();
    const b = await loadEffectsPackIndex();
    expect(a).toBe(b);
  });

  it('peekEffectsPackIndex returns the cached array after load', async () => {
    await loadEffectsPackIndex();
    expect(Array.isArray(peekEffectsPackIndex())).toBe(true);
  });
});
