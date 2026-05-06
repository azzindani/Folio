# UX Roadmap — Folio

Comprehensive feature matrix benchmarked against Photoshop, Figma, Illustrator,
Sketch, Affinity Designer, and Canva. Tracks what Folio has, what's missing,
priority (must-have / nice-to-have), and effort.

Legend:
- ✓ shipped
- ◐ partial
- ✗ missing
- M  must-have
- N  nice-to-have

Source ranking: cross-tool consensus + frequency on competitor feature pages.

---

## 0. Foundations

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 0.1 | Infinite canvas with pan/zoom | ✓ | M | wheel zoom, space-drag pan |
| 0.2 | Auto-fit on load | ✓ | M | shipped this session |
| 0.3 | Rulers (px / mm / in) | ✓ | M | unit toggle in status bar |
| 0.4 | Grid overlay (toggleable) | ✓ | M | G shortcut |
| 0.5 | Smart guides (alignment hints) | ✓ | M | live during drag |
| 0.6 | Snap-to-grid / guides / objects | ◐ | M | grid + ruler guides yes; object-edge snapping partial |
| 0.7 | Pixel grid at high zoom | ✗ | N | shows individual pixels >800% |
| 0.8 | HiDPI / retina rendering | ✓ | M | SVG is resolution-independent |
| 0.9 | Multi-page document support | ✓ | M | carousels |
| 0.10 | Workspace presets (save layout) | ✗ | N | "Essentials / Painting / Print" presets |
| 0.11 | Multiple viewports / split view | ✓ | N | viewport-layout split-h/v/grid |

## 1. Selection

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 1.1 | Click to select layer | ✓ | M | |
| 1.2 | Shift-click to add/remove | ✓ | M | |
| 1.3 | Marquee (rubber-band) selection | ✓ | M | drag on empty canvas |
| 1.4 | Click-through nested layers (alt-click) | ✗ | M | currently selects topmost only |
| 1.5 | Tab / Shift-Tab to cycle layers | ✗ | N | |
| 1.6 | Select Same → fill / stroke / type | ✗ | N | "Select all rects with red fill" |
| 1.7 | Lock / unlock layer | ✓ | M | |
| 1.8 | Hide / show layer | ✓ | M | |
| 1.9 | Isolation mode (edit inside group only) | ✗ | N | dim everything outside group |
| 1.10 | Hover highlight before click | ◐ | M | CSS hover on layer-row but not on canvas SVG |
| 1.11 | Selection persistence across page nav | ✗ | N | |

## 2. Transform

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 2.1 | Move (drag with arrow nudge) | ✓ | M | |
| 2.2 | Resize from 8 handles | ✓ | M | |
| 2.3 | Resize with Shift = aspect lock | ✓ | M | |
| 2.4 | Resize with Alt = from center | ✗ | M | Photoshop / Illustrator standard |
| 2.5 | Rotate via handle | ✓ | M | |
| 2.6 | Rotate snap to 15° (Shift) | ✓ | M | |
| 2.7 | Skew / shear | ✗ | N | |
| 2.8 | Free transform combo (W/H/Skew/Rotate in one panel) | ✗ | N | |
| 2.9 | Numeric transform input | ◐ | M | properties panel has X/Y/W/H but no skew/rotation field set |
| 2.10 | Multi-layer group transform (resize all proportionally) | ◐ | M | grouped layers OK, ad-hoc selection no |
| 2.11 | Distort / Perspective transform | ✗ | N | |
| 2.12 | Warp / mesh transform | ✗ | N | |
| 2.13 | Pivot point picker | ✗ | N | rotate around custom anchor |
| 2.14 | Flip horizontal / vertical | ✗ | M | one-click in toolbar |

## 3. Alignment & distribution

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 3.1 | Align L/R/T/B/CenterH/CenterV | ✓ | M | |
| 3.2 | Distribute horizontal / vertical | ✓ | M | |
| 3.3 | Tidy up (auto-arrange in grid) | ✗ | N | Figma "tidy" |
| 3.4 | Align to canvas vs selection | ✗ | M | toggle to switch reference |
| 3.5 | Equal spacing input | ✗ | N | type "20px gap" between objects |
| 3.6 | Match width / height of last selected | ✗ | N | |

