# TOOLS.md — Folio MCP Tool Reference

> Complete reference for all **49 MCP tools**, grouped by tier. For the protocol,
> workflows, and shorthand see [MCP.md](MCP.md). Source of truth: `src/mcp/tier{1,2,3}/registry.ts`
> (schemas) and `src/mcp/handlers.ts` (`ALL_HANDLERS`).

**Conventions used below**
- **Req** = required arguments. **Opt** = notable optional arguments.
- `project_path` accepts a **bare name** (`"launch"`) — the engine places it under
  `FOLIO_PROJECTS_DIR`. Most tools accept a `project_path` alongside a relative
  `design_path` so you needn't pass absolute paths. **Never** build `/home/...` paths.
- Write tools snapshot to `.mcp_versions/` before touching disk and return a
  `next_action` baton (call it next). Many return a tokenized `open_url`.

| Tier | Tools | Count |
|---|---|---|
| 1 Basic | get_engine_guide, enrich_brief, create_project, list_designs, list_tasks, list_themes, apply_theme, duplicate_design, browse_library, rename_design, delete_design, move_design, create_task, resume_task, resume_design | 15 |
| 2 Design | create_design, inspect_design, add_layers, add_layer, append_page, update_layer, remove_layer, patch_design, seal_design, extract_reference | 10 |
| 3 Export | open_in_editor, export_design, export_template, list_template_slots, inject_template, batch_create, save_as_component, generate_report, bind_data, export_report, validate_report, create_presentation, export_presentation, set_formula_context, debug_formula, inspect_timeline, add_keyframe, export_animation, setup_remote_presenter, setup_collab, diagnose_design, render_preview, align_layers, export_library_gallery | 24 |

---

## TIER 1 — BASIC (15)

Project management, navigation, tasks, library, theming. Read-mostly; safe for any model.

### `get_engine_guide`
Load the engine reference guide by section (~200 tokens each). **Start every session here.**
- **Opt:** `section` ∈ `quick_ref` (default) · `shorthand` · `layers` · `workflow` · `reference`.

### `enrich_brief`
**Start here when the prompt is short/vague.** Turns a one-liner into a rich content
plan: best preset + a full block/field outline (single design), or `output_type:"carousel"`
+ per-page plan with one shared `bg_style`/palette (deck). For factual topics returns
`needs_research` + `research_queries` to run first so figures are real.
- **Req:** `prompt`. **Opt:** `type` (preset hint), `variant` (number — distinct art-direction per option for "give me N options").

### `create_project`
Scaffold a project dir (`designs/ assets/ themes/ exports/` + `project.yaml`).
- **Req:** `name`. **Opt:** `path` (defaults to name), `theme` (default `editorial-cream`), `canvas` (default `1080x1080`).

### `list_designs`
List `.design.yaml` files in one project (status, page count). Max 40 rows.
- **Req:** `project_path`.

### `list_tasks`
List `.task.yaml` files with progress (pages done / total).
- **Req:** `project_path`.

### `list_themes`
List themes registered in `project.yaml`.
- **Req:** `project_path`.

### `apply_theme`
Set the active theme (writes `project.yaml` `default_theme`).
- **Req:** `project_path`, `theme_id`.

### `duplicate_design`
Copy a design with a new name + fresh UUID; registers it.
- **Req:** `design_path`, `new_name`. **Opt:** `project_path`.

### `browse_library`
Cross-project catalog of the **whole** library (every project + design, newest first).
File-manager view; read-only.
- **Opt:** `search`, `type`, `project`, `sort` (`modified`|`name`|`designs`), `limit`, `designs_per_project`, `include_links`.

### `rename_design`
Change a design's display `meta.name` (the file path is intentionally left unchanged so editor links keep working).
- **Req:** `design_path`, `new_name`. **Opt:** `project_path`.

### `delete_design`
Move a design to the project's `.trash/` (recoverable — never a hard delete).
- **Req:** `design_path`. **Opt:** `project_path`.

### `move_design`
Move a design's file into another (existing) project; returns new path + editor link.
- **Req:** `design_path`, `target_project`. **Opt:** `project_path`.

### `create_task`
Plan a multi-page carousel and scaffold the first design; returns the first `append_page` baton.
- **Req:** `project_path`, `task_name`, `brief`, `pages` (`[{label, hints?, id?}]`). **Opt:** `theme`, `width`, `height`.

