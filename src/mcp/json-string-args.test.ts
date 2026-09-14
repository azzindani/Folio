import { describe, it, expect } from 'vitest';
import { decodeJsonStringArgs } from './json-string-args';

describe('decodeJsonStringArgs', () => {
  it('decodes an object argument sent as a JSON string — the live op:scene failure', () => {
    const args = { op: 'scene', page_id: 'p2', transition: '{"type": "slide-left", "duration": 500}' };
    expect(decodeJsonStringArgs('animation', args)).toEqual({ op: 'scene', page_id: 'p2', transition: { type: 'slide-left', duration: 500 } });
  });

  it('decodes an array argument sent as a JSON string', () => {
    const out = decodeJsonStringArgs('animation', { op: 'sequence', steps: ' [{"preset":"rise"}] ' });
    expect(out['steps']).toEqual([{ preset: 'rise' }]);
  });

  it('leaves plain strings, malformed JSON and the wrong shape for the op to judge', () => {
    expect(decodeJsonStringArgs('animation', { transition: 'fade' })['transition']).toBe('fade');
    expect(decodeJsonStringArgs('animation', { transition: '{type: fade}' })['transition']).toBe('{type: fade}');
    expect(decodeJsonStringArgs('animation', { steps: '{"preset":"rise"}' })['steps']).toBe('{"preset":"rise"}');
  });

  it('never decodes an argument its schema declares as a string', () => {
    // op:motion_path takes an SVG `d` string; one that happens to start with "[" must survive.
    expect(decodeJsonStringArgs('animation', { path: '[1,2]' })['path']).toBe('[1,2]');
  });

  it('leaves unknown tools alone and never mutates the input', () => {
    const args = { transition: '{"type":"fade"}' };
    expect(decodeJsonStringArgs('no_such_tool', args)).toBe(args);
    const out = decodeJsonStringArgs('animation', args);
    expect(out).not.toBe(args);
    expect(args.transition).toBe('{"type":"fade"}');
  });
});
