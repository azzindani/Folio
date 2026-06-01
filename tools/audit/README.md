# Folio audit & verification toolkit

Playwright-driven scripts for visually auditing templates and verifying the
MCP editor-link / export pipeline against a running Folio instance (local dev
server or the deployed container at `folio.casava.space`).

> Generated output (`shots/`, `vision/`, `agent-*/`, `*.json`) is **not**
> committed — it is regenerated per run. Only these scripts + docs are tracked.

## Prerequisites
- A running editor (`npm run dev` / vite preview, or the deployed container).
- Playwright Chromium installed (`npx playwright install chromium`).
- For MCP/editor-link checks: a reachable MCP HTTP server + a valid token
  (mint via the `open_in_editor` / `create_design` MCP tools).

## Scripts

| Script | Purpose | Usage |
|---|---|---|
| `inventory.mjs` | Build a stratified inventory of the 432 builtin templates (by category/aspect) to drive sampled audits. | `node inventory.mjs` → `inventory.json` |
| `render.mjs` | Render templates → PNG via the running editor + Playwright. Includes the **font paint-settle** fix (heavy display fonts render invisible without it) and programmatic overflow/contrast checks. | `node render.mjs <list> [--workers N]` → `shots/` + `results.json` |
| `summarize.mjs` | Summarize a render `results.json`: counts, top failure modes, ranked worst offenders. | `node summarize.mjs results.json` |
| `split-warns.mjs` | Filter `results.json` + `inventory.json` to *actionable* warnings (drops font-race false positives). | `node split-warns.mjs` |
| `reclassify.mjs` | Re-score an existing `results.json` under different heuristic thresholds without re-rendering. | `node reclassify.mjs results.json` |
| `probe.mjs`–`probe4.mjs` | Ad-hoc single-template Playwright probes for diagnosing a specific render (font race, overflow, single-threaded verification). | `node probeN.mjs` |
| `open-link-check.mjs` | Open one MCP editor link in headless Chromium and confirm the design loads + renders (asserts expected text in the canvas SVG). | `node open-link-check.mjs "<editor_url>"` |
| `proof-suite.mjs` | Rigorous proof the editor loads the **actual file** (not the built-in sample): negative control (no `?file=`) + per-file unique-marker + standalone exported-HTML render. Screenshots each to `vision/`. | `node proof-suite.mjs <tokenA> <tokenB>` |

## Notes
- Use `--workers 1` for trusted/verification renders — heavy display fonts
  (Anton, Audiowide, Bebas, Playfair) can render invisibly under parallelism
  before the font-swap repaint settles. See `render.mjs` paint-settle logic.
- Editor links only auto-load designs under `FOLIO_PROJECTS_DIR`
  (`/home/folio/projects` in the deployed container); designs elsewhere open to
  an empty canvas. Generate under the projects dir for links that open with
  content.
