import { describe, it, expect } from 'vitest';
import { tokenizePath, setNestedValue } from './engine-runtime-tools';


describe('dot paths may not escape the document', () => {
  // `layers[0].__proto__.polluted` walked to Object.prototype and assigned
  // there: one patch_design call set a property on every object in the running
  // server, wrote nothing to the design, and reported success. Found by probing
  // the live selector surface.
  const paths = [
    'layers[0].__proto__.polluted',
    '__proto__.polluted',
    'constructor.prototype.pwned',
    'layers[0].constructor.prototype.x',
    'layers[__proto__].x',
    'layers[__proto__=1].x',
  ];

  it('refuses every prototype-reaching path', () => {
    for (const p of paths) expect(tokenizePath(p), p).toEqual([]);
  });

  it('does not touch Object.prototype', () => {
    const spec: Record<string, unknown> = { layers: [{ id: 'a' }] };
    for (const p of paths) expect(setNestedValue(spec, p, 'yes'), p).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(({} as Record<string, unknown>)['pwned']).toBeUndefined();
  });

  it('still patches an ordinary path', () => {
    const spec: Record<string, unknown> = { layers: [{ id: 'a', x: 1 }] };
    expect(setNestedValue(spec, 'layers[0].x', 9)).toBe(true);
    expect((spec['layers'] as Record<string, unknown>[])[0]?.['x']).toBe(9);
    expect(setNestedValue(spec, 'layers[id=a].x', 5)).toBe(true);
  });
});
