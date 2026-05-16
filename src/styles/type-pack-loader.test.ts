import { describe, it, expect } from 'vitest';
import { loadTypePackIndex, peekTypePackIndex } from './type-pack-loader';

describe('loadTypePackIndex', () => {
  it('resolves to an array', async () => {
    const entries = await loadTypePackIndex();
    expect(Array.isArray(entries)).toBe(true);
  });

  it('subsequent calls return the cached value', async () => {
    const a = await loadTypePackIndex();
    const b = await loadTypePackIndex();
    expect(a).toBe(b);
  });

  it('peekTypePackIndex returns the cached array after load', async () => {
    await loadTypePackIndex();
    expect(Array.isArray(peekTypePackIndex())).toBe(true);
  });
});