## 4. Drawing & shapes

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 4.1 | Rectangle / ellipse / line / polygon | ✓ | M | |
| 4.2 | Rounded corners (per-corner) | ◐ | M | uniform radius only |
| 4.3 | Star / arrow shapes | ◐ | M | shapes in toolbox; no editor for star points |
| 4.4 | Pen tool (bezier paths) | ◐ | M | layer type exists; no editor UI |
| 4.5 | Path editing handles (anchors) | ✗ | M | |
| 4.6 | Boolean ops (union / subtract / intersect / exclude) | ✗ | M | |
| 4.7 | Convert shape to path | ✗ | N | |
| 4.8 | Smooth / corner / asymmetric anchor types | ✗ | N | |
| 4.9 | Custom shape library / assets | ◐ | N | components panel partial |
| 4.10 | Pencil / freehand draw | ✗ | N | |
| 4.11 | Eraser tool | ✗ | N | |

## 5. Text & typography

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 5.1 | Text layer with font, size, weight, color | ✓ | M | |
| 5.2 | Inline editor (double-click) | ✓ | M | |
| 5.3 | Multi-line wrap with width | ✓ | M | |
| 5.4 | Font picker UI | ◐ | M | dropdown exists, no preview |
| 5.5 | Letter spacing / tracking | ◐ | M | spec supports it; UI control? |
| 5.6 | Line height | ✓ | M | |
| 5.7 | Text on path | ✗ | N | |
| 5.8 | Vertical text | ✗ | N | |
| 5.9 | Bullet / numbered lists | ✗ | N | |
| 5.10 | Rich text styles per character range | ✗ | N | |
| 5.11 | Auto-resize text box (fit content) | ◐ | M | width:auto exists |
| 5.12 | Drop shadow on text | ✓ | M | via effects |
| 5.13 | Outline / stroke text | ◐ | N | partial via stroke fill |
| 5.14 | Variable font axis sliders | ✗ | N | |
| 5.15 | Find-and-replace text | ✓ | N | find-replace panel |

## 6. Color & fills

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 6.1 | Solid color fill | ✓ | M | |
| 6.2 | Linear / radial gradient | ✓ | M | |
| 6.3 | Image fill | ◐ | M | image layer yes; image-as-fill no |
| 6.4 | Pattern / tile fill | ✗ | N | |
| 6.5 | Color picker with eyedropper | ◐ | M | eyedropper tool registered, behavior? |
| 6.6 | HEX / RGB / HSL inputs | ✓ | M | |
| 6.7 | Color swatches / saved palette | ✓ | M | color palette panel |
| 6.8 | Theme colors (semantic tokens) | ✓ | M | $primary, $surface etc. |
| 6.9 | Recent colors history | ✗ | N | |
| 6.10 | Document palette extraction | ✗ | N | "extract palette from image" |
| 6.11 | Stroke (border) with width / dash | ✓ | M | |
| 6.12 | Stroke alignment (inside / center / outside) | ✗ | N | |
| 6.13 | Multi-stop gradient | ✓ | M | |
| 6.14 | Gradient editor with handles | ✗ | M | currently numeric only |
| 6.15 | Color contrast checker | ✓ | N | a11y panel |

## 7. Effects

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 7.1 | Drop shadow | ✓ | M | |
| 7.2 | Inner shadow | ✗ | M | |
| 7.3 | Blur (Gaussian) | ◐ | M | layer effect exists |
| 7.4 | Background blur (frosted glass) | ✗ | N | |
| 7.5 | Glow / outer glow | ◐ | N | |
| 7.6 | Noise / grain | ✗ | N | |
| 7.7 | Layer blend modes | ✗ | M | multiply / overlay / screen etc. |
| 7.8 | Mask (clip path) | ◐ | M | clip layer type exists |
| 7.9 | Mask with alpha (luminance / vector) | ✗ | N | |
| 7.10 | Adjustment layers (brightness / hue) | ✗ | N | |
| 7.11 | Filter previews | ✗ | N | |

