# Folio

A self-hosted MCP server and visual editor that gives local LLMs structured tools to generate, edit, and export graphic designs as plain YAML files. No cloud APIs, no subscriptions — everything runs on your machine.

## Features

- **25 tools** across 3 servers: basic (10), design (9), export (6)
- **CREATE → COMPOSE → SEAL → EXPORT** workflow for structured design generation
- **Automatic snapshots** — every write creates a `.mcp_versions/` backup before touching disk
- **Operation receipt logging** — full audit trail at `~/.folio/ops.log`
- **Constrained output mode** — caps tool responses at 1,000 tokens for local models (configurable)
- **Handover protocol** — every response includes the next 3 suggested tool calls with pre-filled params so LLMs can chain tools without losing state
- **Context recovery** — `resume_task` and `resume_design` restore full carousel state after context resets
- **Shorthand layer syntax** — `pos:[x,y,w,h]`, `fill:"#hex"`, `icon:"star"` — ~80% fewer tokens than verbose YAML
- **13 layer types** — rect, circle, text, line, path, icon, image, group, mermaid, chart, code, math, component
- **Live SVG export** — server-side jsdom renderer writes real `.svg` files from MCP without a browser
- **Theme token system** — `$primary`, `$heading`, `$text_muted` resolved at render time from active theme
- **Component library** — reusable layer groups with named slot definitions
- **Carousel / multi-page** — incremental page-by-page generation with task state tracking
- **dry_run validation** — `patch_design` validates all selectors before writing
- **Visual editor** — browser canvas with 8-point resize handles, rotation, rubber-band multi-select, align toolbar, Monaco YAML editor with bidirectional sync
- **Modular architecture** — thin MCP wrappers, zero domain logic in servers; all business logic in `engine.ts`

## Important: Always Use Absolute File Paths

> **Do not use relative paths with `project_path` or `design_path`.**
>
> The MCP server runs as a subprocess and resolves paths from its own working directory, not yours. Relative paths will silently point to the wrong location.
>
> Always give the model the full absolute path:
> ```
> Create a design in /home/you/designs/my-project
> ```
> The model passes that path directly to the MCP tools. Relative paths and `~` expansion are not supported in all clients.

## Quick Install (LM Studio)

> **Tested on Linux.** macOS and Windows are supported by design and pass CI, but have not been hand-tested. Reports from non-Linux users are welcome.

### Requirements

