# Expectation 03 — Assets + File System  ★ new priority

> The operator uploads photos, logos, illustrations, fonts — once — and both
> the human (editor) and the model (MCP) compose with them. Real design work
> is 50% assets; today Folio only composes what it can draw. This file
> defines the full asset-system bar. Constraint: **21 tools stays 21** —
> every MCP surface below is an `op` on an existing tool or a field on an
> existing one.

---

## 1. Storage model

```
<project>/
  assets/
    images/    photos, logos, illustrations (png jpg webp svg avif)
    icons/     brand/custom icon sets (svg)
    fonts/     brand fonts (ttf otf woff2)
  project.yaml   assets: { images:[...], fonts:[...], icons:[...] }  ← manifest
```

- Assets are **plain files on disk** (local-first, rsync-able) — never base64
  blobs inside `.design.yaml`. A design references `src: "assets/images/team.jpg"`
  (project-relative, portable).
- `project.yaml` manifest entries carry metadata the file alone can't:
  `{ id, path, kind, width, height, bytes, dominant_colors[], alt, added }`.
  Manifest is regenerable by rescanning the dir (files are truth).
- Global/shared assets: a reserved `_shared` project acts as the cross-project
  library (no new mount, no new sandbox rules).
- Sandbox unchanged: everything under `FOLIO_PROJECTS_DIR`; path traversal
  blocked; size caps enforced (per-file cap + per-project quota, env-tunable,
  defaults sized for the 4 GiB container).

## 2. Ingest paths (all three, same result on disk)

| Path | Who | Expectation |
|---|---|---|
| **Editor drag-drop** | human | Dropping an image on the canvas SAVES it to `<project>/assets/images/` (via upload endpoint) and inserts an image layer referencing the saved path. No more transient blob/base64. Shift+drop (reference underlay) also offers "keep as asset" |
| **HTTP upload** | human/scripts | `POST /__project_files/<project>/assets/images/<name>` (extends the existing PUT-design endpoint family on :4173) — body = raw bytes, auth = same token/cookie gate, size-capped, content-type validated (image/font allowlist), filename sanitized |
| **MCP op** | model | `manage_design {op:"asset_add"}` — accepts `data:` URI (≤ cap) OR an `https:` URL the server fetches (opt-in via env, off by default for offline installs) OR a path already inside the sandbox (e.g. from an export). Writes the file + manifest entry, returns `{id, path, width, height, dominant_colors}` |

## 3. MCP surface (within the 21)

| Capability | Surface (no new tools) |
|---|---|
| List assets | `manage_design {op:"asset_list", project_path}` → manifest rows incl. dims + dominant colors + alt. Blind models NEED dims+colors to place assets well |
| Add asset | `manage_design {op:"asset_add", ...}` (§2) |
| Remove asset | `manage_design {op:"asset_delete"}` → `.trash/`, design refs flagged |
| Analyze + store reference | `extract_reference {..., store:true}` — today analysis is read-only; with `store:true` the analyzed image ALSO lands in assets (palette already returned) |
| Place asset | existing `add_layers` / `edit_layer` — image layer `src`; shorthand `image:"assets/images/x.jpg"` with `fit: cover|contain`, crop, focal point |
| Guide | `get_engine_guide {section:"assets"}` — how to list/place/treat assets (new section, not a new tool) |
| Library visibility | `manage_design {op:"browse"}` and the gallery surface per-project asset counts |

Baton integration: after `asset_add`, `next_action` suggests `add_layers` with
a ready-to-use image-layer stub (path + native dims pre-filled).

## 4. Rendering + export resolution (single behavior everywhere)

The same `assets/…` src must resolve in ALL surfaces:

| Surface | Expectation |
|---|---|
| Editor canvas | `src:"assets/…"` rewritten to `/__project_files/<project>/assets/…` at render (token/cookie auth rides the session) |
| Server PNG (resvg) | file read from disk → embedded as data URI into the SVG before rasterize; missing file → styled placeholder frame (already exists) + note |
| Vector PDF | image embedded in the PDF (raster underlay already carries it once PNG path works) |
| HTML / report / presenter | asset inlined as data URI → export stays self-contained |
| SVG export | inlined data URI (portability > file size) or `--linked` flag to keep relative refs |
| PPTX | embedded in the zip |

