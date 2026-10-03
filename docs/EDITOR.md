# EDITOR.md — The Folio Visual Editor

> The browser-based visual + YAML editor. It operates on the same `.design.yaml`
> files the MCP server reads and writes — **no conversion step**. The file is the
> source of truth; the canvas is a live view. For the engine internals see
> [ARCHITECTURE.md](ARCHITECTURE.md); for how the LLM hands you a link see
> [INTEGRATIONS.md §6](INTEGRATIONS.md).

---

## 1. RUNNING IT

| Context | URL | How |
|---|---|---|
| Local dev (HMR) | `http://localhost:5173` | `npm run dev` (Vite) |
| Local Docker | `http://localhost:4173` | `docker compose up -d` |
| VPS behind Caddy | `https://your-domain/` | TLS profile + access-token gate (no Basic Auth) |

In Docker the editor is served by `src/editor/static-server.ts` (a Bun static server),
**not** `vite preview` — it serves the built `dist/` and exposes project files at
`/__project_files/*`. `npm run dev` is the only mode that uses Vite (for hot reload
while developing the editor itself).

---

## 2. OPENING A DESIGN

Three ways:

1. **From an MCP `open_url`** — `create_design` / `append_page` / `seal_design` /
   `export_design` (and `open_in_editor`) return a self-contained link:
   ```
   https://your-domain/?file=<design-path>&mcp_url=<mcp-base>&token=<jwt>
   ```
   Opening it loads the design and wires up live refresh in one click. The design must
   live under `FOLIO_PROJECTS_DIR` for the editor to serve it.
2. **File tree panel** — browse and open `.design.yaml` / `.template.yaml` /
   `.component.yaml` from within the editor.
3. **Local file** (dev / desktop Chrome) — the File System Access API opens any file;
   other browsers fall back to `<input type=file>` + download.

Drag-and-drop an image onto the canvas to add it as an image layer;
**Shift+drop** imports it as a locked, 40%-dimmed **reference underlay** for
tracing (and seeds the palette from it) — pairs with the `extract_reference`
MCP tool. Works on desktop, tablet, and phone widths.

### 2.0 On a phone

Everything you press lives at the bottom, in one **dock**
(`src/editor/mobile-dock.ts`): a top row with the **Visual | Payload | Preview**
view switch and Undo · Redo · Play · Export · More, over the place row — Layers ·
Props · Tools · Panels · Find. The current view is lit; switching view closes
whatever sheet was open over the old one. The top bar is a title (the design's
name), nothing pressable. **More** holds the occasional controls: New, Add Page,
Catalog, Library, theme, Fit to screen, Present, grid, snap, ruler units and
canvas resize. Each dock button fires the real control, so the phone and the
desktop cannot drift.