## 8. Layers & organization

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 8.1 | Layers panel with thumbnails | ◐ | M | rows exist; no thumb |
| 8.2 | Drag to reorder | ✓ | M | |
| 8.3 | Group / ungroup (Ctrl+G / Ctrl+Shift+G) | ✓ | M | |
| 8.4 | Nested groups | ✓ | M | |
| 8.5 | Auto-layout (flexbox-style frames) | ✓ | M | auto_layout layer |
| 8.6 | Folders / nested grouping in panel | ✓ | M | |
| 8.7 | Rename layer (double-click) | ✓ | M | |
| 8.8 | Layer search / filter | ✗ | N | |
| 8.9 | Layer color labels | ✗ | N | |
| 8.10 | Smart object / instance | ✓ | M | components |
| 8.11 | Detach instance | ◐ | M | |

## 9. Pages, frames, prototyping

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 9.1 | Multiple pages | ✓ | M | |
| 9.2 | Page templates / presets | ◐ | M | poster / carousel / report types |
| 9.3 | Frame (artboard) | ✓ | M | auto_layout |
| 9.4 | Reusable components | ✓ | M | |
| 9.5 | Component variants (size, state) | ◐ | N | |
| 9.6 | Prototype interactions (on-click navigation) | ✗ | N | Figma-style links |
| 9.7 | Hotspots in prototype | ✗ | N | |
| 9.8 | Animation between frames | ✓ | N | page transitions |
| 9.9 | Comments / annotations | ✗ | N | |

## 10. Editor controls / chrome

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 10.1 | Top toolbar | ✓ | M | |
| 10.2 | Left tool palette | ✓ | M | |
| 10.3 | Right inspector panel | ✓ | M | |
| 10.4 | Properties panel reactive to selection | ✓ | M | |
| 10.5 | Activity bar (left) icon nav | ✓ | M | |
| 10.6 | Right panel switch via icon nav | ✗ | M | currently text-tab; user requested icon-button parity |
| 10.7 | Status bar (zoom, page, units) | ✓ | M | |
| 10.8 | Command palette (⌘K) | ✓ | M | |
| 10.9 | Quick search by symbol / layer | ✗ | N | |
| 10.10 | Resizable panels | ✓ | M | |
| 10.11 | Collapsible sidebars | ✓ | M | |
| 10.12 | Detachable / docked panels | ✗ | N | |
| 10.13 | Touch / pen tablet support | ◐ | N | pointer events, no pressure |
| 10.14 | Tablet pressure sensitivity | ✗ | N | |
| 10.15 | Right-click context menu | ◐ | M | partial |

## 11. Workflow & history

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 11.1 | Undo / redo (Ctrl+Z / Y) | ✓ | M | per-interaction snapshot (fixed this session) |
| 11.2 | History panel with timeline | ✗ | N | |
| 11.3 | Auto-save | ✓ | M | |
| 11.4 | Version history / restore | ✗ | N | |
| 11.5 | Snapshot / state | ✗ | N | named states |
| 11.6 | Cloud sync | ✗ | N | |
| 11.7 | Collaborative editing | ✓ | N | SSE collab server |
| 11.8 | Comments on layers | ✗ | N | |
| 11.9 | Activity feed | ✗ | N | |

## 12. Import / export

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 12.1 | Export PNG (1×, 2×, 3×) | ✓ | M | |
| 12.2 | Export SVG | ✓ | M | |
| 12.3 | Export PDF | ✓ | M | jspdf + Puppeteer |
| 12.4 | Export HTML | ✓ | M | including interactive report |
| 12.5 | Export GIF / WebM / MP4 | ✓ | N | |
| 12.6 | Export Lottie (animations) | ✓ | N | |
| 12.7 | Batch export (per-layer / per-page) | ✓ | M | |
| 12.8 | Import SVG | ✗ | M | parse foreign SVG to layers |
| 12.9 | Import PSD / Sketch / Figma | ✗ | N | |
| 12.10 | Import image (PNG/JPG/HEIC) | ✓ | M | |
| 12.11 | Drag-drop file onto canvas | ◐ | M | partial |
| 12.12 | Copy / paste from / to other tools | ◐ | M | text only |
| 12.13 | Slice / export region | ✗ | N | |

