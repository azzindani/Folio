/**
 * File Watcher — polls for external changes to .design.yaml files and notifies subscribers.
 *
 * Uses the File System Access API (Chrome desktop) where available,
 * falling back to a no-op on platforms that don't support it.
 *
 * Poll interval: 1500ms — frequent enough to feel live, cheap enough not to matter.
 */

export interface WatchedFile {
  name: string;
  handle: FileSystemFileHandle;
  lastContent: string;
  lastModified: number;
}

export type FileChangeCallback = (name: string, content: string) => void;

const POLL_INTERVAL_MS = 1500;

export class FileWatcher {
  private watched: Map<string, WatchedFile> = new Map();
  private callbacks: Set<FileChangeCallback> = new Set();
  private timerId: ReturnType<typeof setInterval> | null = null;
  private enabled: boolean;

  constructor() {
    // Only meaningful on platforms with native FSA
    this.enabled = typeof window !== 'undefined' && 'showOpenFilePicker' in window;
  }

  /** Watch a file handle for external modifications. */
  watch(handle: FileSystemFileHandle, initialContent: string): void {
    if (!this.enabled) return;

    this.watched.set(handle.name, {
      name: handle.name,
      handle,
      lastContent: initialContent,
      lastModified: Date.now(),
    });

    this.startPolling();
  }

  /** Stop watching a file by name. */
  unwatch(name: string): void {
    this.watched.delete(name);
    if (this.watched.size === 0) this.stopPolling();
  }

  /** Remove all watched files. */
  unwatchAll(): void {
    this.watched.clear();
    this.stopPolling();
  }

  /** Register a callback invoked when any watched file changes. */
  onChange(cb: FileChangeCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  /** True if any files are currently being watched. */
  get isWatching(): boolean {
    return this.watched.size > 0;
  }

  private startPolling(): void {
    if (this.timerId !== null || !this.enabled) return;
    this.timerId = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.timerId === null) return;
    clearInterval(this.timerId);
    this.timerId = null;
  }

  private async poll(): Promise<void> {
    for (const [name, entry] of this.watched) {
      try {
        const file = await entry.handle.getFile();
        // File.lastModified changes when file is written externally
        if (file.lastModified <= entry.lastModified) continue;

        const content = await file.text();
        if (content === entry.lastContent) {
          // Update timestamp so we don't re-read unchanged content repeatedly
          entry.lastModified = file.lastModified;
          continue;
        }

        entry.lastContent = content;
        entry.lastModified = file.lastModified;

        for (const cb of this.callbacks) {
          try {
            cb(name, content);
          } catch {
            // Callback errors must not break the watcher loop
          }
        }
      } catch {
        // Handle may be revoked (file deleted/moved) — stop watching it
        this.watched.delete(name);
      }
    }

    if (this.watched.size === 0) this.stopPolling();
  }
}

/** Singleton watcher instance shared across the editor. */
export const fileWatcher = new FileWatcher();
