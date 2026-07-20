// Live interactive preview — runs the REAL exported report inside the editor.
//
// The canvas draws interactive_* layers as a static SVG approximation (Vega
// snapshot of a chart, plain rows for a table). That approximation is right for
// LAYOUT work — it is selectable, draggable, snappable — but it can never show
// a filter actually filtering or a tab actually switching, because Chart.js and
// the report client runtime only exist in exported HTML.
//
// So this mode stops approximating: it calls assembleReportHTML — the exact
// function `export → Interactive Report (HTML)` calls — and runs the result in
// a sandboxed iframe. Preview and export cannot drift, because they are the
// same code path fed the same spec. What you see here IS the artifact.

import type { DesignSpec } from '../schema/types';
import type { StateManager, EditorState } from './state';
import { loadPreviewDatasets } from './preview-data';

// html-assembler is imported DYNAMICALLY, not statically. It pulls in the whole
// interactive-renderer + report stack; a static import folds all of that into
// the main entry chunk and pushes it past the 500 KB budget. Preview is an
// opt-in mode, so the cost belongs in a lazy chunk loaded on first use —
// exporter.ts imports it the same way for the same reason.

const REBUILD_DEBOUNCE_MS = 300;

// Injected into the previewed document so scroll survives a rebuild. The iframe
// is sandboxed WITHOUT allow-same-origin (scripts in the design can't reach the
// editor), which also means the editor can't read its scrollY — hence
// postMessage rather than a direct property read.
const SCROLL_SHIM = `<script>
(function(){
  var post=function(){
    try{parent.postMessage({__folioPreview:'scroll',y:window.scrollY||0},'*');}catch(e){}
  };
  window.addEventListener('scroll',post,{passive:true});
  window.addEventListener('message',function(e){
    var d=e.data;
    if(d&&d.__folioPreview==='restore'&&typeof d.y==='number')window.scrollTo(0,d.y);
  });
  parent.postMessage({__folioPreview:'ready'},'*');
})();
<\/script>`;

export class LivePreview {
  private container: HTMLDivElement;
  private frame: HTMLIFrameElement;
  private status: HTMLDivElement;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollY = 0;
  private pendingRestore = false;
  private theme: 'light' | 'dark' = 'dark';
  private lastSerialized = '';
  private disposed = false;

  constructor(private state: StateManager, mount: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'live-preview';
    this.container.style.cssText = [
      'position:absolute', 'inset:0', 'display:none',
      'flex-direction:column', 'background:var(--color-bg)', 'z-index:40',
    ].join(';');

    this.status = document.createElement('div');
    this.status.className = 'live-preview-status';
    this.status.style.cssText = [
      'flex:0 0 auto', 'display:none', 'padding:6px 10px',
      'font-size:11px', 'line-height:1.5',
      'border-bottom:1px solid var(--color-border)',
      'background:var(--color-surface-2)', 'color:var(--color-text-muted)',
    ].join(';');

    this.frame = document.createElement('iframe');
    this.frame.className = 'live-preview-frame';
    this.frame.title = 'Interactive report preview';
    // allow-scripts runs Chart.js and the report runtime; allow-same-origin is
    // deliberately withheld so previewed scripts get an opaque origin and cannot
    // touch the editor document, cookies, or the auth token in this page.
    this.frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-forms');
    this.frame.style.cssText = 'flex:1 1 auto;width:100%;border:0;background:#fff';

    this.container.appendChild(this.status);
    this.container.appendChild(this.frame);
    mount.appendChild(this.container);

    window.addEventListener('message', this.onMessage);
    this.state.subscribe(this.onStateChange);

    // This module is loaded lazily, so the user may already be in preview mode
    // by the time it arrives — that mode change fired before we subscribed.
    // Sync to current state rather than waiting for the next one.
    if (this.state.get().mode === 'preview') {
      this.container.style.display = 'flex';
      this.scheduleRebuild(true);
    }
  }

  private onMessage = (e: MessageEvent): void => {
    // Only trust messages from our own frame; the opaque origin means the
    // origin string is "null", so identity has to come from the source window.
    if (e.source !== this.frame.contentWindow) return;
    const data = e.data as { __folioPreview?: string; y?: number } | null;
    if (!data || typeof data.__folioPreview !== 'string') return;

    if (data.__folioPreview === 'scroll' && typeof data.y === 'number') {
      this.scrollY = data.y;
    } else if (data.__folioPreview === 'ready' && this.pendingRestore) {
      this.pendingRestore = false;
      this.frame.contentWindow?.postMessage({ __folioPreview: 'restore', y: this.scrollY }, '*');
    }
  };

  private onStateChange = (state: EditorState, changedKeys: (keyof EditorState)[]): void => {
    if (changedKeys.includes('mode')) {
      const active = state.mode === 'preview';
      this.container.style.display = active ? 'flex' : 'none';
      // Build on entry so switching in always shows current work, even if the
      // design changed while another mode was active.
      if (active) this.scheduleRebuild(true);
    }

    if (changedKeys.includes('design') && this.state.get().mode === 'preview') {
      this.scheduleRebuild(false);
    }
  };

  setTheme(theme: string): void {
    this.theme = theme === 'light' ? 'light' : 'dark';
    if (this.state.get().mode === 'preview') this.scheduleRebuild(true);
  }

  private scheduleRebuild(immediate: boolean): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    if (immediate) {
      void this.rebuild();
      return;
    }
    this.rebuildTimer = setTimeout(() => { void this.rebuild(); }, REBUILD_DEBOUNCE_MS);
  }

  private setStatus(message: string, tone: 'info' | 'error'): void {
    if (!message) {
      this.status.style.display = 'none';
      this.status.textContent = '';
      return;
    }
    this.status.style.display = 'block';
    this.status.textContent = message;
    this.status.style.color = tone === 'error' ? 'var(--color-danger, #f87171)' : 'var(--color-text-muted)';
  }

  private async rebuild(): Promise<void> {
    this.rebuildTimer = null;
    const design = this.state.get().design;
    if (!design) {
      this.setStatus('No design loaded.', 'info');
      this.frame.srcdoc = '';
      return;
    }

    try {
      const html = await this.buildHTML(design);
      // A no-op edit (selection change, panel toggle) would otherwise reload the
      // frame and throw away chart state and filter selections mid-interaction.
      if (html === this.lastSerialized) return;
      this.lastSerialized = html;
      this.pendingRestore = true;
      this.frame.srcdoc = html;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus(`Preview failed: ${message}`, 'error');
    }
  }

  private async buildHTML(design: DesignSpec): Promise<string> {
    const { datasets, unavailable } = await loadPreviewDatasets(design.report?.data?.sources);

    if (unavailable.length > 0) {
      const detail = unavailable.map(u => `${u.id} (${u.reason})`).join(' · ');
      this.setStatus(`Preview only — data unavailable in browser: ${detail}`, 'info');
    } else {
      this.setStatus('', 'info');
    }

    const { assembleReportHTML } = await import('../export/html-assembler');
    const html = assembleReportHTML(design, datasets, {
      theme: this.theme,
      title: design.meta.name,
    });

    // Append the shim last so it runs after the report's own scripts.
    return html.includes('</body>')
      ? html.replace('</body>', `${SCROLL_SHIM}</body>`)
      : html + SCROLL_SHIM;
  }

  /** Current preview HTML — used by tests and by "open preview in a new tab". */
  getHTML(): string {
    return this.lastSerialized;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    window.removeEventListener('message', this.onMessage);
    this.container.remove();
  }
}
