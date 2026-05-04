import { StateManager } from './state';
import { CanvasManager } from './canvas';
import { PayloadEditor } from './payload-editor';
import { ToolbarManager } from '../ui/toolbar/toolbar';
import { LayerPanelManager } from '../ui/panels/layer-panel';
import { PropertiesPanelManager } from '../ui/panels/properties-panel';
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
import { ToolboxManager } from '../ui/tools/toolbox';
import { CommandPalette } from '../ui/palette/command-palette';
import { KeyboardManager } from './keyboard';
import { parseDesign, serializeYAML } from '../schema/parser';
import { validateDesignSpec } from '../schema/validator';
import type { DesignSpec } from '../schema/types';
import { fileWatcher } from '../fs/file-watcher';
import { BUILTIN_THEMES } from '../themes/builtin';
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

const SAMPLE_DESIGN: DesignSpec = {
  _protocol: 'design/v1',
  _mode: 'complete',
  meta: {
    id: 'sample-001',
    name: 'Sample Design',
    type: 'poster',
    created: '2026-04-09',
    modified: '2026-04-09',
    generator: 'human',
  },
  document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
  theme: { ref: 'dark-tech' },
  layers: [
    {
      id: 'bg',
      type: 'rect',
      z: 0,
      x: 0, y: 0,
      width: 1080, height: 1080,
      fill: {
        type: 'linear',
        angle: 135,
        stops: [
          { color: '$background', position: 0 },
          { color: '$surface', position: 100 },
        ],
      },
    },
    {
      id: 'accent-circle',
      type: 'circle',
      z: 5,
      x: 700, y: 100,
      width: 400, height: 400,
      fill: { type: 'solid', color: '$primary', opacity: 0.15 },
    },
    {
      id: 'card',
      type: 'rect',
      z: 10,
      x: 80, y: 300,
      width: 920, height: 480,
      fill: { type: 'solid', color: '$surface' },
      radius: 16,
      effects: {
        shadows: [{ x: 0, y: 4, blur: 24, color: 'rgba(0,0,0,0.4)' }],
      },
    },
    {
      id: 'headline',
      type: 'text',
      z: 20,
      x: 120, y: 360,
      width: 840,
      height: 'auto',
      content: { type: 'plain', value: 'Design Engine' },
      style: {
        font_family: '$heading',
        font_size: 72,
        font_weight: 800,
        color: '$text',
        line_height: 1.1,
      },
    },
    {
      id: 'subtitle',
      type: 'text',
      z: 21,
      x: 120, y: 460,
      width: 840,
      height: 'auto',
      content: { type: 'plain', value: 'YAML-powered graphic design with LLM integration' },
      style: {
        font_family: '$body',
        font_size: 24,
        font_weight: 400,
        color: '$text_muted',
        line_height: 1.5,
      },
    },
    {
      id: 'divider',
      type: 'line',
      z: 22,
      x: 120, y: 540,
      width: 840,
      x1: 120, y1: 540, x2: 400, y2: 540,
      stroke: { color: '$primary', width: 3 },
    },
    {
      id: 'body-text',
      type: 'text',
      z: 23,
      x: 120, y: 580,
      width: 840,
      height: 'auto',
      content: {
        type: 'plain',
        value: 'Local-first, file-based design engine where designs are stored\nas human-readable YAML payload files.',
      },
      style: {
        font_family: '$body',
        font_size: 18,
        font_weight: 400,
        color: '$text',
        line_height: 1.6,
      },
    },
    {
      id: 'badge',
      type: 'rect',
      z: 25,
      x: 120, y: 680,
      width: 140, height: 36,
      fill: { type: 'solid', color: '$primary' },
      radius: 18,
    },
    {
      id: 'badge-text',
      type: 'text',
      z: 26,
      x: 120, y: 688,
      width: 140,
      height: 36,
      content: { type: 'plain', value: 'Phase 1' },
      style: {
        font_family: '$heading',
        font_size: 14,
        font_weight: 600,
        color: '#FFFFFF',
        align: 'center',
      },
    },
    {
      id: 'footer',
      type: 'text',
      z: 30,
      x: 80, y: 1020,
      width: 920,
      height: 'auto',
      content: { type: 'plain', value: 'folio v1.0.0' },
      style: {
        font_family: '$mono',
        font_size: 14,
        font_weight: 400,
        color: '$text_muted',
        align: 'right',
      },
    },
  ],
};

