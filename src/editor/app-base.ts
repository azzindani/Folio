// Folio editor — EditorApp base: panel/manager fields + layout & UI-wiring methods.
// Split out of app.ts to stay within the line budget. EditorApp (app.ts) extends
// this with the constructor, init(), and design load/export/theme operations. Verbatim.
import { StateManager } from './state';
import { chromeIcon } from './chrome-icons';
import { applyPinConstraints } from './pin-constraints';
import { CanvasManager } from './canvas';
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
import { AlignToolbar } from '../ui/tools/align-toolbar';
import { ToolboxManager } from '../ui/tools/toolbox';
import { CommandPalette } from '../ui/palette/command-palette';
import { KeyboardManager } from './keyboard';
import { PanelResizer } from '../ui/resize/panel-resizer';
import { TabBarManager } from '../ui/tabs/tab-bar';
import { ViewportLayoutManager } from '../ui/viewport/viewport-layout';
import { AutoSaveManager } from './auto-save';
import { ColorPaletteManager } from '../ui/panels/color-palette';
import { canvasResizeDialog } from '../ui/dialogs/canvas-resize';
import { ComponentLibraryManager } from '../ui/panels/component-library';
import { AnimationPanel } from '../ui/panels/animation-panel';
import { ImageImportHandler } from './image-import-handler';
import { projectFolder } from '../fs/project-folder';
import { TimelinePanelManager } from '../ui/panels/timeline-panel';
import { ColorSchemePanelManager } from '../ui/panels/color-scheme-panel';
import { AssetPanelManager } from '../ui/panels/asset-panel';

export abstract class EditorAppBase {
  protected container!: HTMLElement;
  state!: StateManager;
  canvas!: CanvasManager;
  payloadEditor!: PayloadEditor;
  protected toolbar!: ToolbarManager;
  protected toolbox!: ToolboxManager;
  protected alignToolbar!: AlignToolbar;
  fileTree!: FileTreeManager;
  protected layerPanel!: LayerPanelManager;
  protected propertiesPanel!: PropertiesPanelManager;
  protected dataPanel!: DataPanelManager;
  protected scriptPanel!: ScriptPanelManager;
  protected problemsPanel!: ProblemsPanelManager;
  protected iconBrowser!: IconBrowserManager;
  protected findReplace!: FindReplaceManager;
  presentation!: PresentationMode;
  protected minimap!: MinimapManager;
  protected a11y!: AccessibilityChecker;
  protected pageStrip!: PageStrip;
  protected commandPalette!: CommandPalette;
  protected keyboard!: KeyboardManager;
  protected activeFileHandle: FileSystemFileHandle | null = null;
  tabBar!: TabBarManager;
  viewportLayout!: ViewportLayoutManager;
  protected resizers: PanelResizer[] = [];
  protected autoSave!: AutoSaveManager;
  protected colorPalette!: ColorPaletteManager;
  protected componentLibrary!: ComponentLibraryManager;
  protected animationPanel!: AnimationPanel;
  protected imageImport!: ImageImportHandler;
  protected timelinePanel!: TimelinePanelManager;
  protected colorSchemePanel!: ColorSchemePanelManager;
  protected assetPanel!: AssetPanelManager;