`flagMissingImages()` already searches design dir → parent → project →
`project/assets`; expectation: that search order becomes THE contract and the
editor uses the identical order.

## 5. Image treatment vocabulary (design-grade, not decoration)

Placing a photo ≠ pasting a rectangle. Shorthand-level treatments, all
renderable in SVG (and rasterizable by resvg):

```
fit: cover|contain + focal:[x,y]      crop without distortion, subject kept
mask: circle|blob|arch|rounded|hex    shaped photos (clip-path)
duotone: [dark, light]                photos recolored into the palette (exists — must work on image layers)
overlay: {fill, opacity, blend}       scrim for text-on-photo legibility
frame: {stroke, offset, polaroid}     framed/print looks
grayscale / saturate / blur           tonal control (effects pipeline exists)
```

Legibility pass extension: text placed OVER an image layer gets a contrast
judgment against the image's dominant colors (from the manifest) → auto-scrim
note or rescue, same philosophy as `fixInvisibleText`.

## 6. Fonts as assets

- Uploaded `assets/fonts/*.ttf|woff2` registered per-project: editor loads via
  FontFace; server export adds them to the resvg/jsPDF font set (bundled-fonts
  mechanism already exists — extend the lookup to project fonts).
- Manifest entry carries family name + weights; `themes {op:list}` mentions
  project fonts so the model uses real family names.

## 7. Model-facing intelligence

A blind model must be able to use a photo it cannot see:

- `asset_list` returns per-asset: dims, aspect, `dominant_colors[]`,
  luminance class (dark/light/busy), `alt` text (operator-provided or model-
  written at ingest).
- `enrich_brief` surfaces available assets relevant to the brief ("3 team
  photos, 1 logo (dark, wide)") so plans incorporate them.
- `diagnose_design` flags: image stretched (aspect mismatch >5%), image
  upscaled beyond native size, text over busy image without scrim, missing
  asset src.

## 8. Hard invariants (live-audit additions, 2026-07-07)

Empirical testing (`gap-audit/image-src-matrix` on the live deployment)
found silent failure everywhere; these are now non-negotiable invariants:

### 8.1 NO SILENT BLANKS — anywhere, ever
Any `src` the renderer cannot turn into pixels **must** produce the styled
placeholder frame AND a note/finding, in **all four** surfaces: editor
canvas, `render_preview`, `export_design`, `diagnose_design`. Verified
current behavior fails this in 7 of 10 cells (file-exists exports a silent
blank; https exports a silent blank; preview never warns; diagnose is
image-blind). A model or human must never learn about a blank hole from the
final PDF.

### 8.2 PREVIEW == EXPORT (image parity)
`render_preview` must run the exact same asset resolution as
`export_design`, and the editor must display the same set of images the
export will produce. Today three different truths exist (editor shows https,
export doesn't; export placeholder-frames missing files, preview doesn't).
One resolver, three consumers.

### 8.3 The engine must never recommend a src type it cannot export
`add_layers` notes currently steer models to `https://` URLs that export
blank. Guidance text is part of the contract: every src form the guide or a
note suggests must round-trip to PNG/PDF.

### 8.4 Images as fills, not just layers
`renderImageFill()` exists in the engine (image/texture fills for shapes)
— the asset system must cover it too: `fill:{type:"image", src:"assets/…"}`
resolves by the same rules as an image layer, enabling shaped/masked photos
without a separate mask implementation.

### 8.5 Photo-first archetypes (the BIG quality bar)
Once assets flow, the design bar rises: hero-image posters (full-bleed photo
+ scrim + type), image-and-text editorial splits, photo card grids, logo
lockups in footers — each an archetype the model can reach by intent
("use the uploaded team photo as the hero"), with the legibility pass
guaranteeing text-over-photo contrast. Target: a photo-bearing brief
produces examples/-level output where the PHOTO is the design's dominant
element, not a pasted rectangle.

## 9. What is NOT in scope for assets v1

```
✗ image editing (retouch, background removal) — treatments only
✗ external DAM/stock integrations (Unsplash etc.) — operator uploads; the
  https-fetch ingest is the hook if wanted later
✗ video assets — animation pipeline consumes designs, not clips
✗ per-asset ACLs — project sandbox + token auth is the boundary
```
