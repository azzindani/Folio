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
| VPS behind Caddy | `https://your-domain/` | TLS profile + Basic Auth |

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

### 2.1 Editor auth (static server)

The static server gates `/` and `/__project_files/*` and accepts, in order: a Bearer
header, a `?token=` query param, or a `folio_session` cookie. A valid `?token=`
(a stateless 30-day JWT when `FOLIO_JWT_SECRET` is configured — see
[DEPLOYMENT.md §7.2](DEPLOYMENT.md)) is **promoted to a `folio_session` cookie**, so a
pasted link authenticates the whole tab without re-challenging on every asset fetch.
Behind Caddy, the `?token` path bypasses the editor's HTTP Basic Auth (Jupyter-style).

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

---

## 5. PANELS

| Panel | Function |
|---|---|
| **Layer** | Layers grouped by z-band (background/structural/content/overlay/foreground); virtual scroll (200+ layers); click to select, drag to reorder, double-click to rename |
| **Properties** | Context-aware per layer type: position, size, fill, stroke, radius, effects, transform (z/opacity/rotation/flip), blend mode — live-updates the canvas. Flow-report layers expose **Span + Height** instead of x/y |
| **Problems** | Validation errors/warnings with layer ID + message; click to select the offender; re-runs on every change |
| **File tree** | Open `.design.yaml` / `.template.yaml` / `.component.yaml` |
| **Page strip** | Page thumbnails — click to navigate; **+** adds a page; right-click for duplicate / move left·right / rename / delete. Paging starts from any design: adding a page to a single-page poster converts it to multi-page |
| **Timeline** | Animation keyframe scrubber + per-layer tracks |
| **Payload (Monaco)** | VS Code's editor (lazy-loaded) over the raw YAML — inline validation, syntax highlighting, **bidirectional sync** with the canvas (300ms debounce, re-entrancy-guarded) |
| **Command palette** | Ctrl+K or `/` — search and run any action by name |
| **Align toolbar** | Align L/C/R · T/M/B; distribute H/V; match width/height |

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
| `Delete` | Delete selection | | |

Clipboard copies layers **as YAML**, so you can paste between designs or into the
Monaco panel.

---

## 7. EXPORT (from the editor)

| Format | Notes |
|---|---|
| **SVG** | Vector, lossless, opens in any browser |
| **PNG ×1 / ×2 / ×3** | Up to 3240×3240 px — retina quality |
| **PDF** | Client-side via jsPDF (lazy) |
| **HTML** | Self-contained — SVG + design JSON + animation CSS inline, no external URLs |

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
