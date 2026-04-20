import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoSaveManager } from './auto-save';

function makeHandle(name = 'test.yaml'): FileSystemFileHandle {
  const writable = {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    name,
    createWritable: vi.fn().mockResolvedValue(writable),
  } as unknown as FileSystemFileHandle;
}

describe('AutoSaveManager', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does not save when not dirty', async () => {
    const getSave = vi.fn().mockResolvedValue('yaml content');
    const mgr = new AutoSaveManager(5000, getSave);
    const handle = makeHandle();
    mgr.setFileHandle(handle);
    // Not marked dirty → should not flush
    await vi.runAllTimersAsync();
    expect(getSave).not.toHaveBeenCalled();
  });

  it('saves when dirty and handle is set', async () => {
    const onSaved = vi.fn();
    const mgr = new AutoSaveManager(5000, async () => 'yaml content');
    const handle = makeHandle();
    mgr.setFileHandle(handle);
    mgr.onSavedCallback(onSaved);
    mgr.markDirty();
    mgr.start();

    await vi.advanceTimersByTimeAsync(5001);
    await Promise.resolve(); // flush microtasks

    expect(handle.createWritable).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it('saveNow forces immediate save', async () => {
    const onSaved = vi.fn();
    const mgr = new AutoSaveManager(60_000, async () => 'yaml');
    const handle = makeHandle();
    mgr.setFileHandle(handle);
    mgr.onSavedCallback(onSaved);
    await mgr.saveNow();
    expect(onSaved).toHaveBeenCalled();
  });

  it('does not save when no file handle', async () => {
    const getSave = vi.fn().mockResolvedValue('yaml');
    const mgr = new AutoSaveManager(1000, getSave);
    mgr.markDirty();
    mgr.start();
    await vi.advanceTimersByTimeAsync(1001);
    await Promise.resolve();
    expect(getSave).not.toHaveBeenCalled();
  });

  it('calls onError when write fails', async () => {
    const onError = vi.fn();
    const handle = {
      name: 'fail.yaml',
      createWritable: vi.fn().mockRejectedValue(new Error('Permission denied')),
    } as unknown as FileSystemFileHandle;
    const mgr = new AutoSaveManager(1000, async () => 'yaml');
    mgr.setFileHandle(handle);
    mgr.onErrorCallback(onError);
    mgr.markDirty();
    mgr.start();
    await vi.advanceTimersByTimeAsync(1001);
    await Promise.resolve();
    expect(onError).toHaveBeenCalled();
  });

  it('stop prevents further saves', async () => {
    const onSaved = vi.fn();
    const mgr = new AutoSaveManager(1000, async () => 'yaml');
    mgr.setFileHandle(makeHandle());
    mgr.onSavedCallback(onSaved);
    mgr.markDirty();
    mgr.start();
    mgr.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