  protected buildLayout(): void {
    this.container.innerHTML = `
      <div class="toolbar"></div>

      <div class="formula-bar">
        <div class="formula-bar-resize-handle" data-resize="formula"></div>
        <span class="fb-layer-id">—</span>
        <span class="fb-prefix">ƒ=</span>
        <input class="fb-input" type="text" placeholder="Select a layer to inspect…" spellcheck="false">
      </div>

      <div class="activity-bar">
        <button class="act-btn active" data-panel="layers" title="Layers (⌘⇧L)">${chromeIcon('layers')}</button>
        <button class="act-btn" data-panel="files" title="Files (⌘⇧E)">${chromeIcon('folder')}</button>
        <button class="act-btn" data-panel="project-assets" title="Project assets">${chromeIcon('image')}</button>
        <button class="act-btn" data-panel="components" title="Components (⌘⇧K)">${chromeIcon('component')}</button>
        <button class="act-btn" data-panel="icons" title="Icons (⌘⇧I)">${chromeIcon('star')}</button>
        <button class="act-btn" data-panel="find" title="Find &amp; Replace (⌘H)">${chromeIcon('search')}</button>
        <div class="act-spacer"></div>
        <button class="act-btn" id="theme-toggle" title="Toggle light/dark theme">${chromeIcon('moon')}</button>
      </div>

      <div class="mob-backdrop"></div>

      <nav class="mobile-nav" aria-label="Mobile navigation">
        <button class="mob-nav-btn" data-mob="layers" title="Layers">${chromeIcon('layers', 18)}</button>
        <button class="mob-nav-btn" data-mob="props" title="Properties">${chromeIcon('sliders', 18)}</button>
        <button class="mob-nav-btn" data-mob="cmd" title="Command palette">${chromeIcon('search', 18)}</button>
      </nav>

      <div class="left-panel">
        <div class="mob-sheet-grip" aria-hidden="true"></div>
        <div class="left-panel-view active" data-panel="layers">
          <div class="tools-panel"></div>
          <div class="layer-panel">
            <div class="panel-header">Layers</div>
          </div>
        </div>

        <div class="left-panel-view" data-panel="files">
          <div class="file-tree">
            <div class="panel-header">Files</div>
            <div class="file-tree-content"></div>
          </div>
          <div class="asset-panel">
            <div class="asset-panel-header">
              <span class="asset-panel-title">Assets</span>
              <button class="asset-open-btn" id="open-folder-btn" title="Open project folder">${chromeIcon('folder', 13)} Open Folder</button>
            </div>
            <div class="asset-grid" id="asset-grid"></div>
          </div>
        </div>

        <div class="left-panel-view" data-panel="project-assets">
          <div class="panel-header">Project assets</div>
          <div class="project-assets-content" style="flex:1;overflow-y:auto"></div>
        </div>

        <div class="left-panel-view" data-panel="components">
          <div class="comp-library-content" style="height:100%;overflow-y:auto"></div>
        </div>

        <div class="left-panel-view" data-panel="icons">
          <div class="panel-header">Icons</div>
          <div class="icon-browser-content" style="flex:1;overflow:hidden;display:flex;flex-direction:column"></div>
        </div>

        <div class="left-panel-view" data-panel="find">
          <div class="find-replace-content" style="flex:1;overflow:hidden;height:100%"></div>
        </div>

        <div class="left-panel-resize-handle" data-resize="left"></div>
      </div>

      <div class="canvas-section" style="position:relative">
        <div class="tab-bar-container"></div>
        <div class="viewport-area"></div>
        <div class="page-strip-section" id="page-strip-section" style="display:none">
          <div class="page-strip-resize-handle" data-resize="page-strip"></div>
          <div class="page-strip-content"></div>
        </div>
      </div>

      <div class="properties-panel">
        <div class="mob-sheet-grip" aria-hidden="true"></div>
        <div class="right-panel-resize-handle" data-resize="right"></div>
        <div class="rpanel-body">
          <div class="tab-pane active" data-tab="properties">
            <div class="properties-content"></div>
          </div>
          <div class="tab-pane tab-pane--scroll" data-tab="data">
            <div class="data-content" style="height:100%;overflow-y:auto"></div>
          </div>
          <div class="tab-pane tab-pane--scroll" data-tab="scripts">
            <div class="scripts-content" style="height:100%;overflow-y:auto"></div>
          </div>
          <div class="tab-pane tab-pane--flex" data-tab="colors">
            <div class="color-palette-content" style="flex:1;overflow-y:auto"></div>
            <div class="color-scheme-content" style="border-top:1px solid var(--color-border)">
              <div class="panel-header" style="padding:6px 8px">Color Schemes</div>
            </div>
          </div>
          <div class="tab-pane" data-tab="problems">
            <div class="problems-content"></div>
          </div>
          <div class="tab-pane tab-pane--scroll" data-tab="animate">
            <div class="animate-content" style="height:100%"></div>
          </div>
          <div class="tab-pane tab-pane--flex" data-tab="timeline">
            <div class="timeline-content" style="flex:1;overflow:hidden"></div>
          </div>
          <div class="tab-pane tab-pane--full" data-tab="a11y">
            <div class="a11y-content" style="height:100%"></div>
          </div>
        </div>
        <div class="minimap-container"></div>
      </div>

      <div class="r-activity-bar" role="tablist" aria-label="Right panel tabs">
        <button class="act-btn rpanel-tab active" data-tab="properties" title="Properties" aria-label="Properties">${chromeIcon('sliders')}</button>
        <button class="act-btn rpanel-tab" data-tab="data" title="Data" aria-label="Data">${chromeIcon('table')}</button>
        <button class="act-btn rpanel-tab" data-tab="scripts" title="Scripts" aria-label="Scripts">${chromeIcon('code')}</button>
        <button class="act-btn rpanel-tab" data-tab="colors" title="Colors" aria-label="Colors">${chromeIcon('palette')}</button>
        <button class="act-btn rpanel-tab" data-tab="animate" title="Animate" aria-label="Animate">${chromeIcon('zap')}</button>
        <button class="act-btn rpanel-tab" data-tab="timeline" title="Timeline" aria-label="Timeline">${chromeIcon('clock')}</button>
        <button class="act-btn rpanel-tab" data-tab="problems" title="Issues" aria-label="Issues">${chromeIcon('alert')}</button>
        <button class="act-btn rpanel-tab" data-tab="a11y" title="Accessibility" aria-label="Accessibility">${chromeIcon('a11y')}</button>
      </div>

      <div class="status-bar">
        <div class="status-pages"></div>
        <div class="status-sep"></div>
        <button class="sb-btn" id="zoom-out" title="Zoom out (−)">−</button>
        <span class="sb-zoom-val toolbar-zoom">100%</span>
        <button class="sb-btn" id="zoom-in" title="Zoom in (+)">+</button>
        <button class="sb-btn" id="zoom-fit" title="Fit to screen (⌘0)">&#8862;</button>
        <div class="status-sep"></div>
        <button class="sb-btn" id="toggle-grid" title="Grid (G)">&#8862;</button>
        <button class="sb-btn" id="toggle-snap" title="Snap">&#8859;</button>
        <div class="status-sep"></div>
        <span class="sb-ruler-unit" id="sb-ruler-unit" title="Click to change ruler units">px</span>
        <div class="status-sep"></div>
        <button class="sb-btn" id="canvas-resize" title="Resize canvas">⊞</button>
        <div class="status-sep"></div>
        <button class="sb-btn" id="status-preview" title="Preview (F5)">&#9654;</button>
        <div class="status-spacer"></div>
        <span class="sb-info" id="sb-info"></span>
      </div>
    `;

    this.wireActivityBar();
    this.wireRpanelTabs();
    this.wireThemeToggle();
    this.wireResizers();
    this.wireMobileNav();
  }

