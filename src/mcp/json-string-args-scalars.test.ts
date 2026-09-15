import { describe, it, expect } from 'vitest';
import { decodeJsonStringArgs } from './json-string-args';

// Found live: a client whose tool list predated these params sent them as strings,
// and op:wiggle quietly ran at its default frequency instead of the one asked for.
describe('decodeJsonStringArgs — scalars the schema declares', () => {
  it('turns a numeric string into a number where the schema says number', () => {
    const out = decodeJsonStringArgs('animation', { op: 'wiggle', frequency: '3', delay: ' 700 ', t: '-12.5' });
    expect(out).toMatchObject({ frequency: 3, delay: 700, t: -12.5 });
  });

  it('turns "true" and "false" into booleans where the schema says boolean', () => {
    expect(decodeJsonStringArgs('animation', { op: 'text', mask: 'true', keep_source: 'false' }))
      .toMatchObject({ mask: true, keep_source: false });
  });

  it('leaves anything that is not exactly a number or a boolean for the op to judge', () => {
    expect(decodeJsonStringArgs('animation', { frequency: '3hz', mask: 'yes', duration: '' }))
      .toMatchObject({ frequency: '3hz', mask: 'yes', duration: '' });
  });

  it('never coerces an argument its schema declares as a string, however numeric it looks', () => {
    expect(decodeJsonStringArgs('manage_design', { op: 'restore', to: '3' })['to']).toBe('3');
  });
});
