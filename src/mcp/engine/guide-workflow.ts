// Folio MCP — the workflow half of the engine guide.
//
// Split out of guide.ts to keep both files inside the 700-line budget. This is
// the section that grows every time a tool learns to close a loop by itself —
// next_action, spec round-trip, lineage, restore, self-heal — so it is the half
// that keeps moving.

export const WORKFLOW_GUIDE = `# Workflow Details

next_action protocol:
  Every write tool returns next_action:{tool,params,remaining,hint}
  ALWAYS call next_action.tool as your very next tool call.
  remaining==0 → sequence complete (usually seal_design or export_design)
  remaining>0  → more pages/steps needed

handover protocol:
  Every response includes handover:{workflow_step,workflow_next,suggested_next[],carry_forward}
  workflow_step: PROJECT→DESIGN→COMPOSE→SEAL→EXPORT
  suggested_next: 3 concrete next tools with pre-filled params — pick the most appropriate
  carry_forward: params to re-use in your next call

Context reset recovery:
  1. Call tasks(op:resume, task_path) → get exact next tool + params
  2. Or call manage_design(op:resume, design_path) → check carousel progress
  3. Or call tasks(op:list, project_path) → find task_path if lost

Patch workflow (editing sealed designs):
  1. patch_design(design_path, selectors=[{path,value}], dry_run=true)  ← validate first
  2. patch_design(design_path, selectors=[{path,value}])                ← apply
  3. seal_design(design_path)

Spec round-trip (editing a PRESET — prefer this over the two above):
  A preset group is ~30 GENERATED layers, and the spec that produced them is
  stored on the group. Edit the intent, not the output:
  1. manage_design(op:"get_spec", design_path)         ← what the page is MADE OF
  2. edit_layer(op:"patch_spec", layer_id, changes)    ← merge + re-render in place
  3. render_preview → seal_design
  changes merges: an object merges KEY BY KEY (so {accent:"#0EA5E9"} leaves the
  other twelve fields alone), an ARRAY replaces wholesale (blocks is one ordered
  thing), and null DELETES a field (back to the engine default). dry_run:true
  returns the changed keys without writing.
  Reach for it whenever the ask is about CONTENT or LOOK — "three blocks not
  five", "warmer accent", "retitle it", "drop the footer", "make it a mega
  headline". Hand-editing the generated children instead works once and then
  DRIFTS: the next patch_spec regenerates from the spec and discards those
  edits (it warns you first). manage_design(op:"inspect") marks which groups
  carry a spec.
  Hand-placed layers have no spec and need none — they ARE their own source; use
  edit_layer(op:"update") / patch_design for those.

Lineage (what happened to this design, and can you trust the answer):
  manage_design(op:"lineage", design_path)    every change, oldest → newest
  Each record: the tool, a hash of its arguments, before/after content hashes,
  byte sizes, duration. Recorded at the ONE point every design write passes
  through, so no tool can forget to log — the reply states that scope every time
  rather than leaving you to assume it.
  CHAIN BREAKS are the useful part: a record whose "before" doesn't match the
  previous "after" proves the file changed outside the tool surface — someone
  edited it in the visual editor, restored a snapshot, or synced over it. The
  log is complete for tool writes either way; the chain tells you whether it is
  the WHOLE story. Check it before trusting a design you did not just build.

Restore (take a change BACK, instead of rebuilding by hand):
  manage_design(op:"restore", design_path)            list the restore points
  manage_design(op:"restore", design_path, to:7)      go back to that state
  Every mutating tool snapshots before it writes, so roughly the last 20 states
  are on disk. This reads one back. It is the twin of lineage: lineage says a
  change happened, restore takes it back — do not spend a rebuild on a heal, a
  tokens sweep or a resize that went the wrong way.
  Addressing is by CONTENT: a snapshot is used only when its bytes hash to what
  that change recorded as its result, so the reply can say the exact recorded
  state came back (verified:true). A state whose snapshot has been pruned FAILS
  and names the seqs that are still there — it never restores a neighbour and
  calls it success. lineage marks each record restorable so you know before you
  ask.
  The rollback APPENDS to the history as its own change and rewrites nothing, so
  restoring forward again works too — restore to 7, dislike it, restore to 9.
  dry_run:true reports what would be undone without writing.

Self-heal (close the loop yourself instead of hand-fixing findings):
  diagnose_design(design_path, heal:true)     diagnose → fix → re-diagnose → …
  It loops until clean or until a pass fixes nothing (progress is the stop
  condition, not a round count), then reports three separate things:
    fixed[]              what it repaired
    could_not_fix[]      what it is ALLOWED to fix but couldn't — almost always
                         too much content for the canvas, so CUT content
    for_you_to_judge[]   palette, hierarchy, density, copy — YOURS
  It repairs spatial correctness + legibility only: a preset whose content left
  the canvas is RE-LAID OUT from its stored spec at the size it actually has
  (not shoved inside, which would wreck the layout), stranded layers come back,
  sub-14px text is raised, a missing ground is filled, invisible text re-lit,
  positionless layers flowed. It never touches colour or composition — a loop
  that re-made those would converge every design on one look.
  THE VISUAL HALF IS YOURS: heal fixes what geometry can prove. Then
  render_preview and LOOK — "the eyebrow crowds the headline", "that column is
  doing nothing", "this reads flat" is judgement no measurement returns. The
  full loop is: compose → heal → render_preview → look → patch_spec → repeat.

Tokens + components (the system layer — reach for these before hand-placing):
  TOKENS — colour by ROLE, not by literal.
    manage_design(op:"tokens", design_path)                    read the palette
    manage_design(op:"tokens", design_path, set:{accent:"…"})  change it
  Read it and you get bg / accent / text / muted / card_fill / panel, and how
  many layers depend on each. Set one and the WHOLE design follows: every preset
  naming that role is patched at its SPEC and rebuilt, so the tints, rules and
  scrims DERIVED from that colour recompute. A hex find-and-replace cannot do
  that — it leaves the derived shades behind at their old values, which is why a
  recoloured design used to look subtly wrong. Layers with no spec can only have
  the old value swapped; the reply counts them so you know what was approximate.
  (themes(op:"apply") sets the PROJECT default and does not touch a design's
  colours. This is the op that restyles a design.)

  COMPONENTS — a named part with holes, reused across designs.
    templates(op:"components", project_path)                   what exists
    templates(op:"save_component", design_path, layer_ids, component_name)
    then place it: {type:"component", ref:"<id>", pos:[x,y,w,h], slots:{…}}
  save_component turns every text layer into a named {{slot}} with its current
  copy as the default, so one saved "stat card" gives ten instances with ten
  different numbers. Omitted slots fall back to the defaults. Reach for a
  component when the SAME part appears more than twice — a set of N cards, a
  repeated header, a KPI tile. auto_slots:false freezes the copy instead.

Customize twins (changing a DOCUMENT, not one preset):
  Every generator has one, so you restyle in place instead of regenerating —
  regenerating discards everything composed since.
    report(op:"customize", design_path, changes)        layout, nav, accent,
                                                        max_width, fonts
    presentation(op:"customize", design_path, changes)  theme, transition,
                                                        auto_advance, controls
    manage_design(op:"resize", design_path, width, height)   any design's shape
  Same merge rules as patch_spec (objects merge, arrays replace, null deletes),
  and all three take dry_run:true.
  RE-SHAPING is the one worth knowing: pass {width,height} (or use resize) and
  every preset carrying a spec is REBUILT for the new page box — a real
  re-layout at the new proportions, not a stretch — while hand-placed layers are
  uniformly scaled and centred. That is how a 1920×1080 deck becomes a 1080×1350
  carousel, or a square poster becomes portrait, without rebuilding it. Layers
  composed before spec round-trip shipped can only be scaled; the reply says so.

Interactive HTML reports (dashboards, EDA, financial decks):
  USE layout:"flow" — a responsive editorial document (12-col grid, NO fixed canvas).
  Layers are placed by a span field (1–12), NOT x/y/width/height — they reflow on any screen.
  1. report(op:generate, project_path, name, layout:"flow", accent:"#f5c842",
       font_heading:"Playfair Display", font_body:"Inter", max_width:1200,
       pages:[{id:"overview",label:"Overview"}], data_sources:[{id:"rev",type:"inline",rows:[…]}])
  2. report(op:bind_data, design_path, datasets:[{id, rows:[…]}])   ← add/replace datasets anytime
  3. add_layers(design_path, page_id, layers:[ …flow widgets, each with a span… ])
       hero/headings → {type:"rich_text", span:12, font_family:"Playfair Display", font_size:42, content:"**Title**", format:"markdown"}
       KPI row       → {type:"kpi_card", span:3, label, value, format:"currency"|"number"|"percent", delta, sparkline_data, sparkline_field}
       charts        → {type:"interactive_chart", span:6|8, height:340, chart_type:"line"|"bar"|"area"|"pie"|"donut", data_ref, x_field, y_field, title}
       data table    → {type:"interactive_table", span:12, data_ref, filterable:true, exportable:true, pagination:true, page_size:10,
                         columns:[{field,title,sortable:true,formatter:"currency"|"number"|"percent"|"badge"|"delta",align:"right"}]}
  4. report(op:validate, design_path) → {ok, errors, warnings, diagnostics[]} — LINT cross-refs
     (every chart/table data_ref + x/y field resolves to a real dataset, buttons open existing
     modals, transforms group by present fields). Run it after add_layers; fix errors before export.
  5. report(op:export, design_path, theme:"dark"|"light") → self-contained .report.html
     (also returns diagnostics; resolves transform datasets at export).
     ★ DELIVERABLE: report(op:export) returns view_url — a tokenized link that renders the
       FINAL interactive HTML directly in the browser. Give the user THAT, not the editor
       link. The editor canvas is an authoring view, not a faithful preview of the export;
       report(op:export).view_url is the real result. (edit_url is also returned for editing.)
  Defaults if span omitted: kpi=3, chart=6, table/rich_text=12. accent seeds chart colors + links.
  Tables sort/filter/paginate/CSV-export client-side; charts use Chart.js (CDN). All in one HTML file.
  DATA SOURCES (report(op:bind_data) datasets[] or report.data.sources): type:"inline" {rows:[…]} ·
  "json"/"csv" {path} · "query" {engine:"http", url, query?:"dot.path"} fetches JSON (sql/duckdb
  need a server connector) · "transform" {from:"<srcId>", group_by, agg:"sum|avg|min|max|count",
  value} = a derived group-by aggregation, chart-bindable as data_ref (x=group_by, y=value).

Interactive components (flow reports — all in add_layers, each takes span + the fields below):
  button       → {type:"button", span:3, label, variant:"solid"|"outline"|"ghost"|"link", action:"open_modal:<id>"}
                 action sugar: open_modal:<id> · close_modal · toggle:<key> · set:<key>=<val> · filter:<field>:<val>
                 · tab:<group>:<id> · accordion:<id> · scroll_to:<id> · download_csv:<tableId> · open_url:<url> · goto_page:<id>
  popup(modal) → {type:"popup", id:"<id>", modal:true, title, body:"markdown"  (OR layers:[…children])}  — hidden; opened by a button action open_modal:<id>
  tabs         → {type:"tabs", span:12, variant:"underline"|"pills", tabs:[{label, layers:[…children with span]}]}  — within-page tabbed panels
  accordion    → {type:"accordion", span:12, exclusive:true, items:[{title, body:"markdown" OR layers:[…], open:true}]}
  filter_bar   → {type:"filter_bar", span:12, field:"sector", multi:true, label, options:[…] OR options_from:"<data_ref>", style:"chips"|"dropdown"}
                 LINKED: selecting filters every interactive_table + interactive_chart on the page by that field, live.
  toggle       → {type:"toggle", span:4, state_key:"view", label, options:["A","B"]}  — segmented; writes to shared state
  callout      → {type:"callout", span:12, variant:"info"|"success"|"warning"|"danger", title, content:"markdown"}
  progress     → {type:"progress", span:4, label, value:72, max:100, style:"bar"|"radial", unit:"%"}
  tooltip      → {type:"tooltip", span:2, icon:"i", content:"markdown shown on hover"}
  These render in the editor canvas too (studio-editable). Containers (tabs/accordion/popup) hold child layers that each take their own span.
  Studio editing of flow layers: charts + tables render real previews on the canvas; drag a component body to REORDER it, drag side handles to set its span (1–12, snaps to the grid), drag the bottom handle to set an explicit row height. In the Properties panel, flow layers expose Span + Height (not x/y). Set an explicit height via the flow_h field (e.g. {type:"interactive_chart", span:8, flow_h:420, …}); otherwise height auto-estimates per type.

Token budget for local models:
  Gemma 4B  128K ctx → 5–8 layers/page, guide once per session
  Qwen 9B    64K ctx → 4–6 layers/page, load guide sections only
  Qwen 2B    32K ctx → 3–4 layers/page, shorthand section only
  Output cap: 1K tokens/turn — use layers_shorthand always`;
