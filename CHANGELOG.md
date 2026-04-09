# Changelog

## [Unreleased]

## [1.0.0] - 2026-04-09

### Added

#### Phase 1 — Editor + Engine
- Full type system: 15 layer types, 6 fill types, themes, components, templates, project manifests
- YAML parser/serializer with `js-yaml` (full Unicode, comments support)
- Schema validator: required fields, duplicate IDs, z-index conflicts, fill types, pos array length, type-specific checks
- Token resolver: `$token` syntax against theme colors/typography/effects/radii with deep nested search and override support
- SVG renderer: all layer types (rect, circle, path, polygon, line, text, image, icon, mermaid, chart, code, math, group) with gradient fills (linear, radial, conic, multi), SVG filters (drop-shadow, blur), noise overlays, effects pipeline
- Render cache with dirty tracking (JSON hash per layer)
- Grid overlay (column guides, baseline grid, center crosshair)
- Component system: `{{prop}}` slot resolution, template system with required/optional slots
- Component rendering integrated into main render pipeline with registry lookup
- Markdown text rendering via marked.js (lazy loaded)
- Monaco editor integration with bidirectional YAML<->canvas live sync, inline error markers
- Editor state manager with immutable undo/redo stack (100 levels)
- Canvas: zoom, pan, drag, pointer events, shift-click multi-select
- interact.js: drag-to-move, resize handles (NW/NE/SW/SE), snap-to-grid
- Alignment tools: left, right, top, bottom, center-h, center-v, distribute-h, distribute-v
- Command palette (/ shortcut) with 30+ searchable commands
- Keyboard shortcuts: undo, redo, delete, duplicate, z-order, zoom, grid toggle
- Layer panel: z-band grouped, collapsible, type icons
- Properties panel: context-aware per layer type (rect, circle, text, line)
- Page strip: carousel page navigation, thumbnails, add page
- Problems panel: live validation error display with severity indicators
- Export pipeline: SVG, PNG (canvas API, 2x scale), self-contained HTML
- File system access: File System Access API with `<input>` fallback
- CSS variables design token system for editor UI
- Responsive layout (desktop, tablet, mobile breakpoints)

#### Phase 2 — MCP Server
- Stdio transport MCP server with JSON-RPC 2.0 protocol
- 11 tools: create_project, list_designs, create_design, append_page, patch_design, seal_design, add_layer, update_layer, remove_layer, list_themes, export_design
- Full tool registry with inputSchema definitions for LLM tool-use
- Semantic shorthand parser (Level 2 compact YAML -> full verbose expansion)
- Context compression for local LLM token budget optimization
- Dot-path selector patching with array index notation (`pages[id=page_1].slots.title`)
- Incremental carousel generation protocol (create -> append -> seal)
- Resumable generation state tracking in design meta

#### Phase 3 — Animation
- CSS animation generator: 15 enter types, 7 exit types, 7 loop types
- Stagger sequence generator with configurable inter-item delays
- Composite animations (enter + loop combined)
- Keyframe engine: N-keyframe interpolation, 5 easing functions, hex color interpolation
- PlaybackController: play/pause/stop/seek with requestAnimationFrame loop
- Animated HTML export with injected CSS animations

#### Testing & CI/CD
- 195 unit + integration tests across 12 test files
- Comprehensive integration tests: full poster workflow, carousel workflow, MCP create→append→seal
- Realistic YAML fixtures: full-poster (13 layers, all types), carousel-guide (3 pages), theme, component
- GitHub Actions CI: lint, typecheck, unit tests (multi-OS/Node matrix), integration tests, build, bundle size check, performance benchmarks
- Dev/prod Vite configuration with sourcemaps, minification control, environment defines

### Technical Decisions
- Vanilla TypeScript (no React/Vue) — own render loop, no VDOM overhead
- SVG-in-HTML as primary render target — vector native, exportable
- YAML source of truth with JSON runtime — comments + readability + fast parse
- Banded z-index system (0-9 bg, 10-19 structural, 20-49 content, 50-69 overlay, 70-89 foreground)
- `$token` for theme references, `{{prop}}` for component slot references
- Lazy loading for heavy renderers (Monaco, mermaid, vega-lite, KaTeX, Prism.js)
- Deterministic rendering: same YAML -> identical SVG output
- Offline-first: zero network requests after npm install
