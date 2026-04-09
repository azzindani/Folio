export interface FileHandle {
  name: string;
  kind: 'file';
  read: () => Promise<string>;
  write: (content: string) => Promise<void>;
}

export interface DirectoryHandle {
  name: string;
  kind: 'directory';
  entries: () => AsyncIterable<[string, FileHandle | DirectoryHandle]>;
  getFile: (name: string) => Promise<FileHandle>;
  getDirectory: (name: string) => Promise<DirectoryHandle>;
}

// Check if native File System Access API is available
export function isNativeFS(): boolean {
  return 'showOpenFilePicker' in window;
}

// ── Native FSA API (Chrome desktop) ─────────────────────────
async function openFileNative(accept?: string): Promise<{ content: string; name: string; handle: unknown }> {
  const types = accept ? [{
    description: 'Design files',
    accept: { 'text/yaml': accept.split(',').map(a => a.trim()) },
  }] : undefined;

  const [handle] = await (window as unknown as {
    showOpenFilePicker: (opts?: unknown) => Promise<FileSystemFileHandle[]>;
  }).showOpenFilePicker({ types });

  const file = await handle.getFile();
  const content = await file.text();
  return { content, name: file.name, handle };
}

async function saveFileNative(content: string, handle?: unknown): Promise<void> {
  let fh = handle as FileSystemFileHandle | undefined;

  if (!fh) {
    fh = await (window as unknown as {
      showSaveFilePicker: (opts?: unknown) => Promise<FileSystemFileHandle>;
    }).showSaveFilePicker({
      types: [{
        description: 'Design YAML',
        accept: { 'text/yaml': ['.yaml', '.design.yaml'] },
      }],
    });
  }

  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

// ── Fallback (<input type="file"> + download) ──────────────
function openFileFallback(accept?: string): Promise<{ content: string; name: string; handle: null }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept ?? '.yaml,.yml,.design.yaml';

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const content = await file.text();
      resolve({ content, name: file.name, handle: null });
    });

    input.click();
  });
}

function saveFileFallback(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Public API ──────────────────────────────────────────────
export async function openFile(accept?: string): Promise<{ content: string; name: string; handle: unknown }> {
  if (isNativeFS()) {
    return openFileNative(accept);
  }
  return openFileFallback(accept);
}

export async function saveFile(content: string, filenameOrHandle?: string | unknown): Promise<void> {
  if (isNativeFS() && typeof filenameOrHandle !== 'string') {
    return saveFileNative(content, filenameOrHandle);
  }
  const filename = typeof filenameOrHandle === 'string' ? filenameOrHandle : 'design.yaml';
  saveFileFallback(content, filename);
}

export async function openProject(): Promise<{ content: string; name: string; handle: unknown }> {
  return openFile('.yaml,.yml');
}
