// Project folder manager — File System Access API.
// User picks a local folder once; all images inside are served as blob URLs.
// Falls back to drag-drop (no picker) on browsers without the API.

export interface AssetEntry {
  name: string;
  path: string;   // relative path within the folder
  handle: FileSystemFileHandle;
  blobUrl?: string;
}

type ChangeListener = (assets: AssetEntry[]) => void;

const IMAGE_RE = /\.(png|jpg|jpeg|gif|webp|svg)$/i;

export class ProjectFolderManager {
  private root: FileSystemDirectoryHandle | null = null;
  private assets: AssetEntry[] = [];
  private blobCache = new Map<string, string>();
  private listeners: ChangeListener[] = [];

  get isOpen(): boolean { return this.root !== null; }
  get rootName(): string { return this.root?.name ?? ''; }

  async open(): Promise<void> {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('Folder picker not supported — drag image files onto the canvas instead');
    }
    this.root = await (window as Window & { showDirectoryPicker(opts?: object): Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker({ mode: 'read' });
    await this.scan();
  }

  close(): void {
    this.blobCache.forEach(u => URL.revokeObjectURL(u));
    this.blobCache.clear();
    this.root = null;
    this.assets = [];
    this.emit();
  }

  getAssets(): AssetEntry[] { return this.assets; }

  async getBlobUrl(entry: AssetEntry): Promise<string> {
    const cached = this.blobCache.get(entry.path);
    if (cached) return cached;
    const file = await entry.handle.getFile();
    const url = URL.createObjectURL(file);
    this.blobCache.set(entry.path, url);
    return url;
  }

  onChange(fn: ChangeListener): void { this.listeners.push(fn); }

  private async scan(): Promise<void> {
    this.assets = [];
    if (this.root) await this.scanDir(this.root, '');
    this.emit();
  }

  private async scanDir(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    // FileSystemDirectoryHandle is async iterable
    for await (const entry of dir.values()) {
      const name = entry.name;
      if (entry.kind === 'file' && IMAGE_RE.test(name)) {
        const path = prefix ? `${prefix}/${name}` : name;
        this.assets.push({ name, path, handle: entry as FileSystemFileHandle });
      } else if (entry.kind === 'directory' && !name.startsWith('.')) {
        await this.scanDir(entry as FileSystemDirectoryHandle, prefix ? `${prefix}/${name}` : name);
      }
    }
  }

  private emit(): void {
    this.listeners.forEach(fn => fn(this.assets));
  }
}

export const projectFolder = new ProjectFolderManager();
