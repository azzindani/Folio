# Expectation 05 — Outputs + Exports

> A design is only done when it leaves as a file the audience consumes.
> Bar: every deliverable type a solo designer ships, exportable server-side
> (no browser required), pixel-faithful to the canvas.

---

## 1. Format matrix

| Format | Expectation |
|---|---|
| PNG | resvg server raster ×1/×2/×3, bundled TTFs, <3s @1080×2; charts/kpi native-drawn (never blank foreignObject) |
| SVG | lossless vector; assets inlined (self-contained default) |
| PDF (standard) | **vector** — selectable text, embedded fonts, clickable `link:` hrefs (incl. inside groups), per-page for carousels |
| PDF (hi-fi) | Puppeteer path for effect-heavy designs (optional dep, graceful absence) |
| PPTX | one slide per page; raster acceptable v1, editable-text is a nice-to-have |
| HTML | self-contained single file (SVG + JSON + animation CSS) |
| Interactive report HTML | self-contained runtime (window.Folio); Chart.js/Plotly CDN = the one documented exception |
| Presenter HTML | transitions, keyboard/touch, teleprompter, remote-clicker |
| Lottie / GIF / MP4 / WebM | keyframe timeline export; ffmpeg/Puppeteer optional deps |

## 2. Fidelity rules

```
✓ renderEntry() is the ONLY render path — canvas, exporter, MCP export agree
✓ foreignObject-only layer types (chart, kpi_card, mermaid) must EITHER
  native-draw at export (bar/donut/line/area done) OR degrade to a styled
  placeholder + note — never a silent blank
✓ deterministic: same YAML → identical bytes (no Date.now/Math.random in render)
✓ fonts: any family the guide advertises renders in PNG/PDF (bundled set);
  project-uploaded fonts join the set (expectation 03 §6)
✓ editor-button exports match MCP exports (browser PDF raster gap is a known
  debt — close or document per release)
```

## 3. Delivery UX

- Every export returns `open_url`/`view_url` (30-min output link) + the file
  under `<project>/exports/`; report `view_url` is the deliverable, edit_url
  secondary.
- Batch: `templates {op:batch}` × N slots → N designs → N exports without
  human clicks in between.
- `/files` download browser (Basic-Auth optional) for raw pickup.
