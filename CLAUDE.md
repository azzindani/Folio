# CLAUDE.md — Folio Design Engine
# Local-first YAML graphic design engine | LLM-first architecture
# v0.1.0 | Phases 1–5 shipped · MCP deployed (folio.casava.space)

> Full docs live in docs/ — see docs/README.md for the index. Key: docs/ARCHITECTURE.md
> (architecture + full module index), docs/MCP.md + docs/TOOLS.md (MCP engine + tools),
> docs/DEPLOYMENT.md (deploy + endpoints), docs/INTEGRATIONS.md (claude.ai/Claude
> Code/LM Studio/harnesses), docs/EDITOR.md (visual editor), docs/DESIGN.md (payload format).

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
  ✓ every src/ file ≤700 lines (eslint max-lines enforces) — split into
    siblings; oversized originals are FACADES that re-export siblings
  ✗ no style string blobs (blocks animation)
  ✗ no Math.random() in render path (seed with layer id)
  ✗ no Date.now() in render path
```

### 0.4 Design Generation — Model-Led, Math-Backed

```
PRINCIPLE: the MODEL designs, the engine assists. Not the reverse.

✗ NO hard-coded design engines — no preset "recipes" that emit a fixed
  skeleton, no per-style canned layouts, no template-stamping that
  dictates the look. These make every output typical + samey.
✓ Prioritize MATH + SPATIAL calculation — geometry, ratios, grids,
  alignment, spacing, fit/overflow, balance. Spatial correctness is the
  engine's job; aesthetic choice is the model's.
✓ Let the model design FREELY and write the payload itself — positions,
  hierarchy, color, type, composition are model decisions.
✓ MCP engines only SUPPORT + GUIDE: validate spatial math, expand
  shorthand, fit/clamp to canvas, surface guidelines + hints. They make
  the model's free design RENDER WELL — they do not replace its judgment.

Litmus: if a change makes outputs more uniform, it's wrong. If it gives
the model better spatial tooling to express its own intent, it's right.
```

### 0.5 Git Workflow

```
Branch:  NONE — work on main; commit + push directly (no feature branches)
Push:    git push origin main · retry up to 4× on network fail (2s,4s,8s,16s)
Never:   --no-verify · --force without approval
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

## 2. STACK + DEPLOY

```
Lang:      TypeScript (strict)
Runtime:   bun --smol — MCP + editor servers run straight from src (NO build step)
Build:     Vite (editor dist only; build is RAM-heavy → OOMs on tight hosts, avoid)
Render:    SVG-in-HTML (no Canvas API, no Fabric.js)
Framework: Vanilla TS (no React/Vue/Svelte) · drag = interact.js · editor = Monaco (lazy)
YAML:      js-yaml
Renderers: marked.js (always) · mermaid/vega-lite/katex/prism (lazy)
Export:    dom-to-image-more + jsPDF + resvg (vector PDF) + Puppeteer (hi-fi PDF/frames)
Tests:     Vitest (unit, 3000+) · Playwright (E2E + visual)
```

Never: React/Vue/jQuery/Lodash/axios/Bootstrap/CDN at runtime.

Deploy — folio.casava.space (docker container `folio`, bun --smol, mem_limit 4g):
```
FOLIO_MODE=both → http-server.ts :3333 (MCP HTTP API) + static-server.ts :4173 (editor)
                  dispatched by scripts/docker-entrypoint.sh (modes: ui · mcp · both)
Auth:    HS256 JWT (src/mcp/jwt.ts) — falls back to FOLIO_API_KEY; editor ?token=<key> → cookie
Deploy:  docker cp src/mcp/<file> folio:/app/src/mcp/<file> && docker restart folio  (~4s, no build)
         editor-side changes need a dist rebuild (avoid — OOMs the host)
Harness: tools/harness-suite/run_live.py drives the live model session (see docs/INTEGRATIONS.md)
```

---

## 3. CODE MAP

Where things live (full per-module index in docs/ARCHITECTURE.md — 407 .ts files):

```
src/schema/    parse · validate · types        (types.ts = facade → siblings)
src/engine/    token-resolver · shorthand-expander · component-resolver
src/renderer/  SVG render + layer/fill/effects  (layer-renderers.ts = facade)
src/editor/    editor app · canvas · state · keyboard · static-server.ts
src/export/    PNG · vector/hi-fi PDF · Lottie · animation · presentation · report
src/mcp/       MCP surface (21 consolidated tools) — http-server.ts (entry) ·
               tier{1,2,3}/registry.ts (tool defs) · handlers.ts + dispatch.ts
               (op-multiplexed routing onto engine fns) · tool-remap.ts (old→new
               next_action hints) · tool-handlers ·
               shorthand-parser (facade) · shorthand-presets-{a,b,c,cards,map,news,seq} ·
               engine-finalize-* (geom/text/legibility/autoplace/pages — the rescue
               passes that make blind-model payloads render well) ·
               engine/guide.ts (model steering) · craft.ts · ai-slop-lint.ts · jwt.ts
src/ui/        editor panels · command palette · align/toolbox tools
src/report/    interactive report: data-loader · aggregator · binder · navigation
src/{animation,scripting,collab,fs,themes,utils}/   as named
```

RULE: edit the real sibling, NOT the facade. Any file pushing 700 lines → split.

---

## 4. PERFORMANCE TARGETS (non-negotiable)

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

## 5. DEFINITION OF DONE

```
Code:   ✓ zero TS errors · no console.log · no TODOs · errors handled · files ≤700 lines
Tests:  ✓ unit passing · coverage target met · E2E covers flow
CI:     ✓ all checks green · bundle <5% regression · perf <10% regression
```

Coverage targets: token-resolver 98% · schema 95% · renderer 90% · MCP 90% · export 85% · overall >80%