- **Git** — `git --version`
- **Bun 1.0+** — `bun --version` ([install guide](https://bun.sh/docs/installation))
- **LM Studio** with a model that supports tool calling (Gemma 4B, Qwen 3.5, etc.)

### Platform Support

| Platform | Status |
|---|---|
| Linux | Tested — real-world verified |
| macOS | Untested — CI/CD pipeline passes |
| Windows | Untested — CI/CD pipeline passes |

### First Run

The first launch clones the repo and installs dependencies (~1–2 minutes). Subsequent launches are instant.

> **Pre-install recommended:** To avoid the LM Studio connection timeout on first launch, run this once in a terminal before connecting:
> ```bash
> d="$HOME/.mcp_servers/Folio"
> git clone https://github.com/azzindani/Folio.git "$d" --quiet
> cd "$d" && bun install --frozen-lockfile
> ```
> If you skip this and LM Studio times out, press **Restart** in the MCP Servers panel — it will reconnect and complete the install.

### Steps

1. Open LM Studio → **Developer** tab (`</>`) or find it via **Integrations**
2. Find **mcp.json** or **Edit mcp.json** → click to open
3. Paste this config:

```json
{
  "mcpServers": {
    "folio_basic": {
      "command": "bash",
      "args": [
        "-c",
        "d=\"$HOME/.mcp_servers/Folio\"; if [ ! -d \"$d/.git\" ]; then rm -rf \"$d\"; git clone https://github.com/azzindani/Folio.git \"$d\" --quiet; else cd \"$d\" && git fetch origin --quiet && git reset --hard FETCH_HEAD --quiet; fi; cd \"$d\"; bun install --frozen-lockfile --quiet; FOLIO_MCP_TIER=1 bun run src/mcp/index.ts"
      ],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" },
      "timeout": 600000
    },
    "folio_design": {
      "command": "bash",
      "args": [
        "-c",
        "d=\"$HOME/.mcp_servers/Folio\"; if [ ! -d \"$d/.git\" ]; then rm -rf \"$d\"; git clone https://github.com/azzindani/Folio.git \"$d\" --quiet; else cd \"$d\" && git fetch origin --quiet && git reset --hard FETCH_HEAD --quiet; fi; cd \"$d\"; bun install --frozen-lockfile --quiet; FOLIO_MCP_TIER=2 bun run src/mcp/index.ts"
      ],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" },
      "timeout": 600000
    },
    "folio_export": {
      "command": "bash",
      "args": [
        "-c",
        "d=\"$HOME/.mcp_servers/Folio\"; if [ ! -d \"$d/.git\" ]; then rm -rf \"$d\"; git clone https://github.com/azzindani/Folio.git \"$d\" --quiet; else cd \"$d\" && git fetch origin --quiet && git reset --hard FETCH_HEAD --quiet; fi; cd \"$d\"; bun install --frozen-lockfile --quiet; FOLIO_MCP_TIER=3 bun run src/mcp/index.ts"
      ],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" },
      "timeout": 600000
    }
  }
}
```

4. Wait for the green dot next to each server
5. Start chatting — the model will see all 25 tools

> For small models (≤32K context), use only `folio_basic` (10 tools). For 64K+ models, add `folio_design`. For 128K models, all three.

### Windows PowerShell

Replace the `"command"` and `"args"` in each entry with the PowerShell equivalent:

```json
{
  "mcpServers": {
    "folio_basic": {
      "command": "powershell",
      "args": [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$d = Join-Path $env:USERPROFILE '.mcp_servers\\Folio'; $g = Join-Path $d '.git'; if (!(Test-Path $g)) { if (Test-Path $d) { Remove-Item -Recurse -Force $d }; git clone https://github.com/azzindani/Folio.git $d --quiet } else { Set-Location $d; git fetch origin --quiet; git reset --hard FETCH_HEAD --quiet }; Set-Location $d; bun install --frozen-lockfile --quiet; $env:FOLIO_MCP_TIER='1'; bun run src/mcp/index.ts"
      ],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" },
      "timeout": 600000
    },
    "folio_design": {
      "command": "powershell",
      "args": [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$d = Join-Path $env:USERPROFILE '.mcp_servers\\Folio'; $g = Join-Path $d '.git'; if (!(Test-Path $g)) { if (Test-Path $d) { Remove-Item -Recurse -Force $d }; git clone https://github.com/azzindani/Folio.git $d --quiet } else { Set-Location $d; git fetch origin --quiet; git reset --hard FETCH_HEAD --quiet }; Set-Location $d; bun install --frozen-lockfile --quiet; $env:FOLIO_MCP_TIER='2'; bun run src/mcp/index.ts"
      ],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" },
      "timeout": 600000
    },
    "folio_export": {
      "command": "powershell",
      "args": [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$d = Join-Path $env:USERPROFILE '.mcp_servers\\Folio'; $g = Join-Path $d '.git'; if (!(Test-Path $g)) { if (Test-Path $d) { Remove-Item -Recurse -Force $d }; git clone https://github.com/azzindani/Folio.git $d --quiet } else { Set-Location $d; git fetch origin --quiet; git reset --hard FETCH_HEAD --quiet }; Set-Location $d; bun install --frozen-lockfile --quiet; $env:FOLIO_MCP_TIER='3'; bun run src/mcp/index.ts"
      ],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" },
      "timeout": 600000
    }
  }
}
```

## Available Tools

### Tier 1 — Basic (10 tools)

Project management, navigation, and task planning. Safe to use with any model — no file writes, minimal token cost.

| Tool | Purpose |
|---|---|
| `get_engine_guide` | Load engine reference guide by section: `quick_ref`, `shorthand`, `layers`, `workflow` (~200 tokens each) |
| `create_project` | Scaffold project directory with `designs/`, `assets/`, `themes/`, `exports/` and `project.yaml` |
| `list_designs` | List all `.design.yaml` files in a project with status and page count |
| `list_tasks` | List task files with progress status (pages done / total) |
| `list_themes` | List available themes registered in `project.yaml` |
| `apply_theme` | Set active theme for a project — updates `project.yaml` |
| `duplicate_design` | Copy a design with a new name and fresh UUID — registers in `project.yaml` |
| `create_task` | Plan a multi-page carousel — scaffolds task file and first design, returns first `append_page` baton |
| `resume_task` | Read task state and return exact next tool call — use after any context reset |
| `resume_design` | Read carousel generation state to continue appending pages |

---

### Tier 2 — Design (9 tools)

Full design lifecycle — create, inspect, build, edit. All write tools create a `.mcp_versions/` snapshot before touching disk.

| Tool | Purpose |
|---|---|
| `create_design` | Create a new blank `.design.yaml` (poster or carousel) registered in `project.yaml` |
| `inspect_design` | Return design metadata, layer summary, page list, and validation errors |
| `add_layers` | Add one or more layers using shorthand syntax — 80% fewer tokens than verbose YAML |
| `append_page` | Add a page to a carousel design; returns next `append_page` baton or `seal_design` when done |
| `add_layer` | Add a single layer by ID — surgical insert without replacing others |
| `update_layer` | Update specific fields on an existing layer by ID |
| `remove_layer` | Remove a layer by ID |
| `patch_design` | Apply JSON-pointer selectors to any field; supports `dry_run: true` to validate before writing |
| `seal_design` | Mark design complete, validate all layers, freeze `_mode: complete` |

---

### Tier 3 — Export (6 tools)

SVG export, batch generation, templates, and component extraction.

| Tool | Purpose |
|---|---|
| `export_design` | Export design to SVG (written to disk via server-side jsdom renderer) or HTML; PNG/PDF queued for Phase 2 |
| `export_template` | Export sealed design as `.template.yaml` skeleton with named `{{slot}}` placeholders |
| `list_template_slots` | List all injectable slots in a `.template.yaml` with paths, types, and hints |
| `inject_template` | Fill template slots with new content to produce a `.design.yaml` |
| `batch_create` | Generate N designs from one template using an array of slot objects |
| `save_as_component` | Extract selected layers into a `.component.yaml` and replace with a component instance |

---

## Workflow Reference

### Poster (single page)

```
1. create_project  → project scaffold
2. create_design   → blank .design.yaml
3. add_layers      → layers_shorthand=[{id,type,z,pos,fill,...}]
4. seal_design     → validate + freeze
5. export_design   → format: svg
```

### Carousel (multi-page)

```
1. create_project  → project scaffold
2. create_task     → plan pages=[{label,hints}], returns first append_page baton
3. append_page     → add layers for page 1; repeat until remaining==0
4. seal_design     → validate + freeze
5. export_design   → format: svg
```

### Patch (edit sealed design)

```
1. patch_design    → dry_run: true  (validate selectors)
2. patch_design    → dry_run: false (apply)
3. seal_design     → re-validate + re-freeze
```

---

## Usage Examples

### Create a poster

```
Create a project at /home/me/designs/work, then make a dark tech poster with a bold headline and a red pill badge
```

### Build a carousel

```
Plan a 5-slide product launch carousel at /home/me/designs/launch — cover, problem, solution, features, CTA
```

### Resume after context reset

```
Resume the task at /home/me/designs/launch/tasks/product-launch.task.yaml
```

### Export as SVG

```
Export /home/me/designs/work/designs/poster.design.yaml as SVG
```

### Batch from template

```
Generate 10 variations of the announcement template using the slots in /home/me/designs/templates/announcement.template.yaml
```

### Patch a specific field

```
Change the headline text in /home/me/designs/work/designs/poster.design.yaml to "Q3 Results"
```

---

## Configuration

### Token Budget

Set `FOLIO_OUTPUT_BUDGET` in the `env` section of `mcp.json` to cap tool response size in tokens. Default is `1000`. When a response exceeds the budget, least-critical fields are trimmed first (artifact paths → extra suggested tools → extra progress items → backup full path).

### Constrained Mode

Set `MCP_CONSTRAINED_MODE=true` to reduce result set sizes for lower-memory machines. This halves list row limits, layer row limits, and search result counts.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FOLIO_OUTPUT_BUDGET` | `1000` | Max tokens per tool response |
| `FOLIO_MCP_TIER` | `1` | Tool tier: `1` basic, `2` basic+design, `3` all |
| `MCP_CONSTRAINED_MODE` | `false` | Set `true` to reduce result sizes for small RAM machines |

---

## Uninstall

**Step 1:** Remove from your MCP client — delete all `folio_*` entries from `mcp.json` and restart the client.

**Step 2:** Delete installed files:

```bash
rm -rf ~/.mcp_servers/Folio
rm -rf ~/.folio          # ops.log and snapshots
```

Windows PowerShell:
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.mcp_servers\Folio"
Remove-Item -Recurse -Force "$env:USERPROFILE\.folio"
```

---

## Architecture

```
Folio/
├── src/
│   ├── mcp/
│   │   ├── index.ts             ← entry point; selects tier via FOLIO_MCP_TIER
│   │   ├── engine.ts            ← all 25 tool implementations (zero MCP imports)
│   │   ├── types.ts             ← ToolResult, ProgressItem, Handover, ContextField
│   │   ├── shorthand-parser.ts  ← expands layers_shorthand → full Layer objects
│   │   ├── engine/
│   │   │   ├── utils.ts         ← resolvePath, snapshot, readYAML, writeYAML, okResult, errResult
│   │   │   ├── guide.ts         ← 4-section engine reference guide (~200 tokens/section)
│   │   │   ├── svg-export.ts    ← server-side SVG renderer (jsdom + renderer.ts)
│   │   │   ├── task.ts          ← carousel task file CRUD + next-action baton
│   │   │   └── coerce.ts        ← input coercion helpers
│   │   ├── tier1/
│   │   │   ├── server.ts        ← thin MCP stdio wrapper for Basic tools
│   │   │   └── registry.ts      ← tool definitions (name, description, inputSchema)
│   │   ├── tier2/
│   │   │   ├── server.ts        ← thin MCP stdio wrapper for Design tools
│   │   │   └── registry.ts
│   │   └── tier3/
│   │       ├── server.ts        ← thin MCP stdio wrapper for Export tools
│   │       └── registry.ts
│   ├── renderer/
│   │   ├── renderer.ts          ← renderDesign() / renderPage() → SVGSVGElement
│   │   ├── layer-renderers.ts   ← per-type renderers (rect, text, image, icon, …)
│   │   ├── fill-renderer.ts     ← solid, linear, radial, conic, noise gradient fills
│   │   ├── effects-renderer.ts  ← drop shadow (with spread), blur, blend mode
│   │   ├── svg-utils.ts         ← createSVGElement, getOrCreateDefs, uniqueDefId
│   │   ├── lucide-icons.ts      ← 80+ Lucide icon SVG paths
│   │   └── qr/                  ← QR code encoder (no external deps)
│   ├── schema/
│   │   ├── types.ts             ← all TypeScript interfaces (Layer, DesignSpec, ThemeSpec, …)
│   │   ├── parser.ts            ← YAML → DesignSpec
│   │   ├── validator.ts         ← DesignSpec validation → ValidationError[]
│   │   └── template.ts          ← template export / slot injection
│   ├── engine/
│   │   ├── token-resolver.ts    ← $token → theme value
│   │   ├── shorthand-expander.ts← pos shorthand → x/y/width/height
│   │   └── component-resolver.ts← component ref → inlined layers
│   ├── editor/                  ← browser visual editor (canvas, state, interactions)
│   ├── ui/                      ← panels, toolbar, command palette
│   ├── export/                  ← PNG / SVG / PDF / HTML exporters
│   ├── themes/                  ← built-in theme definitions (dark-tech, light-clean)
│   └── utils/                   ← debug logger, ruler units
├── tests/
│   ├── e2e/                     ← Playwright end-to-end tests
│   ├── visual/                  ← Playwright visual regression snapshots
│   └── fixtures/                ← sample .design.yaml files
└── src/**/*.test.ts             ← 1,360 Vitest unit + integration tests
```

---

## Development

### Local Testing

```bash
# Install dependencies
npm ci  # or: bun install

# Run all unit + integration tests (1,360 tests)
npm run test:unit

# Run with coverage report
npm run test:coverage

# Type check (zero errors policy)
npm run typecheck

# Lint (zero warnings policy)
npm run lint

# E2E tests (build first)
npm run build && npm run test:e2e
```

### Run a single MCP tier locally

```bash
# Tier 1 — Basic tools only (10 tools, ideal for small models)
FOLIO_MCP_TIER=1 bun run src/mcp/index.ts

# Tier 2 — Basic + Design tools (19 tools)
FOLIO_MCP_TIER=2 bun run src/mcp/index.ts

# Tier 3 — All tools (25 tools)
FOLIO_MCP_TIER=3 bun run src/mcp/index.ts
```

### Start the visual editor

```bash
npm run dev   # → http://localhost:5173
```

---

## License

MIT
