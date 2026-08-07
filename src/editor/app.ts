import { StateManager } from './state';
import { CanvasManager } from './canvas';
import { setAssetUrlResolver } from '../renderer/render-context';
import { PayloadEditor } from './payload-editor';
import { ToolbarManager } from '../ui/toolbar/toolbar';
import { LayerPanelManager } from '../ui/panels/layer-panel';
import { PropertiesPanelManager } from '../ui/panels/properties-panel';
import { DataPanelManager } from '../ui/panels/data-panel';
import { ScriptPanelManager } from '../ui/panels/script-panel';
import { ProblemsPanelManager } from '../ui/panels/problems-panel';
import { FileTreeManager } from '../ui/panels/file-tree';
import { PageStrip } from '../ui/panels/page-strip';
import { IconBrowserManager } from '../ui/panels/icon-browser';
import { FindReplaceManager } from '../ui/panels/find-replace';
import { PresentationMode } from '../ui/presentation/presentation-mode';
import { MinimapManager } from '../ui/panels/minimap';
import { AccessibilityChecker } from '../ui/panels/accessibility-checker';
import { openPrintWindow } from '../export/print-mode';
import { AlignToolbar } from '../ui/tools/align-toolbar';
import { CanvasContextMenu } from './context-menu';
import { ToolboxManager } from '../ui/tools/toolbox';
import { CommandPalette } from '../ui/palette/command-palette';
import { KeyboardManager } from './keyboard';
import { parseDesign, serializeYAML } from '../schema/parser';
import { validateDesignSpec } from '../schema/validator';
import type { DesignSpec, ThemeSpec } from '../schema/types';
import { ensureDesignFonts, loadProjectFonts } from '../styles/font-loader';
import { fileWatcher } from '../fs/file-watcher';
import { BUILTIN_THEMES } from '../themes/builtin';
import { TabBarManager } from '../ui/tabs/tab-bar';
import { ViewportLayoutManager } from '../ui/viewport/viewport-layout';
import { AutoSaveManager } from './auto-save';
import { ColorPaletteManager } from '../ui/panels/color-palette';
import { ComponentLibraryManager } from '../ui/panels/component-library';
import { AnimationPanel } from '../ui/panels/animation-panel';
import { ImageImportHandler } from './image-import-handler';
import { TimelinePanelManager } from '../ui/panels/timeline-panel';
import { ColorSchemePanelManager } from '../ui/panels/color-scheme-panel';
import { loadFullPalette } from '../styles/palette-loader';
import { loadFullTypePack } from '../styles/type-pack-loader';
import { loadFullEffectsPack } from '../styles/effects-pack-loader';
import { EditorAppBase } from './app-base';
import { wireMobileToolbarOverflow } from './mobile-toolbar';
import { SAMPLE_DESIGN } from './sample-design';
import { makeBlankDesign } from './blank-design';
import { canvasResizeDialog, type CanvasDocSpec } from '../ui/dialogs/canvas-resize';

export class EditorApp extends EditorAppBase {
  /** Path (relative to the projects dir) of the design when it was opened from
   *  the library / MCP — the target for server-backed auto-save. Null until a
   *  design is opened from or first saved into the library. */
  private serverDesignRel: string | null = null;

  constructor(container: HTMLElement) {
    super();
    this.container = container;
    this.state = new StateManager();
  }
  async init(): Promise<void> {
    this.buildLayout();
    this.initAutoSave();

    // Tab bar (Sprint 2 — file tabs)
    const tabBarContainer = this.container.querySelector<HTMLElement>('.tab-bar-container')!;
    this.tabBar = new TabBarManager(
      tabBarContainer,
      this.state,
      (tab) => this.loadFromYAML(tab.yamlSource),
      (_tabId) => { /* handle close — open blank if last tab */ },
    );

    // Viewport layout (Sprint 2 — split panes)
    const viewportArea = this.container.querySelector<HTMLElement>('.viewport-area')!;
    this.viewportLayout = new ViewportLayoutManager(viewportArea);

    // Primary canvas mounts into the active pane
    const primaryPane = this.viewportLayout.getActivePaneEl()
      ?? this.container.querySelector('.canvas-section')!;

    this.canvas = new CanvasManager(primaryPane, this.state);
    // Pinch/pan/long-press/double-tap. The canvas's own input path is mouse and
    // wheel only, which on a phone left no way to move the view at all. Loaded
    // only where there is a touchscreen — it is dead weight in the desktop
    // bundle, which sits within a KB of its budget.
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      void import('./touch-gestures').then(m => m.wireTouchGestures(primaryPane, this.state));
    }

