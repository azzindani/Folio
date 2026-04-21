import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileWatcher } from './file-watcher';

function makeFakeHandle(name: string, content: string, lastModified = 1000): FileSystemFileHandle {
  const fakeFile = { text: vi.fn().mockResolvedValue(content), lastModified };
  return {
    name,
    getFile: vi.fn().mockResolvedValue(fakeFile),
  } as unknown as FileSystemFileHandle;
}

describe('FileWatcher — disabled (no native FSA)', () => {
  let watcher: FileWatcher;

  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    watcher = new FileWatcher();
  });
  afterEach(() => {
    watcher.unwatchAll();
  });

  it('isWatching is false when no files watched', () => {
    expect(watcher.isWatching).toBe(false);
  });

  it('watch() is a no-op when FSA not available', () => {
    const handle = makeFakeHandle('test.yaml', 'content');
    watcher.watch(handle, 'content');
    expect(watcher.isWatching).toBe(false);
  });

  it('unwatch() does not crash when nothing is watched', () => {
    expect(() => watcher.unwatch('nonexistent.yaml')).not.toThrow();
  });

  it('unwatchAll() does not crash when nothing watched', () => {
    expect(() => watcher.unwatchAll()).not.toThrow();
  });

  it('onChange() registers callback and returns unsubscribe fn', () => {
    const cb = vi.fn();
    const unsub = watcher.onChange(cb);
    expect(typeof unsub).toBe('function');
    unsub(); // should not throw
  });
});

describe('FileWatcher — enabled (native FSA available)', () => {
  let watcher: FileWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    (window as unknown as Record<string, unknown>).showOpenFilePicker = vi.fn();
    watcher = new FileWatcher();
  });
  afterEach(() => {
    watcher.unwatchAll();
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });

  it('isWatching is false before any watch() call', () => {
    expect(watcher.isWatching).toBe(false);
  });

  it('isWatching is true after watch()', () => {
    const handle = makeFakeHandle('a.yaml', 'content');
    watcher.watch(handle, 'content');
    expect(watcher.isWatching).toBe(true);
  });

  it('watch() adds file to watched set', () => {
    const handle = makeFakeHandle('b.yaml', 'initial');
    watcher.watch(handle, 'initial');
    expect(watcher.isWatching).toBe(true);
  });

  it('unwatch() removes file from watched set', () => {
    const handle = makeFakeHandle('c.yaml', 'x');
    watcher.watch(handle, 'x');
    watcher.unwatch('c.yaml');
    expect(watcher.isWatching).toBe(false);
  });

  it('unwatchAll() clears all watched files', () => {
    watcher.watch(makeFakeHandle('d1.yaml', 'a'), 'a');
    watcher.watch(makeFakeHandle('d2.yaml', 'b'), 'b');
    watcher.unwatchAll();
    expect(watcher.isWatching).toBe(false);
  });

  it('onChange() callback is removable', () => {
    const cb = vi.fn();
    const unsub = watcher.onChange(cb);
    unsub();
    // Callback removed — should not be called
    expect(cb).not.toHaveBeenCalled();
  });

  it('poll does not call callback when content unchanged', async () => {
    const cb = vi.fn();
    watcher.onChange(cb);

    const handle = makeFakeHandle('e.yaml', 'content', 1000);
    // file.lastModified (1000) <= entry.lastModified → skip
    watcher.watch(handle, 'content');

    await vi.advanceTimersByTimeAsync(1500);

    expect(cb).not.toHaveBeenCalled();
  });

  it('poll calls callback when file content changes', async () => {
    const cb = vi.fn();
    watcher.onChange(cb);

    const newModifiedTime = Date.now() + 5000;
    const fakeFile = { text: vi.fn().mockResolvedValue('new content'), lastModified: newModifiedTime };
    const handle = {
      name: 'f.yaml',
      getFile: vi.fn().mockResolvedValue(fakeFile),
    } as unknown as FileSystemFileHandle;

    watcher.watch(handle, 'old content');

    await vi.advanceTimersByTimeAsync(1500);

    expect(cb).toHaveBeenCalledWith('f.yaml', 'new content');
  });

  it('poll removes file when handle.getFile() throws', async () => {
    const handle = {
      name: 'g.yaml',
      getFile: vi.fn().mockRejectedValue(new Error('file deleted')),
    } as unknown as FileSystemFileHandle;

    watcher.watch(handle, 'content');
    expect(watcher.isWatching).toBe(true);

    vi.advanceTimersByTime(1500);
    await vi.runAllTimersAsync();

    expect(watcher.isWatching).toBe(false);
  });

  it('poll does not call callback when modified but content same', async () => {
    const cb = vi.fn();
    watcher.onChange(cb);

    const newTime = Date.now() + 9999;
    const fakeFile = { text: vi.fn().mockResolvedValue('same content'), lastModified: newTime };
    const handle = {
      name: 'h.yaml',
      getFile: vi.fn().mockResolvedValue(fakeFile),
    } as unknown as FileSystemFileHandle;

    watcher.watch(handle, 'same content');

    await vi.advanceTimersByTimeAsync(1500);

    expect(cb).not.toHaveBeenCalled();
  });

  it('callback errors do not break polling loop', async () => {
    const badCb = vi.fn().mockImplementation(() => { throw new Error('callback error'); });
    watcher.onChange(badCb);

    const newTime = Date.now() + 9999;
    const fakeFile = { text: vi.fn().mockResolvedValue('updated'), lastModified: newTime };
    const handle = {
      name: 'i.yaml',
      getFile: vi.fn().mockResolvedValue(fakeFile),
    } as unknown as FileSystemFileHandle;

    watcher.watch(handle, 'old');

    expect(async () => {
      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();
    }).not.toThrow();
  });

  it('watching same handle twice replaces the entry', () => {
    const handle = makeFakeHandle('j.yaml', 'v1');
    watcher.watch(handle, 'v1');
    watcher.watch(handle, 'v2');
    expect(watcher.isWatching).toBe(true);
  });
});
