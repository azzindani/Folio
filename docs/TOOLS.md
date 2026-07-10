# TOOLS.md — Folio MCP Tool Reference

> Complete reference for all **21 MCP tools**, grouped by tier. For the protocol,
> workflows, and shorthand see [MCP.md](MCP.md). Source of truth: `src/mcp/tier{1,2,3}/registry.ts`
> (schemas), `src/mcp/dispatch.ts` (op routing) and `src/mcp/handlers.ts` (`ALL_HANDLERS`).

**Consolidated surface.** The tool count was trimmed 50 → 21 so models stop
fixating on a handful and the long tail stays discoverable. The hot core-loop
tools stay 1:1; the long tail is folded into **multiplexed tools** that take an
`op` discriminator. No capability was removed — every former tool maps to one
`op` (engine functions + their tests are unchanged; see `dispatch.ts`).

**Conventions used below**
- **Req** = required arguments. **Opt** = notable optional arguments. Multiplexed
  tools always require `op`; per-op required args are noted inline.
- `project_path` accepts a **bare name** (`"launch"`) — the engine places it under
  `FOLIO_PROJECTS_DIR`. Most tools accept a `project_path` alongside a relative
  `design_path` so you needn't pass absolute paths. **Never** build `/home/...` paths.
- Write tools snapshot to `.mcp_versions/` before touching disk and return a
  `next_action` baton (call it next). Many return a tokenized `open_url`.

| Tier | Tools | Count |
|---|---|---|
| 1 Foundation | get_engine_guide, enrich_brief, create_project, **manage_design**, **themes**, **tasks** | 6 |
| 2 Compose | create_design, add_layers, **edit_layer**, append_page, patch_design, seal_design, extract_reference | 7 |
| 3 Output + Advanced | render_preview, diagnose_design, export_design, open_in_editor, **templates**, **report**, **presentation**, **animation** | 8 |

**Multiplexed tools (bold) — `op` map**

| Tool | ops → former tool |
|---|---|
| `manage_design` | list→list_designs · browse→browse_library · inspect→inspect_design · rename→rename_design · duplicate→duplicate_design · move→move_design · delete→delete_design · resume→resume_design · gallery→export_library_gallery |
| `themes` | list→list_themes · apply→apply_theme |
| `tasks` | list→list_tasks · create→create_task · resume→resume_task |
| `edit_layer` | add→add_layer · update→update_layer · remove→remove_layer · align→align_layers |
| `templates` | list→list_templates · slots→list_template_slots · inject→inject_template · export→export_template · save_component→save_as_component · batch→batch_create |
| `report` | generate→generate_report · bind_data→bind_data · validate→validate_report · export→export_report · formula→set_formula_context · debug→debug_formula |
| `presentation` | create→create_presentation · export→export_presentation · remote→setup_remote_presenter · collab→setup_collab |
| `animation` | timeline→inspect_timeline · keyframe→add_keyframe · export→export_animation |

---

## TIER 1 — FOUNDATION (6)

Guidance, project setup, design/library management, theming, multi-page tasks.

### `get_engine_guide`
Load an engine guide section (default `quick_ref`, ~200 tokens). Sections: quick_ref, shorthand, layers, workflow, reference, craft, anti_slop, color, type, ux_laws, a11y.

### `enrich_brief`
**START HERE for a short/vague prompt.** Turns a one-line idea into a rich content plan (preset + block/field outline; for a carousel, a per-page arc with one shared palette). Returns research queries for factual topics. → then create_design / `tasks {op:create}` + add_layers / append_page.
- **Req:** `prompt`. **Opt:** `type`, `variant` (only for explicit N-options).

### `create_project`
Create a project (dir structure, default theme, project.yaml).
- **Req:** `name`. **Opt:** `path` (bare name), `theme` (default editorial-cream), `canvas`.

### `manage_design`  ·  *op-multiplexed*
Find, inspect and manage designs + the whole library. **Req:** `op`.
- `list` (req project_path) — designs in one project.
- `browse` — the whole library across projects; filter `search`/`type`/`project`, `sort`, `limit`, `include_links`. Read-only.
- `inspect` (req design_path; `page_id`) — layer IDs/types/z-order/positions. Read-only.
- `rename` (req design_path, new_name) — display name only; file path unchanged.
- `duplicate` (req design_path, new_name) — copy with a new UUID.
- `move` (req design_path, target_project) — move the file to another project.
- `delete` (req design_path) — move to the project `.trash/` (recoverable).
- `resume` (req design_path) — read carousel generation state.
- `gallery` — build `library.html` (thumbnails + search); `output_path`, `max_thumbnails`, `search`, `type`.

### `themes`  ·  *op-multiplexed*
**Req:** `op`, `project_path`.
- `list` — themes in project.yaml + available builtins.
- `apply` (req theme_id) — set the project default theme (lazily seeds a builtin). Does **not** recolor a design — use `patch_design {path:"recolor"}` for that.

### `tasks`  ·  *op-multiplexed*
Multi-page carousel/deck planning. **Req:** `op`.
- `create` (req project_path, task_name, brief, pages:[{label,hints}]) — plan + scaffold; returns the first append_page baton.
- `list` (req project_path) — task files + progress.
- `resume` (req task_path) — exact next tool call after a context reset.

---

## TIER 2 — COMPOSE (7)

Design lifecycle + layer composition/editing + reference matching.

### `create_design`
Create a design + clickable editor `open_url`. type=poster → next is add_layers; type=carousel → next is append_page.
- **Req:** `project_path`, `name`. **Opt:** `type`, `width`, `height`, `theme_ref`.