    // Refit the canvas when the viewport changes so design content stays
    // visible after window resize or device-orientation change. Debounced
    // to coalesce rapid resize events.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.canvas?.fitToScreen?.(), 150);
    });

    this.toolbar = new ToolbarManager(
      this.container.querySelector('.toolbar')!,
      this.state,
      this,
    );
    // After the toolbar exists — the overflow sheet MOVES its controls, so it
    // has nothing to collect while buildLayout's .toolbar is still empty.
    wireMobileToolbarOverflow(this.container);

    this.toolbox = new ToolboxManager(
      this.container.querySelector('.tools-panel')!,
      this.state,
    );

    this.alignToolbar = new AlignToolbar(primaryPane, this.state);
    new CanvasContextMenu(this.state, primaryPane as HTMLElement);

    this.fileTree = new FileTreeManager(
      this.container.querySelector('.file-tree-content')!,
      this.state,
      {
        onOpen: (yaml, name, handle) => {
          this.loadFromYAML(yaml);
          if (handle) this.setActiveFileHandle(handle as FileSystemFileHandle, yaml);
          this.state.get().design && (this.state.get().design!.meta.name = name.replace(/\..*$/, ''));
        },
        onSave: () => this.getYAML(),
        onServerSave: () => this.saveToActiveTarget(),
      },
    );

    this.layerPanel = new LayerPanelManager(
      this.container.querySelector('.layer-panel')!,
      this.state,
    );

    this.propertiesPanel = new PropertiesPanelManager(
      this.container.querySelector('.properties-content')!,
      this.state,
    );

    const dataContainer = this.container.querySelector<HTMLElement>('.data-content');
    if (dataContainer) this.dataPanel = new DataPanelManager(dataContainer, this.state);

    const scriptsContainer = this.container.querySelector<HTMLElement>('.scripts-content');
    if (scriptsContainer) this.scriptPanel = new ScriptPanelManager(scriptsContainer, this.state);

    this.problemsPanel = new ProblemsPanelManager(
      this.container.querySelector('.problems-content')!,
      this.state,
    );

    this.iconBrowser = new IconBrowserManager(
      this.container.querySelector('.icon-browser-content')!,
      this.state,
    );

    this.findReplace = new FindReplaceManager(
      this.container.querySelector('.find-replace-content')!,
      this.state,
    );

    this.presentation = new PresentationMode(this.state);

    this.minimap = new MinimapManager(
      this.container.querySelector('.minimap-container')!,
      this.state,
    );

    this.a11y = new AccessibilityChecker(
      this.container.querySelector('.a11y-content')!,
      this.state,
    );

    // Color palette — wires pick callback to active color property
    this.colorPalette = new ColorPaletteManager(
      this.container.querySelector('.color-palette-content')!,
      this.state,
      (hex) => {
        // Apply to first selected layer's fill color (best-effort)
        const sel = this.state.getSelectedLayers();
        if (sel.length > 0) {
          const l = sel[0] as unknown as { id: string; fill?: Record<string, unknown> };
          if (l.fill && typeof l.fill === 'object') {
            this.state.updateLayer(l.id, { fill: { ...l.fill, color: hex } } as Parameters<typeof this.state.updateLayer>[1]);
          }
        }
      },
    );

    // Image import: paste / drag-drop SVG + PNG onto the canvas
    this.imageImport = new ImageImportHandler(this.state);
    this.imageImport.setPalette(this.colorPalette);
    this.imageImport.wire(this.container);
    this.wireAssetPanel();

    // Animation panel
    const animContainer = this.container.querySelector<HTMLElement>('.animate-content');
    if (animContainer) {
      this.animationPanel = new AnimationPanel(animContainer, this.state);
    }

    // Timeline panel
    const timelineContainer = this.container.querySelector<HTMLElement>('.timeline-content');
    if (timelineContainer) {
      this.timelinePanel = new TimelinePanelManager(timelineContainer, this.state);
    }

    // Color scheme panel (inside colors tab)
    const schemeContainer = this.container.querySelector<HTMLElement>('.color-scheme-content');
    if (schemeContainer) {
      this.colorSchemePanel = new ColorSchemePanelManager(schemeContainer, hex => {
        this.colorPalette['onPick'](hex);
      });
    }

    // Component library panel
    const compContainer = this.container.querySelector<HTMLElement>('.comp-library-content');
    if (compContainer) {
      this.componentLibrary = new ComponentLibraryManager(compContainer, this.state);
    }

    // Page strip lives in its own resizable section below the canvas
    this.pageStrip = new PageStrip(
      this.container.querySelector('.page-strip-content')!,
      this.state,
    );
    // Show/hide page strip section based on whether design has pages
    this.state.subscribe((state, keys) => {
      if (!keys.includes('design')) return;
      const section = this.container.querySelector<HTMLElement>('#page-strip-section');
      if (!section) return;
      const hasPages = (state.design?.pages?.length ?? 0) > 0;
      section.style.display = hasPages ? '' : 'none';
    });

    this.wireStatusBar();
    this.mountLivePreview();
    this.keyboard = new KeyboardManager(this.state, this);

    // Command palette
    this.commandPalette = new CommandPalette(this.container, this.state, this);

    // Initialize Monaco payload editor (lazy loaded)
    // viewportArea is cleared by ViewportLayoutManager, so create the container programmatically
    const monacoContainer = document.createElement('div');
    monacoContainer.className = 'monaco-container';
    monacoContainer.style.display = 'none';
    viewportArea.appendChild(monacoContainer);
    this.payloadEditor = new PayloadEditor(monacoContainer, this.state);
    this.payloadEditor.init().catch(() => {
      // Monaco failed to load — payload mode unavailable but visual mode still works
      import('../utils/toast').then(({ showToast }) => {
        showToast('Payload editor unavailable — visual mode only', 'warning');
      });
    });

    // Load default theme + sample design
    this.state.set('theme', BUILTIN_THEMES['dark-tech']);
    this.loadDesign(SAMPLE_DESIGN);

    // File watcher: reload design when YAML is modified externally
    fileWatcher.onChange((_name, content) => {
      try {
        this.loadFromYAML(content);
      } catch {
        // Invalid YAML from external editor — ignore until it's valid
      }
    });

    // MCP live-refresh: when the user opens the editor with `?mcp_url=...`
    // (typically minted by the MCP `open_in_editor` tool), subscribe to
    // /editor/events on the MCP HTTP server and reload the design as soon
    // as a tool call mutates the underlying YAML.
    this.subscribeMCPLiveRefresh();
  }

  private subscribeMCPLiveRefresh(): void {
    if (typeof location === 'undefined' || typeof EventSource === 'undefined') return;
    void import('./mcp-events').then(({ subscribeMCPEvents, parseMCPParams }) => {
      const params = parseMCPParams();

      // Jupyter-style ?token=: stash for fetches and SSE. Stick in
      // sessionStorage so reload-without-token-in-URL still authenticates.
      const urlToken = new URLSearchParams(location.search).get('token');
      if (urlToken) {
        try { sessionStorage.setItem('folio_editor_token', urlToken); } catch { /* private mode */ }
      }

      // Initial load: open_in_editor produces URLs with ?file=/abs/path
      // pointing at a design YAML on disk. Fetch via /__project_files/*.
      if (params.designPath) void this.loadFromQueryParam(params.designPath);

      if (!params.mcpUrl) return;
      try {
        subscribeMCPEvents({
          mcpUrl: params.mcpUrl,
          designPath: params.designPath,
          // EventSource doesn't support headers — pass the token in the URL.
          token: this.readEditorToken(),
          onFileChanged: (yamlContent) => {
            try { this.loadFromYAML(yamlContent); } catch { /* invalid YAML — wait for next event */ }
            void import('../utils/toast').then(({ showToast }) => showToast('Design updated by MCP', 'info'));
          },
          onError: () => { /* connection blip — EventSource auto-reconnects */ },
        });
      } catch { /* MCP server unreachable — silent fallback */ }
    });
  }

  private readEditorToken(): string | undefined {
    try {
      const fromUrl = new URLSearchParams(location.search).get('token');
      if (fromUrl) return fromUrl;
      const fromStore = sessionStorage.getItem('folio_editor_token');
      return fromStore ?? undefined;
    } catch { return undefined; }
  }

  private async loadFromQueryParam(absDesignPath: string): Promise<void> {
    // Map container-side absolute path → relative URL under /files/. The
    // host's bind-mount makes /home/folio/projects/<x> visible at /files/<x>.
    const PROJECTS_PREFIX = '/home/folio/projects/';
    let rel: string;
    if (absDesignPath.startsWith(PROJECTS_PREFIX)) {
      rel = absDesignPath.slice(PROJECTS_PREFIX.length);
    } else {
      // Local dev: project paths may live anywhere on disk. Fall back to
      // the basename — the user can still use Files panel to open it.
      // eslint-disable-next-line no-console
      console.warn('[editor] ?file= path is outside FOLIO_PROJECTS_DIR; cannot auto-load:', absDesignPath);
      return;
    }
    // /__project_files/* is served by the editor's own static-server and
    // shares its auth scope (no separate Caddy basic_auth realm to confuse
    // the browser). Avoids fetch-vs-cached-basic-auth quirks.
    const url = `/__project_files/${rel.split('/').map(encodeURIComponent).join('/')}`;
    const token = this.readEditorToken();
    try {
      const r = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[editor] could not fetch ?file= target: ${r.status} ${url}`);
        return;
      }
      const yamlContent = await r.text();
      // Install the asset-URL resolver BEFORE the first render — the canvas
      // caches per-layer SVG, so a resolver installed after loadFromYAML
      // would leave relative image srcs broken until the layer changes.
      this.wireProjectAssets(rel);
      this.loadFromYAML(yamlContent);
      // Route auto-save (and Ctrl+S) back to this server file so edits persist
      // in the library — no browser file handle needed.
      this.serverDesignRel = rel;
      this.autoSave.setServerSink((y) => this.putDesignToServer(rel, y));
      void import('../utils/toast').then(({ showToast }) => showToast(`Loaded ${rel.split('/').pop() ?? rel}`, 'success'));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[editor] ?file= load failed:', err);
      // Surface it — otherwise the canvas silently keeps the sample design and
      // the user thinks their file produced someone else's poster.
      const msg = err instanceof Error ? err.message : String(err);
      void import('../utils/toast').then(({ showToast }) =>
        showToast(`Could not open ${rel.split('/').pop() ?? rel}: ${msg}`, 'error'));
    }
  }

  /** Server-backed design: route relative image srcs through the authed
   *  project-files mount, and turn image DROPS into project-asset uploads
   *  (plain file + src:"assets/images/…", not base64 inside the YAML). */
  private wireProjectAssets(designRel: string): void {
    const project = designRel.split('/')[0];
    if (!project) return;
    const enc = (p: string): string => p.split('/').map(encodeURIComponent).join('/');
    setAssetUrlResolver((src) => `/__project_files/${encodeURIComponent(project)}/${enc(src)}`);
    void this.openAssetPanel(project, this.readEditorToken() ?? null);
    void this.loadProjectFonts(project);
    this.imageImport.setUploader(async (name, blob) => {
      const token = this.readEditorToken();
      try {
        const r = await fetch(`/__project_files/${encodeURIComponent(project)}/assets/images/${encodeURIComponent(name)}`, {
          method: 'POST', credentials: 'include', body: blob,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!r.ok) return null;
        const j = await r.json() as { ok?: boolean; asset?: { path?: string } };
        return j.ok && j.asset?.path ? j.asset.path : null;
      } catch { return null; }
    });
  }

  /** Register the project's uploaded TTF/OTF families with the FontFace API so
   *  the live editor renders them (matching resvg raster + vector PDF, which
   *  read the same files server-side). Best-effort — a listing failure just
   *  leaves the editor on fallback fonts. */
  private async loadProjectFonts(project: string): Promise<void> {
    try {
      const token = this.readEditorToken();
      const r = await fetch(`/__project_files/${encodeURIComponent(project)}/__assets`, {
        credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) return;
      const j = await r.json() as { ok?: boolean; assets?: Array<{ path: string; kind: string }> };
      const fonts = (j.assets ?? []).filter(a => a.kind === 'fonts');
      if (fonts.length === 0) return;
      const enc = (p: string): string => p.split('/').map(encodeURIComponent).join('/');
      loadProjectFonts(fonts, (p) => `/__project_files/${encodeURIComponent(project)}/${enc(p)}`);
    } catch { /* offline / unauthed — fallback fonts are fine */ }
  }

  setActiveFileHandle(handle: FileSystemFileHandle, content: string): void {
    if (this.activeFileHandle) {
      fileWatcher.unwatch(this.activeFileHandle.name);
    }
    this.activeFileHandle = handle;
    fileWatcher.watch(handle, content);
    this.autoSave.setFileHandle(handle);
  }

  private initAutoSave(): void {
    this.autoSave = new AutoSaveManager(30_000, async () => {
      if (!this.state.get().dirty) return null;
      return this.getYAML();
    });

    this.autoSave.onSavedCallback(() => {
      this.state.set('dirty', false, false);
      if (this.activeFileHandle) {
        this.tabBar?.markDirty(this.activeFileHandle.name, false);
      }
    });

    this.autoSave.onErrorCallback(() => {
      import('../utils/toast').then(({ showToast }) => {
        showToast('Auto-save failed — check file permissions', 'error');
      });
    });

    // Mark dirty on design changes
    this.state.subscribe((_, keys) => {
      if (keys.includes('design')) {
        this.autoSave.markDirty();
        if (this.activeFileHandle) {
          this.tabBar?.markDirty(this.activeFileHandle.name, true);
        }
      }
    });

    this.autoSave.start();
  }

  loadDesign(spec: DesignSpec): void {
    const errors = validateDesignSpec(spec);
    const criticalErrors = errors.filter(e => e.severity === 'error');

    if (criticalErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('Design validation warnings:', criticalErrors);
    }

    // Resolve the spec's theme.ref against the builtin registry. Without
    // this, state.theme stays at whatever the previous design used, so a
    // YAML declaring `theme: { ref: editorial-cream }` renders against the
    // prior dark theme (background dark, $text dark → invisible).
    const themeAny = spec.theme as { ref?: string; colors?: unknown } | undefined;
    const themeRef = themeAny && 'ref' in themeAny ? themeAny.ref : undefined;
    const resolvedTheme = themeRef && BUILTIN_THEMES[themeRef]
      ? BUILTIN_THEMES[themeRef]
      : (themeAny && 'colors' in themeAny ? (themeAny as ThemeSpec) : undefined);

    this.state.batch(() => {
      this.state.set('design', spec);
      this.state.set('yamlSource', serializeYAML(spec));
      this.state.set('selectedLayerIds', []);
      this.state.set('currentPageIndex', 0);
      this.state.set('dirty', false);
      if (resolvedTheme) this.state.set('theme', resolvedTheme);
      // Clear style overlays from a previous design so we don't carry over
      // a Playfair type-pack into a brutalist template. Refs declared on
      // the new spec are resolved asynchronously below and re-set on land.
      this.state.set('palette', null);
      this.state.set('typePack', null);
      this.state.set('effectsPack', null);
      // Lift animations from the spec into state so canvas + animation
      // panel both see them. Empty object resets any prior design's anims.
      this.state.set('animations', spec.animations ?? {});
    });

    // Load the design's own font families (a mood may pick Orbitron / Bricolage
    // Grotesque on a layer) so the live editor matches the raster export instead
    // of falling back to a generic. Recurses groups + every page.
    const designFonts = new Set<string>();
    const walkFonts = (layers: ReadonlyArray<Record<string, unknown>>): void => {
      for (const l of layers) {
        const style = l['style'] as Record<string, unknown> | undefined;
        const fam = style?.['font_family'] ?? l['font_family'];
        if (typeof fam === 'string') designFonts.add(fam);
        const kids = l['layers'];
        if (Array.isArray(kids)) walkFonts(kids as Record<string, unknown>[]);
      }
    };
    walkFonts((spec.layers ?? []) as unknown as Record<string, unknown>[]);
    for (const p of spec.pages ?? []) walkFonts((p.layers ?? []) as unknown as Record<string, unknown>[]);
    ensureDesignFonts([...designFonts]);

    this.resolveStyleRefs(spec);

    // Auto-fit so layer corners are reachable inside the canvas-area.
    // Without this, a 1080×1080 design at 100% zoom puts the right/bottom
    // resize handles outside the visible canvas (clipped by overflow:hidden),
    // making them un-clickable. Double-rAF so the responsive grid template
    // has settled (narrow viewports rearrange .properties-panel etc.) before
    // we read container width.
    requestAnimationFrame(() => requestAnimationFrame(() => this.canvas?.fitToScreen?.()));
  }

  loadFromYAML(yamlSource: string): void {
    const spec = parseDesign(yamlSource);
    this.loadDesign(spec);
  }

  getYAML(): string {
    const design = this.state.get().design;
    if (!design) return '';
    return serializeYAML(design);
  }

  /** Manual save (Ctrl+S / Save button). Persists through the active sink — the
   *  server design path or an opened local file — or, for a brand-new design
   *  with no backing file yet, saves it INTO the library. Returns true when the
   *  save was handled, so the caller skips the legacy file-download fallback. */
  private async saveToActiveTarget(): Promise<boolean> {
    const { showToast } = await import('../utils/toast');
    // Server-backed design (opened from / saved into the library).
    if (this.serverDesignRel) {
      try {
        await this.putDesignToServer(this.serverDesignRel, this.getYAML());
        this.state.set('dirty', false, false);
        showToast('Saved', 'success');
      } catch {
        showToast('Save failed — auto-save will retry', 'error');
      }
      return true;
    }
    // A local file opened via the picker — flush to its handle.
    if (this.autoSave.hasSink()) {
      this.autoSave.markDirty();
      const ok = await this.autoSave.saveNow();
      showToast(ok ? 'Saved' : 'Save failed', ok ? 'success' : 'error');
      return true;
    }
    // Brand-new design with no backing file — save it into the library.
    return this.saveNewToLibrary();
  }

  /** First save of an unsaved design: name it and write it into the library
   *  under drafts/, then keep auto-saving there. */
  private async saveNewToLibrary(): Promise<boolean> {
    const design = this.state.get().design;
    if (!design) return false;
    const suggested = (design.meta?.name ?? 'untitled').trim() || 'untitled';
    const input = typeof window !== 'undefined' && typeof window.prompt === 'function'
      ? window.prompt('Save to library as:', suggested)
      : suggested;
    if (input === null) return true; // cancelled — handled, no download fallback
    const slug = input.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'untitled';
    // The library enumerates <project>/designs/*.design.yaml — write under a
    // designs/ subdir of the drafts project so the new design shows up there.
    const rel = `drafts/designs/${slug}.design.yaml`;
    const { showToast } = await import('../utils/toast');
    try {
      await this.putDesignToServer(rel, this.getYAML());
      this.serverDesignRel = rel;
      this.autoSave.setServerSink((y) => this.putDesignToServer(rel, y));
      this.wireProjectAssets(rel);
      this.state.set('dirty', false, false);
      showToast(`Saved to library · ${rel}`, 'success');
    } catch {
      showToast('Save to library failed', 'error');
    }
    return true;
  }

  /** PUT the design YAML to its server file (creates the project dir if new). */
  private async putDesignToServer(rel: string, yaml: string): Promise<void> {
    const url = `/__project_files/${rel.split('/').map(encodeURIComponent).join('/')}`;
    const token = this.readEditorToken();
    const r = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'text/yaml; charset=utf-8',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: yaml,
    });
    if (!r.ok) throw new Error(`PUT ${url} → ${r.status}`);
  }

  /** Open the New-Design dialog (size / aspect-ratio picker), then build a fresh
   *  blank design at the chosen dimensions. */
  newDesignDialog(): void {
    const doc = this.state.get().design?.document;
    canvasResizeDialog.open(
      {
        width: doc?.width ?? 1080,
        height: doc?.height ?? 1080,
        dpi: doc?.dpi ?? 96,
        unit: (doc?.unit ?? 'px') as CanvasDocSpec['unit'],
      },
      (spec) => this.newBlankDesign(spec),
      { title: 'New Design', confirmLabel: 'Create' },
    );
  }

  /** Replace the canvas with a fresh blank design. Detaches the server-save
   *  target so the new design saves into the library on first save rather than
   *  overwriting whatever design was open before. */
  newBlankDesign(spec: CanvasDocSpec): void {
    const design = makeBlankDesign({
      width: spec.width, height: spec.height, unit: spec.unit, dpi: spec.dpi,
      now: new Date().toISOString(),
    });
    this.serverDesignRel = null;
    this.autoSave.setServerSink(null);
    this.state.set('currentPageIndex', 0, false);
    this.loadDesign(design);
    void import('../utils/toast').then(({ showToast }) => showToast('New blank design', 'success'));
  }

  printDesign(bleed = 0): void {
    openPrintWindow(this.state, { bleed, cropMarks: bleed > 0 });
  }

  exportSVG(): string {
    return this.canvas.exportSVG();
  }

  /** Live canvas DOM node (with JS-drawn charts/tables) — for high-fidelity export capture. */
  getCanvasExportNode(): HTMLElement | null {
    return this.canvas.getCanvasExportNode();
  }

  applyTheme(themeId: string): void {
    const theme = BUILTIN_THEMES[themeId];
    if (theme) this.state.set('theme', theme);
  }

  /**
   * Resolves any palette / type_pack / effects_pack refs declared on the
   * design spec and sets the matching state slot once loaded. Fire-and-
   * forget: the renderer falls back to the base theme until each ref
   * lands, so a slow fetch never blocks the first paint.
   */
  private resolveStyleRefs(spec: DesignSpec): void {
    if (spec.palette?.ref) {
      void loadFullPalette(spec.palette.ref).then(p => {
        if (p && this.state.get().design === spec) this.state.set('palette', p);
      });
    }
    if (spec.type_pack?.ref) {
      void loadFullTypePack(spec.type_pack.ref).then(tp => {
        if (tp && this.state.get().design === spec) this.state.set('typePack', tp);
      });
    }
    if (spec.effects_pack?.ref) {
      void loadFullEffectsPack(spec.effects_pack.ref).then(ep => {
        if (ep && this.state.get().design === spec) this.state.set('effectsPack', ep);
      });
    }
  }

  /**
   * Opens the catalog dialog and, on template pick, loads the resulting
   * design into the editor. Centralized here so toolbar, file-tree, and
   * any future surface all trigger the same flow.
   */
  openCatalog(): void {
    // Lazy chunk: the catalog dialog (+ template/theme/pack loaders) is heavy
    // and only needed once the user opens it — keep it out of the main entry
    // (CI enforces a 500KB main-bundle budget).
    void import('../ui/dialogs/catalog')
      .then(({ catalogDialog }) => catalogDialog.open({
        onOpen: (design, label, picks) => {
          const yaml = serializeYAML(design);
          this.loadFromYAML(yaml);
          const current = this.state.get().design;
          if (current) current.meta.name = label.replace(/\..*$/, '');
          // Apply style overlay picks immediately so the canvas matches
          // the rail preview without waiting for the async ref resolver
          // started by loadDesign. The full specs are already cached by
          // the dialog's per-card lookups.
          if (picks?.palette)     this.state.set('palette',     picks.palette);
          if (picks?.typePack)    this.state.set('typePack',    picks.typePack);
          if (picks?.effectsPack) this.state.set('effectsPack', picks.effectsPack);
        },
      }))
      .catch(async (err: unknown) => {
        const { showToast } = await import('../utils/toast');
        showToast(`Catalog failed to load: ${(err as Error).message}`, 'warning');
      });
  }
}