### `resume_task`
Read task state → exact next tool + params. **Use after any context reset.**
- **Req:** `task_path`.

### `resume_design`
Read carousel generation state to continue appending pages.
- **Req:** `design_path`. **Opt:** `project_path`.

---

## TIER 2 — DESIGN (10)

The full design lifecycle. All write tools snapshot before writing.

### `create_design`
Create a new `.design.yaml`; returns a clickable `open_url`.
`poster` → `next_action: add_layers`. `carousel` → `next_action: append_page`.
- **Req:** `project_path`, `name`. **Opt:** `type` (`poster`|`carousel`), `width` (1080), `height` (1080), `theme_ref`.

### `inspect_design`
Cheap read of structure (layer IDs/types/z/positions, page list). Use to find a `layer_id` or verify before sealing. Read-only.
- **Req:** `design_path`. **Opt:** `page_id`, `project_path`.

### `add_layers`
**The main composition tool.** Add a poster (or one carousel page) in one call via `layers_shorthand`. Prefer a **preset** (event / feature_grid / sections / editorial / list / stat / split / decor) over hand-placing — the engine measures + positions so nothing collides. Returns `notes[]` (render issues to fix) + `open_url`.
- **Req:** `design_path`. **Opt:** `layers_shorthand` (compact), `layers` (verbose), `page_id` (carousel), `task_path` (handover baton), `project_path`.

### `add_layer`
Add ONE layer (prefer `add_layers` for several). Sized layers need width+height.
- **Req:** `design_path`, `layer`. **Opt:** `page_id`, `project_path`.

### `append_page`
Add ONE carousel page (raw `layers_shorthand` or `template_ref`+`slots`). Repeat until `next_action.remaining==0`, then seal. **Keep one palette + heading font across all pages** (a carousel is one design, not N posters). Returns `open_url`.
- **Req:** `design_path`. **Opt:** `page_id`, `label`, `layers_shorthand`, `layers`, `template_ref`, `slots`, `task_path`, `project_path`.

### `update_layer`
Merge props into a layer by ID. **Carousel:** pass `page_id` — IDs repeat across pages, so without it every page is patched.
- **Req:** `design_path`, `layer_id`, `props`. **Opt:** `page_id`, `project_path`.

### `remove_layer`
Remove a layer by ID. **Carousel:** pass `page_id` (without it the ID is removed from every page).
- **Req:** `design_path`, `layer_id`. **Opt:** `page_id`, `project_path`.

### `patch_design`
Edit a **sealed** design via dot-path selectors (`layers[3].style.color`). Run `dry_run:true` first to validate, then apply, then re-seal.
- **Req:** `design_path`, `selectors` (`[{path, value}]`). **Opt:** `dry_run` (default false), `project_path`.

### `seal_design`
Finalize (poster: after add_layers; carousel: after the last append_page). Validates, freezes `_mode: complete`, returns `open_url`. `next_action: export_design`.
- **Req:** `design_path`. **Opt:** `project_path`.

### `extract_reference`
Turn a reference image (Canva export / screenshot / SVG) into a deterministic palette + recommended canvas + composition brief. **Call first** when matching a reference.
- **Opt:** `colors` (`[hex…]` — the observed colors; most reliable), `image` (data: URL or local path — exact dims; https not fetched), `project_path`, `name`.

---

## TIER 3 — EXPORT (24)

Export, templates, components, reports, presentations, animation, formula, collab, QA.

### Editor & export

#### `open_in_editor`
Return a tokenized editor URL (live-refreshes as later tools edit). Note: create/append/seal/export already return this as `open_url` — call this only to re-open / focus a page / open the editor home.
- **Opt:** `design_path` (omit = editor home), `project_path`, `editor_url` (override base), `page` (1-based).

#### `export_design`
Export to **SVG / PNG / HTML** (real files; a carousel → one file per page, `output_paths` lists them). `pdf` stages an HTML for Puppeteer and returns `success:false` with the path.
- **Req:** `design_path`, `format` (`svg`|`html`|`pdf`|`png`). **Opt:** `output_path`, `scale` (1–3, default 2), `project_path`.

#### `export_library_gallery`
Build a self-contained `library.html` file-manager for the whole library (thumbnail cards + live search + editor click-through). Re-renders only changed designs.
- **Opt:** `output_path` (default `<projects>/library.html`), `max_thumbnails` (default 120), `search`, `type`.