export class EditorApp {
  private container: HTMLElement;
  state: StateManager;
  canvas!: CanvasManager;
  payloadEditor!: PayloadEditor;
  private toolbar!: ToolbarManager;
  private toolbox!: ToolboxManager;
  private alignToolbar!: AlignToolbar;
  fileTree!: FileTreeManager;
  private layerPanel!: LayerPanelManager;
  private propertiesPanel!: PropertiesPanelManager;
  private problemsPanel!: ProblemsPanelManager;
  private iconBrowser!: IconBrowserManager;
  private findReplace!: FindReplaceManager;
  presentation!: PresentationMode;
  private minimap!: MinimapManager;
  private a11y!: AccessibilityChecker;
  private pageStrip!: PageStrip;
  private commandPalette!: CommandPalette;
  private keyboard!: KeyboardManager;
  private activeFileHandle: FileSystemFileHandle | null = null;
  tabBar!: TabBarManager;
  viewportLayout!: ViewportLayoutManager;
  private resizers: PanelResizer[] = [];
  private autoSave!: AutoSaveManager;
  private colorPalette!: ColorPaletteManager;
  private componentLibrary!: ComponentLibraryManager;
  private animationPanel!: AnimationPanel;
  private imageImport!: ImageImportHandler;
  private timelinePanel!: TimelinePanelManager;
  private colorSchemePanel!: ColorSchemePanelManager;

  constructor(container: HTMLElement) {
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

    this.toolbar = new ToolbarManager(
      this.container.querySelector('.toolbar')!,
      this.state,
      this,
    );

    this.toolbox = new ToolboxManager(
      this.container.querySelector('.tools-panel')!,
      this.state,
    );

    this.alignToolbar = new AlignToolbar(primaryPane, this.state);

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
  }

