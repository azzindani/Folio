/**
 * AutoSaveManager — periodic dirty-state flush to whichever sink is active:
 *
 *   • a server design path (designs opened from the MCP / library) — the YAML is
 *     PUT back to /__project_files/<rel> so edits persist server-side, the way a
 *     user expects "it just saves". This is the primary path for Folio.
 *   • a browser FileSystemFileHandle (a local .design.yaml opened via the file
 *     picker) — the legacy "save to a directory on disk" path.
 *
 * Server sink takes priority when both are set. Saves at most once per interval
 * when dirty. Emits 'saved' / 'error' so the UI can update the tab indicator.
 */

type SaveFn = () => Promise<string | null>; // returns YAML or null if nothing to save
type ServerSink = (yaml: string) => Promise<void>; // PUT the YAML to the server

export class AutoSaveManager {
  private intervalMs: number;
  private getSaveContent: SaveFn;
  private fileHandle: FileSystemFileHandle | null = null;
  private serverSink: ServerSink | null = null;
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

  /** Route saves to a server design path (priority over a file handle). Pass
   *  null to detach (e.g. when the design is no longer backed by a server file). */
  setServerSink(sink: ServerSink | null): void {
    this.serverSink = sink;
  }

  /** True when there is somewhere to persist to — server path or file handle. */
  hasSink(): boolean {
    return this.serverSink !== null || this.fileHandle !== null;
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

  /** Force an immediate save regardless of dirty flag. Resolves true if it
   *  actually persisted (so a manual Ctrl+S can report success accurately). */
  async saveNow(): Promise<boolean> {
    this.pending = true;
    return this.flush();
  }

  private async flush(): Promise<boolean> {
    if (!this.pending || (!this.serverSink && !this.fileHandle)) return false;
    this.pending = false;

    try {
      const yaml = await this.getSaveContent();
      if (yaml === null) return false;

      if (this.serverSink) {
        await this.serverSink(yaml);
      } else if (this.fileHandle) {
        const writable = await this.fileHandle.createWritable();
        await writable.write(yaml);
        await writable.close();
      }
      this.onSaved?.();
      return true;
    } catch (err) {
      this.pending = true; // retry on next tick
      this.onError?.(err);
      return false;
    }
  }
}
