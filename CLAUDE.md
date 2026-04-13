# CLAUDE.md — Folio Design Engine
# Local-first YAML graphic design engine | LLM-first architecture
# v2.0.0 | Phase 1 ~90% complete

> Full specs live in docs/ARCHITECTURE.md (architecture) and docs/DESIGN.md (design system + payload format).

---

## 0. AGENT PRINCIPLES

### 0.1 Caveman Compress — Output Style

Write dense. Every token earns its place.

```
REMOVE:  articles (a, an, the) where meaning clear
REMOVE:  filler (really, certainly, just, simply, basically)
REMOVE:  hedging (might, could, should consider, it's worth noting)
USE:     → instead of "leads to / produces"
USE:     ✓/✗ instead of "yes/no, allowed/not"
USE:     tables > prose · bullets > paragraphs · symbols: ~ < > × ±
```

Before: "You should always make sure to run the test suite before pushing."
After:  "Run tests before push."

Code blocks, URLs, file paths, commands, version numbers — never compress.

### 0.2 Incremental Code Writing

Never write >150 lines of code in one response.

```
Protocol:
  Step 1: declare structure (interfaces, signatures, imports)
  Step 2: implement section 1 → confirm
  Step 3: implement section 2 → confirm
  ...repeat until done

Trigger: any file >150 lines, any module with >3 functions
Method:  Write skeleton first → Edit to fill each function
Never:   dump 300+ line file in one shot
```

### 0.3 Coding Best Practices

```
TypeScript:
  ✓ strict mode (noImplicitAny, strictNullChecks)
  ✓ explicit return types on all public functions
  ✓ no `any` — use `unknown` + narrow or proper generics
  ✓ no `!` non-null assertions — handle null explicitly
  ✗ no console.log in production (use src/utils/debug.ts)
  ✗ no TODOs/FIXMEs in merged code
  ✗ no unused variables, imports, exports

Structure:
  ✓ single responsibility per file/function
  ✓ pure functions where possible
  ✓ explicit error handling on every async call
  ✓ tests written alongside code, not after
  ✗ no style string blobs (blocks animation)
  ✗ no Math.random() in render path (seed with layer id)
  ✗ no Date.now() in render path
```

### 0.4 Git Workflow

```
Branch:  claude/refactor-claude-md-TpXBO
Push:    git push -u origin <branch>
Retry:   up to 4× on network failure (backoff: 2s, 4s, 8s, 16s)
Never:   push main directly · --no-verify · --force without approval
PRs:     only when user explicitly requests
```

---

## 1. PROJECT BRIEF

```
LLM    = intent generator    → writes semantic shorthand YAML
Engine = spec compiler       → expands shorthand → render tree
Editor = visual spec editor  → GUI over the YAML
Disk   = verbose spec store  → .design.yaml files
MCP    = tool surface        → LLM ↔ engine bridge
```

Design file IS the product. HTML canvas = view only.
Full spec: docs/DESIGN.md. Full architecture: docs/ARCHITECTURE.md.

### Use Cases
1. How-to posters — template + slots, LLM fills content
2. Single-page posters — custom layout, LLM generates spec
3. Carousel / slide decks — paged, incremental MCP generation
4. Technical diagrams — Mermaid + shapes + data viz
5. Batch generation — 1 template × N content variations

---

## 2. STACK (summary)

```
Build:     Vite + TypeScript (strict)
Render:    SVG-in-HTML (no Canvas API, no Fabric.js)
Framework: Vanilla TS (no React/Vue/Svelte)
Drag:      interact.js
Editor:    Monaco (lazy loaded)
YAML:      js-yaml
Renderers: marked.js (always) · mermaid/vega-lite/katex/prism (lazy)
Export:    dom-to-image-more + jsPDF + SVG serialize
MCP:       Node.js stdio, reads/writes .yaml files directly
Tests:     Vitest (unit) · Playwright (E2E + visual)
```

Never: React/Vue/jQuery/Lodash/axios/Bootstrap/CDN at runtime.

---

## 3. MODULE MAP

