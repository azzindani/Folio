// Folio editor — the shell markup.
//
// Every element of the editor chrome in one template: the toolbar mount, the
// formula bar, both activity rails, the left/right panel views, the canvas
// section, the mobile nav and the status bar. Split out of app-base.ts to keep
// both files inside the 700-line budget; it is markup only — every binding on
// it is wired by EditorAppBase, which owns the element it renders into.
import { chromeIcon } from './chrome-icons';
import { sc } from '../utils/shortcut';

/** The editor shell, ready to be assigned to the app container's innerHTML. */
export function shellMarkup(): string {
  return `
      <div class="toolbar"></div>

      <div class="formula-bar">
        <div class="formula-bar-resize-handle" data-resize="formula"></div>
        <span class="fb-layer-id">—</span>
        <span class="fb-prefix">ƒ=</span>
        <input class="fb-input" type="text" placeholder="Select a layer to inspect…" spellcheck="false">
      </div>

      <div class="activity-bar">
        <button class="act-btn active" data-panel="layers" title="Layers (${sc('⌘⇧L')})">${chromeIcon('layers')}</button>
        <button class="act-btn" data-panel="files" title="Files (${sc('⌘⇧E')})">${chromeIcon('folder')}</button>
        <button class="act-btn" data-panel="project-assets" title="Project assets">${chromeIcon('image')}</button>
        <button class="act-btn" data-panel="components" title="Components (${sc('⌘⇧K')})">${chromeIcon('component')}</button>
        <button class="act-btn" data-panel="icons" title="Icons (${sc('⌘⇧I')})">${chromeIcon('star')}</button>
        <button class="act-btn" data-panel="find" title="Find &amp; Replace (${sc('⌘H')})">${chromeIcon('search')}</button>
        <div class="act-spacer"></div>
        <button class="act-btn" id="theme-toggle" title="Toggle light/dark theme">${chromeIcon('moon')}</button>
      </div>

      <div class="mob-backdrop"></div>

      <nav class="mobile-nav" aria-label="Mobile navigation">
        <button class="mob-nav-btn" data-mob="layers" title="Layers">${chromeIcon('layers', 18)}<span>Layers</span></button>
        <button class="mob-nav-btn" data-mob="props" title="Properties">${chromeIcon('sliders', 18)}<span>Props</span></button>
        <button class="mob-nav-btn" data-mob="tools" title="Drawing tools">${chromeIcon('component', 18)}<span>Tools</span></button>
        <button class="mob-nav-btn" data-mob="panels" title="All panels">${chromeIcon('frame', 18)}<span>Panels</span></button>
        <button class="mob-nav-btn" data-mob="cmd" title="Command palette">${chromeIcon('search', 18)}<span>Find</span></button>
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
          <div class="project-assets-content" style="flex:1;min-height:0;overflow:hidden"></div>
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
        <!-- Fit / Grid / Resize were three controls drawing the SAME ⊞ glyph,
             which made the strip unreadable: you had to hover to learn which
             was which, and a phone has no hover. One mark each. -->
        <button class="sb-btn" id="zoom-fit" title="Fit to screen (${sc('⌘0')})"
          aria-label="Fit to screen">${chromeIcon('fit', 15)}</button>
        <div class="status-sep"></div>
        <button class="sb-btn" id="toggle-grid" title="Grid (G)" aria-label="Grid">${chromeIcon('grid', 15)}</button>
        <button class="sb-btn" id="toggle-snap" title="Snap" aria-label="Snap">${chromeIcon('snap', 15)}</button>
        <div class="status-sep"></div>
        <span class="sb-ruler-unit" id="sb-ruler-unit" title="Click to change ruler units">px</span>
        <div class="status-sep"></div>
        <button class="sb-btn" id="canvas-resize" title="Resize canvas"
          aria-label="Resize canvas">${chromeIcon('page', 15)}</button>
        <div class="status-sep"></div>
        <!-- Not a third ▶. This opens PRESENTATION mode (full-screen pages you
             click through) — a different verb from Play, so a different mark. -->
        <button class="sb-btn" id="status-preview" title="Present full screen (F5)"
          aria-label="Present full screen">${chromeIcon('present', 15)}</button>
        <div class="status-spacer"></div>
        <span class="sb-info" id="sb-info"></span>
      </div>
    `;
}