  private buildLayout(): void {
    this.container.innerHTML = `
      <div class="toolbar"></div>

      <div class="formula-bar">
        <div class="formula-bar-resize-handle" data-resize="formula"></div>
        <span class="fb-layer-id">—</span>
        <span class="fb-prefix">ƒ=</span>
        <input class="fb-input" type="text" placeholder="Select a layer to inspect…" spellcheck="false">
      </div>

      <div class="activity-bar">
        <button class="act-btn active" data-panel="layers" title="Layers (⌘⇧L)">&#9776;</button>
        <button class="act-btn" data-panel="files" title="Files (⌘⇧E)">&#128193;</button>
        <button class="act-btn" data-panel="components" title="Components (⌘⇧K)">&#11041;</button>
        <button class="act-btn" data-panel="icons" title="Icons (⌘⇧I)">&#11088;</button>
        <button class="act-btn" data-panel="find" title="Find &amp; Replace (⌘H)">&#128269;</button>
        <div class="act-spacer"></div>
        <button class="act-btn" id="theme-toggle" title="Toggle light/dark theme">&#9790;</button>
      </div>

      <div class="mob-backdrop"></div>

      <nav class="mobile-nav" aria-label="Mobile navigation">
        <button class="mob-nav-btn" data-mob="layers" title="Layers">&#9776;</button>
        <button class="mob-nav-btn" data-mob="props" title="Properties">&#9881;</button>
        <button class="mob-nav-btn" data-mob="cmd" title="Command palette">&#128269;</button>
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
              <button class="asset-open-btn" id="open-folder-btn" title="Open project folder">&#128193; Open Folder</button>
            </div>
            <div class="asset-grid" id="asset-grid"></div>
          </div>
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
        <button class="rpanel-reopen-btn" id="rpanel-reopen" title="Open Properties panel">&#x2039;</button>
      </div>

      <div class="properties-panel">
        <div class="mob-sheet-grip" aria-hidden="true"></div>
        <div class="right-panel-resize-handle" data-resize="right"></div>
        <div class="rpanel-tabs">
          <button class="rpanel-tab active" data-tab="properties" title="Properties">Props</button>
          <button class="rpanel-tab" data-tab="colors" title="Colors">Color</button>
          <button class="rpanel-tab" data-tab="animate" title="Animate">Anim</button>
          <button class="rpanel-tab" data-tab="timeline" title="Timeline">Time</button>
          <button class="rpanel-tab" data-tab="problems" title="Issues">Issues</button>
          <button class="rpanel-tab" data-tab="a11y" title="Accessibility">A11y</button>
          <button class="rpanel-close-btn" id="rpanel-toggle" title="Close panel (Ctrl+\)">&#x203A;</button>
        </div>
        <div class="rpanel-body">
          <div class="tab-pane active" data-tab="properties">
            <div class="properties-content"></div>
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

  private wireResizers(): void {
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

  private wireActivityBar(): void {
    const actBtns = this.container.querySelectorAll<HTMLElement>('.act-btn[data-panel]');
    const panelViews = this.container.querySelectorAll<HTMLElement>('.left-panel-view');
    const leftPanel = this.container.querySelector<HTMLElement>('.left-panel')!;
    const app = leftPanel.closest('#app') as HTMLElement | null;

    let currentPanel = 'layers';

    const setCollapsed = (collapsed: boolean): void => {
      app?.classList.toggle('panel-collapsed', collapsed);
      actBtns.forEach(b => {
        b.setAttribute('aria-expanded', String(!collapsed && b.dataset.panel === currentPanel));
      });
    };

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

    // Floating expand button — always reachable when panel is collapsed,
    // including narrow widths where the activity bar might be obscured.
    if (app && !app.querySelector('.lpanel-expand-btn')) {
      const expandBtn = document.createElement('button');
      expandBtn.className = 'lpanel-expand-btn';
      expandBtn.title = 'Open side panel';
      expandBtn.setAttribute('aria-label', 'Open side panel');
      expandBtn.innerHTML = '&#x203A;';
      expandBtn.addEventListener('click', () => setCollapsed(false));
      app.appendChild(expandBtn);
    }
  }

  private wireRpanelTabs(): void {
    const tabs = this.container.querySelectorAll<HTMLElement>('.rpanel-tab');
    const panes = this.container.querySelectorAll<HTMLElement>('.rpanel-body .tab-pane');
    const app = this.container.closest('#app') ?? this.container;

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab!;
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
        panes.forEach(p => p.classList.toggle('active', p.dataset.tab === tabId));
        // Clicking a tab while collapsed re-opens the panel
        app.classList.remove('rpanel-collapsed');
        this.syncRpanelToggleIcon();
      });
    });

    // Close / re-open buttons
    const toggleClose = this.container.querySelector<HTMLElement>('#rpanel-toggle');
    const toggleOpen = this.container.querySelector<HTMLElement>('#rpanel-reopen');
    const toggle = () => {
      app.classList.toggle('rpanel-collapsed');
      this.syncRpanelToggleIcon();
    };
    toggleClose?.addEventListener('click', toggle);
    toggleOpen?.addEventListener('click', toggle);
    this.syncRpanelToggleIcon();
  }

  private syncRpanelToggleIcon(): void {
    const app = this.container.closest('#app') ?? this.container;
    const btn = this.container.querySelector<HTMLElement>('#rpanel-toggle');
    if (!btn) return;
    const collapsed = app.classList.contains('rpanel-collapsed');
    btn.innerHTML = collapsed ? '&#x2039;' : '&#x203A;';
    btn.title = collapsed ? 'Open Properties panel (Ctrl+\\)' : 'Close Properties panel (Ctrl+\\)';
  }

  private wireThemeToggle(): void {
    const btn = this.container.querySelector<HTMLElement>('#theme-toggle');
    if (!btn) return;
    const root = document.documentElement;

    // Restore persisted theme
    const saved = localStorage.getItem('folio:ui-theme') ?? 'dark';
    root.setAttribute('data-theme', saved);
    btn.innerHTML = saved === 'light' ? '&#9790;' : '&#9788;';
    btn.title = saved === 'light' ? 'Switch to dark theme' : 'Switch to light theme';

    btn.addEventListener('click', () => {
      const isLight = root.getAttribute('data-theme') === 'light';
      const next = isLight ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      btn.innerHTML = next === 'light' ? '&#9790;' : '&#9788;';
      btn.title = next === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
      localStorage.setItem('folio:ui-theme', next);
      this.payloadEditor?.setTheme(next);
    });
  }

  private wireMobileNav(): void {
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

  private wireAssetPanel(): void {
    const btn   = this.container.querySelector<HTMLElement>('#open-folder-btn');
    const grid  = this.container.querySelector<HTMLElement>('#asset-grid');
    if (!btn || !grid) return;

    btn.addEventListener('click', async () => {
      try {
        await projectFolder.open();
        btn.textContent = `📁 ${projectFolder.rootName}`;
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

  private wireStatusBar(): void {
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
    q('#canvas-resize')?.addEventListener('click', () => {
      const doc = this.state.get().design?.document;
      if (!doc) return;
      canvasResizeDialog.open(
        { width: doc.width, height: doc.height, dpi: doc.dpi ?? 96, unit: (doc.unit ?? 'px') as import('../ui/dialogs/canvas-resize').CanvasDocSpec['unit'] },
        (spec) => {
          const design = this.state.get().design;
          if (!design) return;
          this.state.set('design', { ...design, document: { ...design.document, ...spec } });
        },
      );
    });

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

  private updateFormulaBar(): void {
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

    this.state.batch(() => {
      this.state.set('design', spec);
      this.state.set('yamlSource', serializeYAML(spec));
      this.state.set('selectedLayerIds', []);
      this.state.set('currentPageIndex', 0);
      this.state.set('dirty', false);
    });
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

  printDesign(bleed = 0): void {
    openPrintWindow(this.state, { bleed, cropMarks: bleed > 0 });
  }

  exportSVG(): string {
    return this.canvas.exportSVG();
  }

  applyTheme(themeId: string): void {
    const theme = BUILTIN_THEMES[themeId];
    if (theme) this.state.set('theme', theme);
  }
}
