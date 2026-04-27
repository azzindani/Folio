# Folio Design Engine – Overview

**Folio** is a self-hosted, local-first graphic design engine that stores every design as a plain YAML file and exposes a 25-tool MCP server enabling local LLMs to generate, edit, and export designs without cloud dependencies or API keys.

## Core Capabilities

The system combines a browser-based visual editor with an LLM-facing MCP server split into three context-tiered servers:

- **Visual Editor** (13 layer types): SVG-native renderer, Monaco YAML editor with bidirectional sync, layer panel, properties panel, command palette, align toolbar, page strip for carousels, and Problems panel with inline validation
- **Basic MCP** (10 tools): Project management, design navigation, theme control, task planning, carousel state recovery — optimized for 32K–128K context local models
- **Design MCP** (9 tools): Full design lifecycle — create, inspect, add layers, append carousel pages, surgical patch with dry-run validation, and seal for export
- **Export MCP** (6 tools): Live SVG export via server-side jsdom renderer, batch generation from templates, component extraction, template slot injection

## Key Features

The platform is built around **design-as-YAML** — every design is a `.design.yaml` file that is human-readable, diffable, and version-controllable. A shorthand layer syntax (`pos:[x,y,w,h]`, `fill:"#hex"`, `icon:"star"`) reduces LLM token cost by ~80% versus verbose YAML. All 25 MCP tools return a structured `progress[]` array, a `context` field for session recovery, and a `handover` object with the next three suggested tool calls and pre-filled parameters — enabling reliable agentic chains on models with limited context windows.

The **output budget system** (`FOLIO_OUTPUT_BUDGET=1000`, default) caps every tool response at 1,000 tokens and trims least-critical fields first when over budget — making the server usable on Gemma 4B at 128K context, Qwen 9B at 64K, or Qwen 2B at 32K. Every write operation creates an atomic snapshot before touching disk (`~/.mcp_versions/*.bak`) and appends a JSONL audit entry to `~/.folio/ops.log`. A `dry_run` mode on `patch_design` validates all selectors before any file write.

Renderer capabilities include linear, radial, conic, and multi-stop gradient fills; drop shadows with spread (feMorphology decomposition); word-wrapped text with tspan line breaking, vertical alignment, and text decoration; flip/mirror transforms; SVG filter effects; auto-layout frames with wrap, gap, padding, align_items, and justify_content. The editor adds rubber-band multi-select, 8-point resize handles, rotation with 15° snap, smart distance annotations, and ruler guides.

## Installation & Requirements

Installation targets local LLM setups on Linux, macOS, and Windows. Requirements are Node.js 20 LTS (or Bun 1.0+), Git, and npm. No API keys or cloud accounts are required at any point.

```bash
# Clone and start the visual editor
git clone https://github.com/azzindani/Folio.git
cd Folio && npm ci && npm run dev
# → http://localhost:5173

# Run the MCP server (all 3 tiers, Node)
npm run mcp

# Run with Bun (~50ms cold start, recommended for local LLMs)
bun run src/mcp/index.ts
```

Add to your MCP client's `mcp.json`:

```json
{
  "mcpServers": {
    "folio": {
      "command": "bun",
      "args": ["run", "/path/to/Folio/src/mcp/index.ts"],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" }
    }
  }
}
```

For small models, set `FOLIO_MCP_TIER=1` to expose only the 10 Basic tools. Set `FOLIO_MCP_TIER=2` for Basic + Design (19 tools). Omit for all 25 tools. The project includes 1,360 automated tests across unit, integration, and end-to-end suites (Vitest + Playwright).