  protected wireResizers(): void {
    const root = document.documentElement;

    // Left panel resize (right edge of left-panel)
    const leftHandle = this.container.querySelector<HTMLElement>('[data-resize="left"]');
    if (leftHandle) {
      const leftResizer = new PanelResizer({
        cssVar: '--left-panel-width',
        axis: 'x',
        min: 160,
        max: 600,
        target: root,
      });
      const h = leftResizer.getHandle();
      leftHandle.replaceWith(h);
      this.resizers.push(leftResizer);
    }

    // Right panel resize (left edge of right-panel — dragging left grows the panel)
    const rightHandle = this.container.querySelector<HTMLElement>('[data-resize="right"]');
    if (rightHandle) {
      const rightResizer = new PanelResizer({
        cssVar: '--right-panel-width',
        axis: 'x',
        min: 200,
        max: 600,
        target: root,
        invert: true,
      });
      const h = rightResizer.getHandle();
      rightHandle.replaceWith(h);
      this.resizers.push(rightResizer);
    }

    // Formula bar height resize (drag bottom edge downward to expand)
    const formulaHandle = this.container.querySelector<HTMLElement>('[data-resize="formula"]');
    if (formulaHandle) {
      const formulaResizer = new PanelResizer({
        cssVar: '--formula-bar-height',
        axis: 'y',
        min: 0,
        max: 120,
        target: root,
      });
      const h = formulaResizer.getHandle();
      formulaHandle.replaceWith(h);
      this.resizers.push(formulaResizer);
    }

    // Page strip height resize (drag top edge upward to expand)
    const pageStripHandle = this.container.querySelector<HTMLElement>('[data-resize="page-strip"]');
    if (pageStripHandle) {
      const pageStripResizer = new PanelResizer({
        cssVar: '--page-strip-height',
        axis: 'y',
        min: 60,
        max: 360,
        target: root,
        invert: true,
      });
      const h = pageStripResizer.getHandle();
      pageStripHandle.replaceWith(h);
      this.resizers.push(pageStripResizer);
    }
  }