### Templates & components

#### `export_template`
Export a sealed design as a `.template.yaml` skeleton with named `{{slot}}` placeholders.
- **Req:** `design_path`. **Opt:** `output_path`, `project_path`.

#### `list_template_slots`
List injectable slots in a template (paths, types, hints).
- **Req:** `template_path`.

#### `inject_template`
Fill template slots → a new `.design.yaml`.
- **Req:** `template_path`, `slots` (slot_id → value map). **Opt:** `output_path`.

#### `batch_create`
Generate N designs from one template using an array of slot objects.
- **Req:** `project_path`, `template_id`, `slots_array` (`[{…}]`).

#### `save_as_component`
Extract layers into a `.component.yaml` and replace them with a component instance.
- **Req:** `design_path`, `layer_ids`, `component_name`, `project_path`.

### Interactive reports → see [REPORT_ENGINE.md](REPORT_ENGINE.md)

#### `generate_report`
Scaffold a report design. Use `layout:"flow"` for a responsive 12-col dashboard (span-based, no fixed canvas).
- **Req:** `project_path`, `name`, `pages` (`[{id?, label}]`). **Opt:** `layout` (`paged`|`scroll`|`tabs`|`sidebar`|`flow`), `nav_type` (`sidebar`|`topbar`|`tabs`|`dots`), `data_sources`, `max_width`, `accent`, `font_heading`, `font_body`, `width`, `height`.

#### `bind_data`
Attach/update inline datasets (for `$data.*` / `$agg.*` and chart/table `data_ref`).
- **Req:** `design_path`, `datasets` (`[{id, rows[]}]`). **Opt:** `project_path`.

#### `validate_report`
Lint cross-references before export (every chart/table/filter `data_ref`+field resolves; buttons open existing modals; transforms group by present fields). Returns `{ok, errors, warnings, diagnostics[]}`.
- **Req:** `design_path`. **Opt:** `project_path`.

#### `export_report`
Assemble → self-contained interactive HTML. Returns **`view_url`** (the final report — give the user this) + `edit_url`.
- **Req:** `design_path`. **Opt:** `output_path`, `theme` (`light`|`dark`, default dark), `project_path`.

### Presentations

#### `create_presentation`
Scaffold a 1920×1080 presentation with slides + a transition.
- **Req:** `project_path`, `name`, `pages` (`[{id?, label, notes?}]`). **Opt:** `transition` (17 types: none/fade/slide-*/zoom-*/flip-*/cube-*/reveal/wipe-*/dissolve/morph), `auto_advance` (ms), `width` (1920), `height` (1080), `theme` (`dark`|`light`).

#### `export_presentation`
Assemble a presentation/carousel/motion design → self-contained HTML presenter (transitions, keyboard/touch nav, teleprompter, audio).
- **Req:** `design_path`. **Opt:** `output_path`, `theme`, `auto_advance` (override), `project_path`.

### Formula binding → see [DESIGN.md](DESIGN.md)

#### `set_formula_context`
Persist `state`/`data` context for `=expression` bindings (read by export tools).
- **Req:** `design_path`. **Opt:** `state`, `data`, `project_path`.

#### `debug_formula`
Evaluate a `=expression` against a context; returns the result + type info.
- **Req:** `formula` (starts with `=`). **Opt:** `state`, `data`, `design_path` (load `.formula.json`), `project_path`.

### Animation

#### `inspect_timeline`
Show a design's animation keyframe tracks as an ASCII timeline.
- **Req:** `design_path`. **Opt:** `page_id`, `project_path`.

#### `add_keyframe`
Add/replace a keyframe on a layer's timeline.
- **Req:** `design_path`, `layer_id`, `keyframe` (`{t:ms, x?, y?, opacity?, scale?, rotation?}`). **Opt:** `project_path`.

#### `export_animation`
Export a presentation as GIF / MP4 / WebM (Puppeteer frame capture + ffmpeg when available).
- **Req:** `design_path`, `type` (`gif`|`mp4`|`webm`). **Opt:** `output_path`, `fps`, `duration` (ms), `project_path`.

### Presenter & collaboration → see [INTEGRATIONS.md](INTEGRATIONS.md)