## 13. Performance & rendering

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 13.1 | Atomic canvas swap (no white flash) | ✓ | M | |
| 13.2 | Per-interaction undo (not per-pixel) | ✓ | M | fixed this session |
| 13.3 | rAF throttle on drag | ✗ | N | reverted, breaks tests; revisit |
| 13.4 | Background flicker on initial load | ✗ | M | "start with blank canvas" — pending |
| 13.5 | GPU compositing where appropriate | ✗ | N | |
| 13.6 | Lazy-load Monaco / heavy modules | ✓ | M | |
| 13.7 | Bundle <500KB main entry | ✓ | M | 328KB |

## 14. Multi-object selection & group transform

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 14.1 | Marquee select multiple | ✓ | M | |
| 14.2 | Shift-click add to selection | ✓ | M | |
| 14.3 | Common bbox handles for multi-select | ✗ | M | currently per-layer handles |
| 14.4 | Group transform (resize all proportionally) | ✗ | M | |
| 14.5 | Group rotate | ✗ | N | |
| 14.6 | Align toolbar shows on multi-select | ✓ | M | |
| 14.7 | Multi-select properties (common-only) | ◐ | M | |

## 15. Photoshop / Figma niceties

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 15.1 | Smart object scale / rotate non-destructive | ✓ | M | |
| 15.2 | Slice tool for export | ✗ | N | |
| 15.3 | Asset library / styles | ✓ | M | components |
| 15.4 | Auto-layout with constraints | ✓ | M | |
| 15.5 | Constraints (left / right / center pin) | ✗ | M | for responsive design |
| 15.6 | Variants (toggle states) | ✗ | N | |
| 15.7 | Plugin / extension system | ✗ | N | |
| 15.8 | Live data (table → text binding) | ✓ | N | report binder |
| 15.9 | Math expressions in numeric inputs | ✗ | N | "100 + 20" |
| 15.10 | Px / % / em mixed units | ✗ | N | |

## 16. Accessibility & inspection

| # | Feature | Folio | Pri | Notes |
|---|---|---|---|---|
| 16.1 | Accessibility panel | ✓ | M | |
| 16.2 | Color contrast WCAG check | ✓ | M | |
| 16.3 | Alt text on images | ✓ | M | |
| 16.4 | Keyboard-only navigation | ◐ | M | tab order in panels yes; canvas no |
| 16.5 | Screen reader labels | ◐ | M | aria-* on buttons; canvas needs |
| 16.6 | Focus indicators | ◐ | M | partial |
| 16.7 | Outline mode (no fills) | ✗ | N | |
| 16.8 | Pixel-preview snap-to-pixel | ✗ | N | |

---

## Priority backlog (next iterations)

Tier-1 (must-have, broken or missing):
1. Click-through nested layers (alt-click, item 1.4)
2. Resize from center (alt-key, 2.4)
3. Flip H / V (2.14)
4. Inner shadow (7.2)
5. Layer blend modes (7.7)
6. Common bbox handles for multi-select + group transform (14.3, 14.4)
7. Alt-click hover highlight on canvas (1.10)
8. Right-panel icon-button nav for parity with left (10.6)
9. Background flicker fix (13.4)
10. Boolean ops (4.6)
11. SVG import (12.8)
12. Constraints / pinning for responsive (15.5)
13. Per-corner radius (4.2)

Tier-2 (nice-to-have, often-asked):
14. Pen tool path editing (4.4, 4.5)
15. Pixel grid at high zoom (0.7)
16. Color picker with eyedropper UX (6.5)
17. Workspace presets (0.10)
18. Hotspot / prototype links (9.6)

---

## Bug list (observed in Playwright self-simulation)

| # | Bug | Severity | Repro |
|---|---|---|---|
| B1 | Resize handles unreachable beyond canvas-area edge | high | ✓ fixed via auto-fit |
| B2 | Selection handles destroyed and re-created on every state change | medium | 60 swaps per drag |
| B3 | Per-move undo snapshot pollutes undo stack | high | ✓ fixed previous commit |
| B4 | Background flicker on first design load | medium | dimmer between activity-bar and design bg |
| B5 | Right panel uses text tabs (Props / Color / etc.); inconsistent with left icon nav | medium | UX request |
| B6 | Visual snapshots lacked baseline coverage for new auto-fit zoom | low | ✓ regenerated |
| B7 | Layer name span in left panel can swallow canvas-targeted clicks if user mis-aims | low | known, alt-click would help |