  protected wireActivityBar(): void {
    const actBtns = this.container.querySelectorAll<HTMLElement>('.act-btn[data-panel]');
    const panelViews = this.container.querySelectorAll<HTMLElement>('.left-panel-view');
    const leftPanel = this.container.querySelector<HTMLElement>('.left-panel')!;
    const app = leftPanel.closest('#app') as HTMLElement | null;

    let currentPanel = 'layers';

    const setCollapsed = (collapsed: boolean): void => {
      app?.classList.toggle('panel-collapsed', collapsed);
      actBtns.forEach(b => {
        const isCurrent = b.dataset.panel === currentPanel;
        // Drop the active highlight while collapsed so the bar reads as "closed"
        // (no panel open) rather than "this panel is selected but blank/broken".
        b.classList.toggle('active', !collapsed && isCurrent);
        b.setAttribute('aria-expanded', String(!collapsed && isCurrent));
      });
    };

    // Below desktop the left panel is a slide-in overlay (z-120) — starting
    // expanded means it covers the canvas on load and the design looks
    // missing. Start collapsed there; the activity bar re-opens it.
    if (window.matchMedia('(max-width: 1023px)').matches) setCollapsed(true);

    actBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const panelId = btn.dataset.panel!;
        const isCollapsed = !!app?.classList.contains('panel-collapsed');

        if (panelId === currentPanel) {
          setCollapsed(!isCollapsed);
          return;
        }

        currentPanel = panelId;
        actBtns.forEach(b => b.classList.toggle('active', b.dataset.panel === panelId));
        panelViews.forEach(v => v.classList.toggle('active', v.dataset.panel === panelId));
        setCollapsed(false);
      });
    });

    // Removed: floating .lpanel-expand-btn notch. The activity bar is
    // always visible and clicking any of its icons re-expands the panel.
  }

  protected wireRpanelTabs(): void {
    const tabs = this.container.querySelectorAll<HTMLElement>('.r-activity-bar .rpanel-tab');
    const panes = this.container.querySelectorAll<HTMLElement>('.rpanel-body .tab-pane');
    const app = this.container.closest('#app') ?? this.container;
    const panel = this.container.querySelector<HTMLElement>('.properties-panel');

    // Below desktop (≤1023px) the panel is an absolute/fixed slide-in overlay
    // shown via `.mob-open` — the grid `rpanel` column is forced to 0, so the
    // desktop-only `rpanel-collapsed` toggle does NOTHING there and used to leave
    // the panel stranded off-screen: the activity bar was visible and clickable
    // but the panel never appeared (looked permanently broken). The bar is still
    // shown on tablet, so its tabs must drive the same `.mob-open` the mobile-nav
    // uses. We deliberately do NOT raise `.mob-backdrop` here — on tablet its
    // z-index sits above the panel and would bury it; tablet closes by re-clicking
    // the active tab, mirroring the left panel (which has no backdrop either).
    const overlay = (): boolean => window.matchMedia('(max-width: 1023px)').matches;

    const showPane = (tabId: string): void => {
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
      panes.forEach(p => p.classList.toggle('active', p.dataset.tab === tabId));
    };

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab!;
        const isActive = tab.classList.contains('active');

        if (overlay()) {
          const isOpen = !!panel?.classList.contains('mob-open');
          // Re-click the already-open tab → slide the overlay back out.
          if (isActive && isOpen) {
            panel?.classList.remove('mob-open');
            tabs.forEach(t => t.classList.remove('active'));
            return;
          }
          showPane(tabId);
          panel?.classList.add('mob-open');
          return;
        }

        // Desktop: collapse/expand via the grid column. Click already-active tab
        // while expanded → collapse, clearing the active highlight so the bar
        // reads as "closed" rather than "selected but blank".
        const isCollapsed = app.classList.contains('rpanel-collapsed');
        if (isActive && !isCollapsed) {
          app.classList.add('rpanel-collapsed');
          tabs.forEach(t => t.classList.remove('active'));
          return;
        }
        showPane(tabId);
        app.classList.remove('rpanel-collapsed');
      });
    });
  }

  protected wireThemeToggle(): void {
    const btn = this.container.querySelector<HTMLElement>('#theme-toggle');
    if (!btn) return;
    const root = document.documentElement;

    // Restore persisted theme
    const saved = localStorage.getItem('folio:ui-theme') ?? 'dark';
    root.setAttribute('data-theme', saved);
    btn.innerHTML = saved === 'light' ? chromeIcon('moon') : chromeIcon('sun');
    btn.title = saved === 'light' ? 'Switch to dark theme' : 'Switch to light theme';

    btn.addEventListener('click', () => {
      const isLight = root.getAttribute('data-theme') === 'light';
      const next = isLight ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      btn.innerHTML = next === 'light' ? chromeIcon('moon') : chromeIcon('sun');
      btn.title = next === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
      localStorage.setItem('folio:ui-theme', next);
      this.payloadEditor?.setTheme(next);
    });
  }

  protected wireMobileNav(): void {
    const backdrop = this.container.querySelector<HTMLElement>('.mob-backdrop');
    const leftPanel = this.container.querySelector<HTMLElement>('.left-panel');
    const rightPanel = this.container.querySelector<HTMLElement>('.properties-panel');
    const navBtns = this.container.querySelectorAll<HTMLElement>('.mob-nav-btn');
    if (!backdrop || !leftPanel || !rightPanel) return;

    const closeAll = (): void => {
      leftPanel.classList.remove('mob-open');
      rightPanel.classList.remove('mob-open');
      backdrop.classList.remove('active');
      navBtns.forEach(b => b.classList.remove('active'));
    };

    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.mob;
        if (target === 'cmd') {
          closeAll();
          this.commandPalette?.open?.();
          return;
        }
        const isLeft = target === 'layers';
        const panel = isLeft ? leftPanel : rightPanel;
        const isOpen = panel.classList.contains('mob-open');
        closeAll();
        if (!isOpen) {
          panel.classList.add('mob-open');
          backdrop.classList.add('active');
          btn.classList.add('active');
        }
      });
    });

    backdrop.addEventListener('click', closeAll);

    // Swipe-down-to-close on sheet grip
    [leftPanel, rightPanel].forEach(panel => {
      const grip = panel.querySelector<HTMLElement>('.mob-sheet-grip');
      if (!grip) return;
      let startY = 0;
      grip.addEventListener('pointerdown', (e) => {
        startY = e.clientY;
        grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener('pointerup', (e) => {
        if (e.clientY - startY > 60) closeAll();
      });
    });
  }

  protected wireAssetPanel(): void {
    const btn   = this.container.querySelector<HTMLElement>('#open-folder-btn');
    const grid  = this.container.querySelector<HTMLElement>('#asset-grid');
    if (!btn || !grid) return;

    btn.addEventListener('click', async () => {
      try {
        await projectFolder.open();
        btn.innerHTML = chromeIcon('folder', 13);
        btn.appendChild(document.createTextNode(` ${projectFolder.rootName}`));
      } catch (err) {
        const { showToast } = await import('../utils/toast');
        showToast((err as Error).message, 'warning');
      }
    });

    const renderGrid = async (): Promise<void> => {
      const assets = projectFolder.getAssets();
      if (assets.length === 0) {
        grid.innerHTML = '<span class="asset-empty">No images found</span>';
        return;
      }
      grid.innerHTML = '';
      for (const entry of assets) {
        const tile = document.createElement('div');
        tile.className = 'asset-tile';
        tile.title = entry.path;
        const url = await projectFolder.getBlobUrl(entry);
        tile.style.backgroundImage = `url(${url})`;
        tile.addEventListener('click', async () => {
          if (entry.name.endsWith('.svg')) {
            const file = await entry.handle.getFile();
            await this.imageImport.fromSVGFile(file);
          } else {
            const file = await entry.handle.getFile();
            await this.imageImport.fromRaster(file);
          }
        });
        grid.appendChild(tile);
      }
    };

    projectFolder.onChange(() => { void renderGrid(); });
  }

  protected wireStatusBar(): void {
    const q = <T extends HTMLElement>(sel: string) =>
      this.container.querySelector<T>(sel);

    // Zoom controls
    q('#zoom-out')?.addEventListener('click', () => {
      const z = Math.max(0.1, (this.state.get().zoom ?? 1) - 0.1);
      this.state.set('zoom', parseFloat(z.toFixed(2)));
    });
    q('#zoom-in')?.addEventListener('click', () => {
      const z = Math.min(4, (this.state.get().zoom ?? 1) + 0.1);
      this.state.set('zoom', parseFloat(z.toFixed(2)));
    });
    q('#zoom-fit')?.addEventListener('click', () => {
      this.canvas?.fitToScreen?.();
    });

    // Grid / snap toggles
    q('#toggle-grid')?.addEventListener('click', () => {
      const v = !this.state.get().gridVisible;
      this.state.set('gridVisible', v);
      q('#toggle-grid')?.classList.toggle('active', v);
    });
    q('#toggle-snap')?.addEventListener('click', () => {
      const v = !this.state.get().snapEnabled;
      this.state.set('snapEnabled', v);
      q('#toggle-snap')?.classList.toggle('active', v);
    });

    // Canvas resize dialog
    q('#canvas-resize')?.addEventListener('click', () => this.openResizeDialog());

    // Presentation mode (F5)
    q('#status-preview')?.addEventListener('click', () => this.presentation.open());

    // Ruler unit toggle (click cycles px → mm → cm → in → px)
    const rulerUnitBtn = q<HTMLSpanElement>('#sb-ruler-unit');
    if (rulerUnitBtn) {
      import('../utils/ruler-units').then(({ nextRulerUnit }) => {
        rulerUnitBtn.addEventListener('click', () => {
          const next = nextRulerUnit(this.state.get().rulerUnit);
          this.state.set('rulerUnit', next, false);
        });
      });
    }

    // Sync zoom display + ruler unit badge
    this.state.subscribe((state, keys) => {
      if (keys.includes('zoom')) {
        const val = q<HTMLSpanElement>('.sb-zoom-val');
        if (val) val.textContent = `${Math.round((state.zoom ?? 1) * 100)}%`;
      }
      if (keys.includes('rulerUnit')) {
        const unitBtn = q<HTMLSpanElement>('#sb-ruler-unit');
        if (unitBtn) unitBtn.textContent = state.rulerUnit;
      }
      if (keys.includes('selectedLayerIds') || keys.includes('design')) {
        this.updateFormulaBar();
        const info = q<HTMLSpanElement>('#sb-info');
        if (info) {
          const n = state.selectedLayerIds?.length ?? 0;
          info.textContent = n > 0 ? `${n} layer${n > 1 ? 's' : ''} selected` : '';
        }
      }
    });
  }

  protected updateFormulaBar(): void {
    const state = this.state.get();
    const layerId = state.selectedLayerIds?.[0];
    const idEl = this.container.querySelector<HTMLElement>('.fb-layer-id');
    const inputEl = this.container.querySelector<HTMLInputElement>('.fb-input');
    if (!idEl || !inputEl) return;

    if (!layerId) {
      idEl.textContent = '—';
      inputEl.value = '';
      inputEl.placeholder = 'Select a layer to inspect…';
      return;
    }

    const design = state.design;
    const layers = design?.layers ?? design?.pages?.[state.currentPageIndex ?? 0]?.layers ?? [];
    const layer = layers.find((l: { id: string }) => l.id === layerId);
    if (!layer) return;

    idEl.textContent = layer.id;
    // Show primary property for layer type
    const l = layer as unknown as Record<string, unknown> & { type?: string; content?: { value?: string }; fill?: { color?: string }; src?: string };
    const primary =
      l.type === 'text'  ? (l.content as { value?: string })?.value ?? '' :
      l.type === 'image' ? String(l.src ?? '') :
      l.type === 'rect' || l.type === 'circle' ? String((l.fill as { color?: string })?.color ?? '') :
      '';
    inputEl.value = primary;
    inputEl.placeholder = `${layer.type} — edit value`;
  }

  /** Open the canvas-resize / aspect-ratio dialog for the current design.
   *  Shared by the status-bar button and the command palette. */
  openResizeDialog(): void {
    const doc = this.state.get().design?.document;
    if (!doc) return;
    canvasResizeDialog.open(
      { width: doc.width, height: doc.height, dpi: doc.dpi ?? 96, unit: (doc.unit ?? 'px') as import('../ui/dialogs/canvas-resize').CanvasDocSpec['unit'] },
      (spec) => {
        const design = this.state.get().design;
        if (!design) return;
        const from = { width: doc.width, height: doc.height };
        const to = { width: spec.width, height: spec.height };
        const layers = applyPinConstraints(design.layers ?? [], from, to);
        this.state.set('design', { ...design, layers, document: { ...design.document, ...spec } });
      },
    );
  }

}