| Module | Path | Status |
|---|---|---|
| Types | `src/schema/types.ts` | ✓ Complete |
| Parser | `src/schema/parser.ts` | ✓ Complete |
| Validator | `src/schema/validator.ts` | ✓ Complete |
| Token resolver | `src/engine/token-resolver.ts` | ✓ Complete |
| Shorthand expander | `src/engine/shorthand-expander.ts` | ✓ Complete |
| Component resolver | `src/engine/component-resolver.ts` | ✓ Complete |
| SVG renderer | `src/renderer/renderer.ts` | ✓ Complete |
| Layer renderers | `src/renderer/layer-renderers.ts` | ✓ Complete (icon/conic = placeholder) |
| Fill renderer | `src/renderer/fill-renderer.ts` | ✓ Complete |
| Effects renderer | `src/renderer/effects-renderer.ts` | ✓ Complete |
| Editor app | `src/editor/app.ts` | ✓ Complete |
| Canvas manager | `src/editor/canvas.ts` | ✓ Complete |
| Interactions | `src/editor/interactions.ts` | ✓ Complete |
| State manager | `src/editor/state.ts` | ✓ Complete |
| Keyboard | `src/editor/keyboard.ts` | ✓ Complete |
| Payload editor | `src/editor/payload-editor.ts` | ✓ Complete |
| Exporter | `src/export/exporter.ts` | ✓ Complete |
| Animation CSS | `src/animation/css-generator.ts` | ✓ Complete |
| Keyframe engine | `src/animation/keyframe-engine.ts` | ✓ Complete |
| MCP tool handlers | `src/mcp/tool-handlers.ts` | ✓ Complete |
| MCP server | `src/mcp/mcp-server.ts` | ✓ Complete |
| Shorthand parser | `src/mcp/shorthand-parser.ts` | ✓ Complete |
| File access | `src/fs/file-access.ts` | ✓ Complete |
| File watcher | `src/fs/file-watcher.ts` | ✓ Complete |
| Layer panel | `src/ui/panels/layer-panel.ts` | ✓ Complete |
| Properties panel | `src/ui/panels/properties-panel.ts` | ~ Partial (gradient editor stub) |
| Problems panel | `src/ui/panels/problems-panel.ts` | ✓ Complete |
| File tree | `src/ui/panels/file-tree.ts` | ✓ Complete |
| Page strip | `src/ui/panels/page-strip.ts` | ✓ Complete |
| Command palette | `src/ui/palette/command-palette.ts` | ✓ Complete |
| Align toolbar | `src/ui/tools/align-toolbar.ts` | ✓ Complete |
| Toolbox | `src/ui/tools/toolbox.ts` | ✓ Complete |
| Built-in themes | `src/themes/builtin.ts` | ✓ Complete |
| Debug util | `src/utils/debug.ts` | ✓ Complete |

---

## 4. KNOWN GAPS (not yet implemented)

| Gap | Area | Priority |
|---|---|---|
| Lucide SVG sprite (icon layer uses placeholder) | Renderer | High |
| Per-corner border radius (currently averaged) | Renderer | Medium |
| Mode B interactive output (state, scripts, data binding) | Export | Phase 2 |
| Scripting sandbox (iframe/SES) | Security | Phase 2 |
| Timeline editor UI | Animation | Phase 3 |
| GIF / MP4 / WebM / Lottie export | Export | Phase 3 |
| Puppeteer PDF (high-fidelity) | Export | Phase 2 |
| `npm install` not run (node_modules missing) | Setup | Immediate |

---

## 5. PERFORMANCE TARGETS (non-negotiable)

```
Cold start:              < 1s
Parse + first render:    < 100ms (50 layers)
Layer drag:              < 16ms  (60fps)
PNG export 1080×2:       < 3s
Monaco load:             < 500ms
Bundle (gzip, no Monaco): < 500KB
Memory (50L):            < 50MB
Memory (200L):           < 150MB
```

---

## 6. DEFINITION OF DONE

```
Code:   ✓ zero TS errors · no console.log · no TODOs · errors handled
Tests:  ✓ unit passing · coverage target met · E2E covers flow
CI:     ✓ all checks green · bundle <5% regression · perf <10% regression
```

Coverage targets: token-resolver 98% · schema 95% · renderer 90% · MCP 90% · export 85% · overall >80%
