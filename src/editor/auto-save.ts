/**
 * AutoSaveManager — periodic dirty-state flush to the active FileSystemFileHandle.
 *
 * Saves at most once per interval when the design is dirty.
 * Emits 'saved' / 'error' events so the UI can update the tab dirty indicator.
 */

type SaveFn = () => Promise<string | null>; // returns YAML or null if nothing to save

export class AutoSaveManager {
  private intervalMs: number;
  private getSaveContent: SaveFn;
  private fileHandle: FileSystemFileHandle | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onSaved: (() => void) | null = null;
  private onError: ((err: unknown) => void) | null = null;
  private pending = false;

  constructor(intervalMs: number, getSaveContent: SaveFn) {
    this.intervalMs = intervalMs;
    this.getSaveContent = getSaveContent;
  }

  setFileHandle(handle: FileSystemFileHandle | null): void {
    this.fileHandle = handle;
  }

  markDirty(): void {
    this.pending = true;
  }

  onSavedCallback(fn: () => void): void { this.onSaved = fn; }
  onErrorCallback(fn: (err: unknown) => void): void { this.onError = fn; }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.flush(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Force an immediate save regardless of dirty flag. */
  async saveNow(): Promise<void> {
    this.pending = true;
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (!this.pending || !this.fileHandle) return;
    this.pending = false;

    try {
      const yaml = await this.getSaveContent();
      if (yaml === null) return;

      const writable = await this.fileHandle.createWritable();
      await writable.write(yaml);
      await writable.close();
      this.onSaved?.();
    } catch (err) {
      this.pending = true; // retry on next tick
      this.onError?.(err);
    }
  }
}
