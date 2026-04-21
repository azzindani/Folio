import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isNativeFS, openFile, saveFile, openProject } from './file-access';

// ── isNativeFS ───────────────────────────────────────────────
describe('isNativeFS', () => {
  it('returns false when showOpenFilePicker not in window', () => {
    const orig = (window as unknown as Record<string, unknown>).showOpenFilePicker;
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    expect(isNativeFS()).toBe(false);
    if (orig !== undefined) (window as unknown as Record<string, unknown>).showOpenFilePicker = orig;
  });

  it('returns true when showOpenFilePicker is in window', () => {
    (window as unknown as Record<string, unknown>).showOpenFilePicker = vi.fn();
    expect(isNativeFS()).toBe(true);
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
});

// ── openFile fallback path ───────────────────────────────────
describe('openFile — fallback path', () => {
  beforeEach(() => {
    // Ensure native FS is not available
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });

  it('resolves with file content when user selects a file', async () => {
    const fakeFile = new File(['hello yaml'], 'test.yaml', { type: 'text/yaml' });
    const fakeInput = document.createElement('input');

    // Spy on document.createElement to intercept the input
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'input') {
        setTimeout(() => {
          Object.defineProperty(fakeInput, 'files', { value: [fakeFile], configurable: true });
          fakeInput.dispatchEvent(new Event('change'));
        }, 0);
        return fakeInput;
      }
      return document.createElement.call(document, tag);
    });

    const result = await openFile('.yaml');
    expect(result.content).toBe('hello yaml');
    expect(result.name).toBe('test.yaml');
    expect(result.handle).toBeNull();
    vi.restoreAllMocks();
  });

  it('rejects when no file is selected (files is null)', async () => {
    const fakeInput = document.createElement('input');

    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'input') {
        setTimeout(() => {
          // files is null/empty
          Object.defineProperty(fakeInput, 'files', { value: null, configurable: true });
          fakeInput.dispatchEvent(new Event('change'));
        }, 0);
        return fakeInput;
      }
      return document.createElement.call(document, tag);
    });

    await expect(openFile()).rejects.toThrow('No file selected');
    vi.restoreAllMocks();
  });

  it('uses default accept when no accept parameter given', async () => {
    const fakeInput = document.createElement('input');
    let capturedInput: HTMLInputElement | null = null;

    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'input') {
        capturedInput = fakeInput;
        setTimeout(() => {
          Object.defineProperty(fakeInput, 'files', {
            value: [new File(['x'], 'f.yaml', { type: 'text/yaml' })],
            configurable: true,
          });
          fakeInput.dispatchEvent(new Event('change'));
        }, 0);
        return fakeInput;
      }
      return document.createElement.call(document, tag);
    });

    await openFile();
    expect((capturedInput as HTMLInputElement | null)?.accept).toBe('.yaml,.yml,.design.yaml');
    vi.restoreAllMocks();
  });
});

// ── saveFile fallback path ───────────────────────────────────
describe('saveFile — fallback path', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      value: vi.fn().mockReturnValue('blob:save-url'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls createObjectURL and triggers download', async () => {
    await saveFile('design content', 'my-design.yaml');
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:save-url');
  });

  it('uses default filename when no filename given', async () => {
    await saveFile('content');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('uses provided string filename', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await saveFile('content', 'export.yaml');
    expect(clickSpy).toHaveBeenCalled();
  });
});

// ── openFile native path ─────────────────────────────────────
describe('openFile — native FSA path', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });

  it('calls showOpenFilePicker and returns content', async () => {
    const fakeFile = {
      name: 'native.yaml',
      text: vi.fn().mockResolvedValue('native content'),
    };
    const fakeHandle = { getFile: vi.fn().mockResolvedValue(fakeFile) };
    const mockPicker = vi.fn().mockResolvedValue([fakeHandle]);
    (window as unknown as Record<string, unknown>).showOpenFilePicker = mockPicker;

    const result = await openFile('.yaml');
    expect(result.content).toBe('native content');
    expect(result.name).toBe('native.yaml');
    expect(result.handle).toBe(fakeHandle);
  });

  it('passes accept types to showOpenFilePicker', async () => {
    const fakeFile = { name: 'x.yaml', text: vi.fn().mockResolvedValue('') };
    const fakeHandle = { getFile: vi.fn().mockResolvedValue(fakeFile) };
    const mockPicker = vi.fn().mockResolvedValue([fakeHandle]);
    (window as unknown as Record<string, unknown>).showOpenFilePicker = mockPicker;

    await openFile('.yaml,.yml');
    expect(mockPicker).toHaveBeenCalledWith(expect.objectContaining({ types: expect.any(Array) }));
  });

  it('calls showOpenFilePicker without types when no accept given', async () => {
    const fakeFile = { name: 'x.yaml', text: vi.fn().mockResolvedValue('') };
    const fakeHandle = { getFile: vi.fn().mockResolvedValue(fakeFile) };
    const mockPicker = vi.fn().mockResolvedValue([fakeHandle]);
    (window as unknown as Record<string, unknown>).showOpenFilePicker = mockPicker;

    await openFile();
    expect(mockPicker).toHaveBeenCalledWith({ types: undefined });
  });
});

// ── saveFile native path ─────────────────────────────────────
describe('saveFile — native FSA path', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });

  it('uses provided handle to write without picker', async () => {
    const mockWritable = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    const fakeHandle = { createWritable: vi.fn().mockResolvedValue(mockWritable) };
    // Enable native FS
    (window as unknown as Record<string, unknown>).showOpenFilePicker = vi.fn();

    await saveFile('content', fakeHandle as unknown as FileSystemFileHandle);
    expect(fakeHandle.createWritable).toHaveBeenCalled();
    expect(mockWritable.write).toHaveBeenCalledWith('content');
    expect(mockWritable.close).toHaveBeenCalled();
  });

  it('shows save picker when no handle provided', async () => {
    const mockWritable = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    const fakeHandle = { createWritable: vi.fn().mockResolvedValue(mockWritable) };
    const mockSavePicker = vi.fn().mockResolvedValue(fakeHandle);
    (window as unknown as Record<string, unknown>).showOpenFilePicker = vi.fn();
    (window as unknown as Record<string, unknown>).showSaveFilePicker = mockSavePicker;

    await saveFile('content');
    expect(mockSavePicker).toHaveBeenCalled();
    expect(mockWritable.write).toHaveBeenCalledWith('content');
  });
});

// ── openProject ──────────────────────────────────────────────
describe('openProject', () => {
  it('resolves using .yaml,.yml accept', async () => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    const fakeInput = document.createElement('input');
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'input') {
        setTimeout(() => {
          Object.defineProperty(fakeInput, 'files', {
            value: [new File(['yaml'], 'proj.yaml', { type: 'text/yaml' })],
            configurable: true,
          });
          fakeInput.dispatchEvent(new Event('change'));
        }, 0);
        return fakeInput;
      }
      return document.createElement.call(document, tag);
    });

    const result = await openProject();
    expect(result.name).toBe('proj.yaml');
    vi.restoreAllMocks();
  });
});
