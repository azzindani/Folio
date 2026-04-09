import { StateManager } from './state';
import { CanvasManager } from './canvas';
import { PayloadEditor } from './payload-editor';
import { ToolbarManager } from '../ui/toolbar/toolbar';
import { LayerPanelManager } from '../ui/panels/layer-panel';
import { PropertiesPanelManager } from '../ui/panels/properties-panel';
import { PageStrip } from '../ui/panels/page-strip';
import { CommandPalette } from '../ui/palette/command-palette';
import { KeyboardManager } from './keyboard';
import { parseDesign, serializeYAML } from '../schema/parser';
import { validateDesignSpec } from '../schema/validator';
import type { DesignSpec, ThemeSpec } from '../schema/types';
import { fileWatcher } from '../fs/file-watcher';

const DEFAULT_THEME: ThemeSpec = {
  _protocol: 'theme/v1',
  name: 'Dark Tech',
  version: '1.0.0',
  colors: {
    background: '#1A1A2E',
    surface: '#16213E',
    primary: '#E94560',
    secondary: '#3D9EE4',
    text: '#FFFFFF',
    text_muted: '#8892A4',
    border: '#2A2A4A',
  },
  typography: {
    scale: {
      display: { size: 96, weight: 800, line_height: 1.0 },
      h1: { size: 72, weight: 700, line_height: 1.1 },
      h2: { size: 48, weight: 700, line_height: 1.2 },
      h3: { size: 32, weight: 600, line_height: 1.3 },
      body: { size: 18, weight: 400, line_height: 1.6 },
      caption: { size: 14, weight: 400, line_height: 1.5 },
      label: { size: 12, weight: 600, line_height: 1.0 },
    },
    families: {
      heading: 'Inter',
      body: 'Inter',
      mono: 'JetBrains Mono',
    },
  },
  spacing: { unit: 8, scale: [0, 4, 8, 16, 24, 32, 48, 64, 80, 96, 128] },
  effects: {
    shadow_card: '0 4px 24px rgba(0,0,0,0.4)',
    shadow_glow: '0 0 32px rgba(233,69,96,0.3)',
    blur_glass: 12,
  },
  radii: { sm: 4, md: 8, lg: 16, xl: 24, full: 9999 },
};

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
  private layerPanel!: LayerPanelManager;
  private propertiesPanel!: PropertiesPanelManager;
  private pageStrip!: PageStrip;
  private commandPalette!: CommandPalette;
  private keyboard!: KeyboardManager;
  private activeFileHandle: FileSystemFileHandle | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.state = new StateManager();
  }

  async init(): Promise<void> {
    this.buildLayout();

    this.canvas = new CanvasManager(
      this.container.querySelector('.canvas-area')!,
      this.state,
    );

    this.toolbar = new ToolbarManager(
      this.container.querySelector('.toolbar')!,
      this.state,
      this,
    );

    this.layerPanel = new LayerPanelManager(
      this.container.querySelector('.layer-panel')!,
      this.state,
    );

    this.propertiesPanel = new PropertiesPanelManager(
      this.container.querySelector('.properties-panel')!,
      this.state,
    );

    this.pageStrip = new PageStrip(
      this.container.querySelector('.layer-panel')!,
      this.state,
    );

    this.keyboard = new KeyboardManager(this.state, this);

    // Command palette
    this.commandPalette = new CommandPalette(this.container, this.state, this);

    // Initialize Monaco payload editor (lazy loaded)
    const monacoContainer = this.container.querySelector('.monaco-container') as HTMLElement;
    this.payloadEditor = new PayloadEditor(monacoContainer, this.state);
    this.payloadEditor.init().catch(() => {
      // Monaco failed to load — non-critical, visual mode still works
    });

    // Load default theme + sample design
    this.state.set('theme', DEFAULT_THEME);
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
      <div class="file-tree">
        <div class="panel-header">Files</div>
        <div class="file-tree-content"></div>
      </div>
      <div class="canvas-area">
        <div class="monaco-container" style="display:none"></div>
      </div>
      <div class="properties-panel">
        <div class="panel-header">Properties</div>
        <div class="properties-content"></div>
      </div>
      <div class="layer-panel">
        <div class="panel-header">Layers</div>
        <div class="layer-panel-content"></div>
      </div>
    `;
  }

  /**
   * Called after a file is opened via the FSA picker.
   * Registers the handle with the file watcher so external edits are detected.
   */
  setActiveFileHandle(handle: FileSystemFileHandle, content: string): void {
    if (this.activeFileHandle) {
      fileWatcher.unwatch(this.activeFileHandle.name);
    }
    this.activeFileHandle = handle;
    fileWatcher.watch(handle, content);
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

  exportSVG(): string {
    return this.canvas.exportSVG();
  }
}