### `add_layers`
Compose a poster (or one carousel page) in one call via `layers_shorthand`. **Prefer a preset** (event / feature_grid / sections / editorial / versus / timeline / pricing / flow) over hand-placing. The tool description carries the full design guidance.
- **Req:** `design_path`. **Opt:** `page_id`, `layers`, `layers_shorthand`, `task_path`.

### `edit_layer`  ·  *op-multiplexed*
Single-layer edits (use add_layers for bulk). **Req:** `op`, `design_path`. Pass `page_id` to scope to one carousel page.
- `add` (req layer) — add one layer.
- `update` (req layer_id, props) — merge props.
- `remove` (req layer_id).
- `align` (req layer_ids, operation = left|right|top|bottom|center_h|center_v|distribute_h|distribute_v|snap_grid; `grid`) — the fix for diagnose_design misalignment.

### `append_page`
Add ONE page to a carousel (raw `layers_shorthand` or `template_ref`+`slots`). Repeat until `next_action.remaining==0`, then seal_design. Keep ONE palette + heading font across pages. An existing `page_id` + `replace:true` overwrites that page IN PLACE (order + other pages untouched) — the way to fix one deck page; without `replace` it renames to `<id>-2`.
- **Req:** `design_path`. **Opt:** `page_id`, `label`, `template_ref`, `slots`, `layers`, `layers_shorthand`, `task_path`, `replace`.

### `patch_design`
Edit a sealed design via dot-path selectors (e.g. `layers[3].style.color`); `dry_run` first. Recolor in one selector with `{path:"recolor", value:{"#OLD":"#NEW"}}`.
- **Req:** `design_path`, `selectors`. **Opt:** `dry_run`.

### `seal_design`
Finalize a design (poster: after add_layers; carousel: after the last append_page). → next is export_design. Edit a sealed design via patch_design / edit_layer.
- **Req:** `design_path`.

### `extract_reference`
Turn a reference (Canva export/screenshot/SVG) into a role-mapped palette + recommended canvas + composition brief. Pass observed `colors:[…]` and/or a `data:`/local `image`.
- **Opt:** `colors`, `image`, `project_path`, `name`.

---

## TIER 3 — OUTPUT + ADVANCED (8)

Inspect/preview, export, editor link, and the four advanced subsystems folded one-each into a multiplexed tool.

### `render_preview`
Render to a PNG returned INLINE so you can SEE the design (no file). Pair with diagnose_design.
- **Req:** `design_path`. **Opt:** `page_id`, `scale`.

### `diagnose_design`
Troubleshooter — off-canvas, collisions, misalignment, tiny/low-contrast text, missing background, weak hierarchy. Run before seal_design.
- **Req:** `design_path`. **Opt:** `page_id`.

### `export_design`
Export to SVG, PNG, PDF (true vector, selectable text), HTML or PPTX. A carousel exports one file per page. For an interactive report use `report {op:export}`; for a presentation/video use `presentation {op:export}` / `animation {op:export}`.
- **Req:** `design_path`, `format`. **Opt:** `output_path`, `scale`.

### `open_in_editor`
Tokenized editor URL (live-refreshes). create_design/append_page/seal_design/export_design already return this as `open_url`.
- **Opt:** `design_path`, `editor_url`, `page`.

### `templates`  ·  *op-multiplexed*
Built-in template catalog (432 templates) + reusable components. **Req:** `op`.
- `list` — browse the catalog; `search`/`tag`/`limit`. Feed a returned id to `slots`/`inject`.
- `slots` (req template_path = path OR built-in id) — list injectable slots.
- `inject` (req template_path, slots) — fill slots → a new .design.yaml.
- `export` (req design_path) — turn a design into a `.template.yaml` skeleton.
- `save_component` (req design_path, layer_ids, component_name, project_path) — extract a `.component.yaml`.
- `batch` (req project_path, template_id, slots_array) — N designs from one template. `template_id` accepts a **built-in catalog id** (same as `inject`), a project `.template.yaml` id, or a design name to clone.

### `report`  ·  *op-multiplexed*
Interactive data-report subsystem (type:report). **Req:** `op`.
- `generate` (req project_path, name, pages) — scaffold; `layout:"flow"` = responsive 12-col dashboard (`accent`, `font_heading`, `font_body`).
- `bind_data` (req design_path, datasets:[{id,rows[]}]) — attach datasets for `$data.*`/`$agg.*`.
- `validate` (req design_path) — lint chart/table/filter cross-refs before export.
- `export` (req design_path) — self-contained interactive HTML; returns `view_url` (the deliverable) + `edit_url`.
- `formula` (req design_path) — store state/data context for `=expr` bindings.
- `debug` (req formula) — evaluate one `=formula` against a context.

### `presentation`  ·  *op-multiplexed*
Slide presentations + live presenting/collab. **Req:** `op`.
- `create` (req project_path, name, pages) — scaffold a 1920×1080 deck; `transition`, `auto_advance`, `theme`.
- `export` (req design_path) — self-contained HTML presenter (transitions, keyboard nav).
- `remote` (`port`, `design_path`) — remote-clicker client JS + curl commands.
- `collab` (req design_path; `port`) — SSE file-watch server for multi-user sync.

### `animation`  ·  *op-multiplexed*
Animation timeline + motion export. **Req:** `op`, `design_path`.
- `timeline` — keyframe tracks as an ASCII timeline (`page_id` to filter).
- `keyframe` (req layer_id, keyframe:{t,x?,y?,opacity?,scale?,rotation?}) — add/replace a keyframe.
- `export` (req type = gif|mp4|webm; `fps`, `duration`) — render to GIF/MP4/WebM (Puppeteer + ffmpeg).

---

See [MCP.md](MCP.md) for transport/auth/workflows and [REPORT_ENGINE.md](REPORT_ENGINE.md) for interactive reports.