#### `setup_remote_presenter`
Generate a remote-clicker setup: SSE server + client JS snippet + curl commands for HTTP-controlled slide nav.
- **Opt:** `port` (default 3737), `design_path`, `project_path`.

#### `setup_collab`
Generate a collaborative-editing setup: SSE file-watch server for multi-user sync (`/patch` + `/events`).
- **Req:** `design_path`. **Opt:** `port` (default 3738), `project_path`.

### Quality assurance (use before sealing)

#### `diagnose_design`
Built-in troubleshooter for what the model can't see: off-canvas layers, collisions, near-miss misalignment, tiny/low-contrast/invisible text, missing background, weak hierarchy, accent sprawl, crowded margins — each with a fix. **Run after composing; fix every error; re-run to zero.**
- **Req:** `design_path`. **Opt:** `page_id`, `project_path`.

#### `render_preview`
Render to a PNG and return it **inline as an image** (no file). See what you produced. Charts/KPIs that need a browser still only appear in the editor; everything else rasterizes.
- **Req:** `design_path`. **Opt:** `page_id`, `scale` (0.5–2, default 1), `project_path`.

#### `align_layers`
Auto-align / distribute / snap-to-grid a set of layers — the fix for `diagnose_design` misalignment findings.
- **Req:** `design_path`, `layer_ids`, `operation` (`left`|`right`|`top`|`bottom`|`center_h`|`center_v`|`distribute_h`|`distribute_v`|`snap_grid`). **Opt:** `grid` (px, default 8), `page_id`, `project_path`.

---

## EXAMPLE CALLS

### Poster, end to end

```jsonc
get_engine_guide()                                  // → quick_ref rules + recipes
create_project({ name: "ai-poster" })
create_design({ project_path: "ai-poster", name: "remote-work", type: "poster",
                width: 1080, height: 1350, theme_ref: "editorial-cream" })
add_layers({ design_path: "<from create_design>", layers_shorthand: [
  { id:"bg",   type:"rect", z:0,  pos:[0,0,1080,1350], fill:"#FAF5EC" },
  { id:"kick", type:"text", z:10, pos:[96,110,820,30], text:"FIELD NOTES — NO. 01",
               size:20, weight:600, color:"#6E5F4A", font:"IBM Plex Mono", track:1.5 },
  { id:"head", type:"text", z:10, pos:[96,250,880,470], text:"The quiet office is winning.",
               size:108, weight:800, color:"#2A2218", font:"Playfair Display", lh:1.02 } ]})
diagnose_design({ design_path: "…" })               // fix every error, re-run to zero
render_preview({ design_path: "…" })                // SEE it
seal_design({ design_path: "…" })                   // → open_url
export_design({ design_path: "…", format: "svg" })
```

### One-layer preset (the engine lays it out)

```jsonc
add_layers({ design_path:"…", layers_shorthand:[
  { type:"sections", pos:[0,0,1080,1920], bg:"#FAF5EC", accent:"#B8543C",
    kicker:"Report", title:"The State of Remote Work 2026", subtitle:"…",
    footer:"Source: …", blocks:[
      { kind:"intro", text:"…" },
      { kind:"stats", items:[{value:"58%",label:"hybrid"},{value:"27%",label:"remote"}] },
      { kind:"heading", text:"The Hybrid Default" }, { kind:"text", text:"…" },
      { kind:"callout", label:"Takeaway", text:"…" } ] } ]})
```

### Interactive report

```jsonc
generate_report({ project_path:"q3", name:"sales", layout:"flow", accent:"#f5c842",
  font_heading:"Playfair Display", font_body:"Inter",
  pages:[{id:"overview",label:"Overview"}],
  data_sources:[{id:"rev", type:"inline", rows:[{month:"Jan",rev:120}, …]}] })
add_layers({ design_path:"…", page_id:"overview", layers:[
  { type:"kpi_card", span:3, label:"Revenue", value:1200000, format:"currency", delta:"+12%" },
  { type:"interactive_chart", span:8, chart_type:"line", data_ref:"rev", x_field:"month", y_field:"rev", title:"Monthly revenue" },
  { type:"interactive_table", span:12, data_ref:"rev", filterable:true, exportable:true } ]})
validate_report({ design_path:"…" })                // fix errors
export_report({ design_path:"…", theme:"light" })   // → view_url (the deliverable)
```

See [MCP.md](MCP.md) for the full workflow catalog and the shorthand/preset grammar.
