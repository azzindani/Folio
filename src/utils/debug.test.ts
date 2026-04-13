import { describe, it, expect, vi, afterEach } from 'vitest';
import { debug } from './debug';

describe('debug util', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('debug.log calls console.log with module prefix', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    debug.log('MyModule', 'test message');
    expect(spy).toHaveBeenCalledWith('[MyModule]', 'test message');
  });

  it('debug.warn calls console.warn with module prefix', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    debug.warn('Renderer', 'something fishy');
    expect(spy).toHaveBeenCalledWith('[Renderer]', 'something fishy');
  });

  it('debug.error calls console.error with module prefix', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    debug.error('Parser', 'oops', new Error('test'));
    expect(spy).toHaveBeenCalledWith('[Parser]', 'oops', expect.any(Error));
  });

  it('debug.perf calls console.log with [perf] marker', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    debug.perf('Exporter', '200ms');
    expect(spy).toHaveBeenCalledWith('[Exporter] [perf]', '200ms');
  });

  it('accepts multiple additional args', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    debug.log('Module', 'msg', { extra: true }, 42);
    expect(spy).toHaveBeenCalledWith('[Module]', 'msg', { extra: true }, 42);
  });
});