There is one **Play**: a deck (two pages or more) plays every page on the scene
stage, transitions and sound included; a single page plays its own timeline on
the canvas (`app.playPiece()`; Space does the same). A canvas frame is the
export's frame: `src/editor/motion-pose.ts` (a lazy chunk) samples the page with
the flipbook's `layersAt()` over the resolved timeline — delays, loops, precomp
clocks, links, in/out windows (a layer outside its window is hidden), paths,
scale, reveal, draw, morph — and `MotionPlayer` copies the changed fields into
state in one `updateLayers()` write, putting them back on stop. While a pose is
held the canvas leaves out the design's animation CSS — its `transform` beats the
pose's transform attribute and replays from 0 on every render, which froze a
one-scene piece on its first frame — and that CSS only ever matches elements
inside an `<svg>` (Layers-panel rows and timeline tracks carry `data-layer-id` too). **Present** (the status
bar's screen icon; in More on a phone) is full-screen pages you click through —
a different verb.

**Preview** runs the exported HTML report. A paged deck fits each page to the
screen, centred, with a ‹ n / N › pager underneath — arrow keys and a horizontal
swipe turn pages too (the pager appears whenever the report configures no
navigation of its own).

Phones get no rulers, the formula bar only while something is selected, and an
88px page strip. Sheets name the panel they hold and close from their title bar.
A touch tablet (768–1023px) keeps its top toolbar with a ⋯ overflow instead.

### 2.1 Editor auth (static server)

The static server gates `/` and `/__project_files/*` and accepts, in order: a Bearer
header, a `?token=` query param, or a `folio_session` cookie. A valid `?token=`
(a stateless 30-day JWT when `FOLIO_JWT_SECRET` is configured — see
[DEPLOYMENT.md §7.2](DEPLOYMENT.md)) is **promoted to a `folio_session` cookie**, so a
pasted link authenticates the whole tab without re-challenging on every asset fetch.
The editor is gated solely by the access token / `folio_session` cookie (Jupyter-style) —
there is no HTTP Basic Auth in front of it; an unauthenticated hit gets a plain
"access token required" page, not a browser username/password popup.

### 2.2 Saving

| Backing | Behaviour |
|---|---|
| **Server design** (opened from MCP / library) | Auto-saves the YAML back every 30s when dirty, and on `Ctrl+S`, via `PUT /__project_files/<path>`. The live library refreshes from the new mtime. |
| **New / unsaved design** | `Ctrl+S` (or **Save**) runs **Save to Library** — names the design and writes it to `drafts/designs/<name>.design.yaml` so it appears in the gallery, then keeps auto-saving there. |
| **Local file** (desktop Chrome) | Auto-saves to the opened `FileSystemFileHandle`; other browsers download on save. |

### 2.3 Starting a design

- **New** (toolbar · `Ctrl+Alt+N` · palette → *New Blank Design*) opens a size / aspect-ratio picker (1:1, 4:5, 3:4, 2:3, 9:16, 16:9, A4, …) and creates a blank canvas.
- **Resize Canvas** (status-bar ⊞ · palette) changes the document size / ratio of the current design.
- **Add Page** (toolbar · palette) starts or extends a multi-page design.

---

## 3. LIVE REFRESH (watch the LLM work)

The editor opens an `EventSource` on `<mcp_url>/editor/events`. When the MCP server
writes a design (via `add_layers`, `patch_design`, `seal_design`, …) it broadcasts a
`file_changed` event and the editor reloads that design — no manual refresh.

```
LLM tab:   add_layers → patch_design → seal_design
Editor tab: paints each change as it lands  ◀── /editor/events SSE
```

Run the model in one tab, keep the editor open in another. See
[INTEGRATIONS.md §6](INTEGRATIONS.md) for the link + loop details.

---

## 4. CANVAS

SVG-in-HTML — vector-native, pixel-perfect at any zoom.

| Capability | Detail |
|---|---|
| Select | Click; Shift+click to add; drag empty canvas for rubber-band multi-select |
| Move | Drag; arrow keys nudge 1px (Shift = 10px) |
| Resize | 8-point handles; Shift constrains aspect ratio |
| Rotate | Handle above the selection box; Shift snaps to 15° |
| Flip | Horizontal / vertical via the Transform panel |
| Group | Ctrl+G group · Ctrl+Shift+G ungroup; resizing scales children |
| Lock | Transform panel toggle — locked layers can't be dragged/resized |
| Zoom | Ctrl+scroll or pinch; Ctrl+0 fits canvas |
| Pan | Space+drag or middle-mouse drag |
| Guides | Drag from the rulers to place snap guides |
| Grid | `G` toggles; configurable columns, gutter, baseline |
| Smart guides | Snap to grid + sibling layer edges while dragging |
| Annotations | Alt+hover shows the distance between the selected and hovered layer |
| Context menu | Right-click a layer: duplicate / copy / paste / group / bring-forward / send-backward / flip / lock / delete (with shortcut hints) |

---

## 5. PANELS

| Panel | Function |
|---|---|
| **Layer** | Layers grouped by z-band (background/structural/content/overlay/foreground); virtual scroll (200+ layers); click to select, drag to reorder, double-click to rename |
| **Properties** | Context-aware per layer type: position, size, fill, stroke, radius, effects, transform (z/opacity/rotation/flip), blend mode — live-updates the canvas. Flow-report layers expose **Span + Height** instead of x/y |
| **Problems** | Validation errors/warnings with layer ID + message; click to select the offender; re-runs on every change |
| **File tree** | Open `.design.yaml` / `.template.yaml` / `.component.yaml` |
| **Assets** | Full file manager over the project store + shared library — folder tree, breadcrumb, sortable columns, details/icons views, multi-select (click · ctrl · shift · Ctrl+A), right-click menu, F2 rename, Del delete, drag files in to upload, drag rows onto a folder to move, ⛶ for a full window. Opens standalone (project picker) — no design needs to be loaded. Double-click places an image as a layer. Same store the MCP `manage_design {op:asset_*}` tools use |
| **Page strip** | Page thumbnails — click to navigate; **+** adds a page; right-click for duplicate / move left·right / rename / delete. Paging starts from any design: adding a page to a single-page poster converts it to multi-page |
| **Timeline** | See §5.1b — a dock under the canvas (a sheet on a phone). Scrubber + per-layer tracks on the SCENE clock: keyframes where they play (delay and precomp clocks applied; a click on the ruler writes the keyframe in the track's own time), a band for a layer's in/out window, the stretch a track moves (dashed while it loops), a link follower's replayed keys as hollow diamonds, badges ⟲ loop · ↳ link · ⏱ clock, and a **Shots** strip of the page's markers. Time is editable (`timeline-edit.ts`): drag a band edge to move a layer's in/out point (a layer that lives the whole scene has its handles waiting at the ends of its row; back to the start / out to the end removes the point; a precomp child's point is written on its own clock); click a marker to jump, drag to move it, double-click to rename, right-click to remove; **+** in the Shots header adds one at the playhead (so does a double-click on empty strip). Labels stop at the next marker. Drags snap to 0, the end, the playhead and the markers; each edit is one undo step. A marker is a label — moving it retimes nothing. Rows cover every layer that plays in time: keyframes, a path, a window or a link. The panel class loads on its own chunk; its pure half (`timeline-model.ts`) stays in the main bundle for the player and canvas |
| **Payload (Monaco)** | VS Code's editor (lazy-loaded) over the raw YAML — inline validation, syntax highlighting, **bidirectional sync** with the canvas (300ms debounce, re-entrancy-guarded) |
| **Command palette** | Ctrl+K or `/` — search and run any action by name |
| **Align toolbar** | Align L/C/R · T/M/B; distribute H/V; match width/height |

Multi-select shows a dedicated Properties view: selection bounds,
Group/Ungroup, and an align/distribute grid.

### 5.0 Mobile & tablet

Phones (<768px): single-column layout, bottom nav (layers / properties /
palette as bottom sheets), page strip above the nav, safe-area-aware bottom
bars (`viewport-fit=cover` + `100dvh` — nothing hides under the browser chrome
or home indicator). Tablets (768–1023px): panels become slide-in overlays off
the activity bars, collapsed by default so the canvas gets the full width.
Touch targets in the toolbar are ≥40px on coarse pointers.

### 5.1b The sequence editor (timeline)

One timeline (`ui/panels/timeline-panel.ts`), shown where there is room for it:

| Layout | Where it lives |
|---|---|
| **Desktop, tablet** | a **dock under the canvas** (`editor/timeline-dock.ts`): drag its top edge to resize (kept), **Shift+T** / the status bar's clock / the dock's ✕ hide it, the rail's clock tab shows it. A design with footage opens it the first time, unless the choice was already made |
| **Phone** | a sheet: the bottom nav's **Timeline** slot opens it at half height over the canvas; tap it again to close. No dock (every control stays in the bottom dock) |

The sheet is one wide surface: the **ruler** on top (marks follow the zoom), **row names** that stay put while it scrolls
sideways, the **playhead** as a head on the ruler and a line through every row. A press or drag on the ruler moves it
(touch too). **Zoom**: − / Fit / + in the toolbar, **Ctrl + wheel** about the pointer, **two-finger pinch** about the fingers
(`timeline-zoom.ts` is the math; a pinch only resizes the sheet — a touch keeps delivering to the element it started on, so
rebuilding it mid-gesture drops the pinch). A zoomed view follows the playhead while it plays. The sheet shows the **whole
sequence**; the selection is highlighted, not a filter (⋯ → *Selected only* brings the old filter back). Click a row's name or a
clip to select its layer (Shift / Ctrl adds). The toolbar is one line — transport + time / total, ✂ Split · ❄ Freeze + hold,
⋯ options (duration, stagger, trails), zoom.

### 5.2 Editing a clip by hand

A selected **video** layer gets a clip inspector under its Position & Size: every edit the engine's
`animation(op:video)` makes, on the same arithmetic, no AI. The rules live ONCE in `animation/clip-edit.ts`
(timing half + look half); `videoMotion` (MCP) and the inspector both call it, so a value one accepts the
other accepts, with the same message when it does not. Sections are `ui/panels/properties-clip*.ts`; each
binds only to its own block.

| Section | What it does | Where it runs |
|---|---|---|
| **Clip** | Plays / From file readouts · speed (typed, 0.5×/1×/2×) · volume · mute · loop · fit | browser |
| **Transition** | how the clip ENTERS from the clip ending where it starts: crossfade · dip (colour) · wipe/push (direction) · length. A **join marker** on the clip track (a bow-tie on the cut; filled when a transition plays) — one click adds a crossfade and opens this section. The preview paints a dip's colour behind the clips (`canvas-dip.ts`) | browser |
| **Speed ramp & freeze** | speed keys at the playhead with a graph · **❄ Freeze** (+ hold length) on the timeline toolbar | ramp: browser · freeze: server |
| **Reframe** | focus X/Y · zoom · **Reframe on canvas** (drag to pan, scroll to zoom, Esc ends) · **◆ Key here** pan keys on the file clock | browser |
| **Grade** | exposure · contrast · saturation · warmth · tint · LUT (`.cube` from the project) · reset. The canvas previews the five sliders; a LUT is applied in the export | browser |
| **Green screen** | screen colour · takes out · soft edge · **Pick from clip** (reads the video's RAW frame, not the screen, so the grade does not skew it) | browser |
| **Sound edges** | fades · J-cut (sound leads) · L-cut (sound trails) | browser |
| **Cut** | **Find shots & silences** (ffmpeg, cached by file mtime) → shot **ticks** on the clip block, edges snap to them · **Split at shots** · **Cut silences** (keeps a breath at each end) · **Cut the track to the beat** (every beat / 2 / bar; needs music) | measure + silences + beat: server · split: browser |

One undo step per gesture: a slider's first `input` opens it, `change` closes it, and the panel does not
rebuild under the pointer meanwhile (`clip-commit.ts`).

**The server bridge.** Edits that need ffmpeg or ripple the whole scene (freeze, cut silences, cut to the
beat) go through the editor server, like the export does: the editor saves the design, `POST
/__project_files/__clip` (`editor/server-clip.ts`) runs `animation(op:video)` on the SAVED file through the
MCP beside it, and the file it wrote replaces the design on screen as one undo step (`editor/clip-bridge.ts`).
Allow-list only — `freeze`, `on_beats`, `cut`. `GET /__project_files/__clip/measure?design=&layer=`
(`editor/server-clip-measure.ts`) reads the shots and silences of the part of the file a clip plays.
These need the design in the library (a server file) and the Folio server running; a design opened from
disk says so instead of failing silently.

Known gaps: a clip with keyframes of its own takes a transition on a wrapper layer the editor canvas does
not draw (the export is right; the inspector says so); a ramped or frozen clip shows no shot ticks and
cannot be cut by its footage (no single file↔scene mapping); a LUT shows in the export, not the canvas.

### 5.1 Studio editing of flow-report layers

Charts and tables render **real previews** on the canvas. Drag a component body to
reorder it; drag the side handles to set its span (1–12, snaps to the grid); drag the
bottom handle for an explicit row height. The Data panel manages datasets/queries/
transforms and the Scripts panel manages report scripts. See [REPORT_ENGINE.md](REPORT_ENGINE.md).

---

## 6. KEYBOARD SHORTCUTS

| Key | Action | Key | Action |
|---|---|---|---|
| `V` | Select tool | `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `R` | Rectangle | `Ctrl+D` | Duplicate selection |
| `C` | Circle | `Ctrl+C` / `Ctrl+V` | Copy / Paste as YAML |
| `T` | Text | `Ctrl+G` / `Ctrl+Shift+G` | Group / Ungroup |
| `L` | Line | `Ctrl+[` / `Ctrl+]` | Send backward / Bring forward |
| `G` | Toggle grid | `Ctrl+0` | Fit canvas to screen |
| `Ctrl+K` / `/` | Command palette | `Ctrl+S` | Save (to server / library) |
| `Ctrl+Alt+N` | New blank design | `Esc` | Clear selection / close palette |
| `Delete` | Delete selection | `Shift+T` | Show / hide the timeline |

Clipboard copies layers **as YAML**, so you can paste between designs or into the
Monaco panel.

---

## 7. EXPORT (from the editor)

| Format | Notes |
|---|---|
| **SVG** | Vector, lossless, opens in any browser |
| **PNG ×1 / ×2 / ×3** | Up to 3240×3240 px — retina quality |
| **PDF** | A design saved in the library renders on the server (vector PDF, survives a closed tab — see below); an unsaved one falls back to client-side jsPDF (lazy) |
| **HTML** | Self-contained — SVG + design JSON + animation CSS inline, no external URLs |

### Background exports (leave the tab, come back for the file)

MP4, GIF and library-backed PDF render on the server, not in the page. Starting one only
records a job in the **export ledger** (`<projects>/.export-ledger.json`, `src/editor/export-ledger.ts`);
the **Exports tray** (`src/ui/export/export-tray.ts`) reads it:

- close the tab or let the phone sleep — the render keeps going; reopen the editor (or open it on
  another device) and the tray shows progress, or **Download** once it is done
- a file that finishes while the page is open is saved at once; one found finished on return waits behind
  a 44px Download button (phone browsers refuse downloads no tap asked for) until you tap it or dismiss it
- the render-job registry is in memory: a server restart fails a running job with a clear message
  rather than leaving it spinning (a finished file stays downloadable)

Routes (behind `/__project_files` auth): `POST …/__export {design,type}` · `GET …/__export/jobs` ·
`POST …/__export/ack {job_id}` · `GET …/__export/status?job_id=`. PNG, SVG and HTML stay client-side.

Server-side export (without a browser) is the MCP `export_design` tool — it uses jsdom
+ the same renderer to write real `.svg` files. See [TOOLS.md](TOOLS.md).

---

## 8. THE DESIGN ↔ CANVAS CONTRACT

- The **YAML file is canonical.** Editing in Monaco, dragging on the canvas, or an MCP
  tool write all converge on the same file.
- Z-bands `90–99` are **editor-only UI handles** and are never written to the file.
- For reports/presentations, the design is the *source*; the exported `.report.html` /
  presenter HTML is a *baked snapshot* — re-export after editing the source.

---

## 9. SEE ALSO

- [INTEGRATIONS.md](INTEGRATIONS.md) — `open_url` links + the live-refresh loop
- [ARCHITECTURE.md](ARCHITECTURE.md) — render pipeline + editor module map
- [DESIGN.md](DESIGN.md) — the `.design.yaml` payload spec the editor edits
- [REPORT_ENGINE.md](REPORT_ENGINE.md) — interactive flow reports + studio editing
- [DEPLOYMENT.md](DEPLOYMENT.md) — serving the editor + auth
