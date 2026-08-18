# Commissioning suite

Run: `npm run test:commissioning` (~1.5m, 35 checks). Runs in CI as the
**Commissioning (artifact fidelity)** job, after `build`.

| Spec | Checks | Question it answers |
|---|---|---|
| `export-fidelity` | 6 | is the design actually in the file? |
| `render-integrity` | 7 | does any render come out blank, invisible, or unstable? |
| `artifact-portability` | 4 | does the file still work somewhere else? |
| `font-fidelity` | 5 | is the text in the face the design asked for? |
| `capabilities` | 3 | do motion and persistence actually work? |
| `asset-manager` | 10 | can a person get a file in, file it, and find it again — in the window they actually get? |

## What this suite is for

Commissioning is the step after construction where you turn the plant on and
check that every output is what the spec promised. That is what these tests do:
drive the **real** engine and assert on **the artifact the user receives**.

It exists because of a bug that shipped with a fully green board:

```
unit suite          3690 passed     ← never rasterises anything
e2e export test        1 passed     ← asserted the file starts with %PDF-
reality                            ← every logo missing from every export
```

Every editor export silently dropped every asset for weeks. The e2e test
passed because a PDF with nothing on it still begins with `%PDF-` and still
embeds a font. Nothing in the repo looked at a pixel.

## The rule

> Assert on what the user receives, not on what the code did.

| Weak | Strong |
|---|---|
| `expect(exportToPNG).toHaveBeenCalled()` | the PNG has ink where each layer sits |
| `expect(file.size).toBeGreaterThan(0)` | the page is not one flat colour |
| `expect(pdf).toContain('%PDF-')` | the PDF holds an image XObject |
| `expect(files.length).toBe(8)` | all 8 pages are individually non-blank |

## How it measures

`lib/ink.ts` decodes the artifact in the browser page (no PNG-decoder
dependency) and reports, per region, the fraction of pixels differing from the
page's background colour.

Two subtleties that were learned the hard way and must be preserved:

- **Ink is measured against the page background, not internal variety.** A
  solid-colour logo is perfectly uniform; a variety-only metric calls it
  missing.
- **Regions come from the RENDERED tree, as page fractions.** Not computed from
  the spec (groups and auto-layout move things) and not in pixels (so one
  region list works against a ×1 PNG, a ×3 PNG or a rasterised PDF page).

Image *fills* need special handling: the artwork is a `<pattern>` in `<defs>`
that measures 0×0, so the box is taken from the shape painted with
`url(#id)`. Without that, the fill path is silently unchecked.

## Fixtures

`fixtures/projects/` is a complete, committed Folio projects root — a project
store, a `.library`, and designs that exercise each asset kind. The suite never
reads the developer's own `folio-projects/`: a suite that reads real user data
passes or fails for reasons unrelated to the code (this repo has fixed that bug
before).

Marks in the fixtures sit on plain backgrounds with gaps between them. That is
deliberate, not lazy layout — it is what makes "this region is empty"
unambiguous.

## Adding a check

1. Add or extend a fixture design under `fixtures/projects/commissioning/designs/`.
   Register its unique layer id in `FIXTURE_NAMES` (`lib/harness.ts`) — that id
   is how `openDesign` proves the fixture loaded rather than the editor's
   built-in sample design, which renders beautifully and would otherwise be
   measured instead.
2. Write the assertion against the artifact.
3. **Rehearse the regression.** Break the code the check defends, confirm the
   check goes red and that its message names the problem, then restore. A check
   never seen failing is not known to work.

## Prove-it rehearsal, worked example

Disabling `inlineExternalImages` in `serializeForExport` and rebuilding gives:

```
✘ the PNG the Export button produces contains every asset
    flat regions — the export dropped an asset:
    mark-project: ink=0.000   mark-shared: ink=0.000
    mark-raster:  ink=0.000   fill-shape:  ink=0.000
✓ assets are served to the canvas in the first place
✓ server engine (MCP export_design) › PNG paints every asset
```

The failure names the four assets, and the two passing checks localise the
fault: the assets *were* served, and the *server* path is fine — so it is the
browser export. That triangulation is the point of the suite.

## What belongs here — and what does not

This suite is deliberately **not** trying to cover everything. Each check costs
a real browser and a real render, and a slow suite gets skipped. A check earns
its place only when both are true:

1. **The artifact is the product.** The thing that can be wrong is what the
   user opens, not a function's return value.
2. **A unit test cannot see the failure.** If jsdom can catch it, it belongs in
   `src/**/*.test.ts`, where it runs in milliseconds.

That is why there is no commissioning check for shorthand expansion, token
resolution or schema validation: those are pure functions with excellent unit
coverage, and re-testing them through a browser would only make the suite slow.

### Font fidelity without a network

A fallback face is the quietest failure the engine has: the export succeeds,
the text is readable, every other check passes, and the design is in the wrong
typeface.

The checks are **differential**. Nothing asks "is this Anton?" — that needs
glyph knowledge and a golden image. The `typefaces` fixture renders one string
in four declarations (three shipped faces plus one family that exists nowhere)
and requires the results to LOOK different. If `font_family` were ignored, or
every family collapsed onto one fallback, the bands would match.

Comparison is a 16×16 average hash, and the grid size is measured, not chosen:

| pair | 8×8 (of 64) | 16×16 (of 256) |
|---|---|---|
| anton vs garamond | 7 | 41 |
| garamond vs mono | 6 | 20 |
| mono vs bogus | 5 | 22 |

At 8×8 a line of text is too coarse to separate. The threshold of 15 bits sits
below the observed floor of 20 with room for antialiasing drift, and far above
the 0 that identical rendering produces.

This works offline because the server renderer uses the 32 TTFs bundled in
`src/mcp/fonts/`. Note that the editor CANVAS is different: it pulls design
faces from Google Fonts at runtime (`styles/font-loader.ts`), as does the
client-side export embed (`export/font-embed.ts`). So canvas typography depends
on a third-party CDN even though the same families ship in the repo.

### Still open

- **Lottie and interactive-report exports** — same pattern as `capabilities`,
  not yet written.
- **Chart / KPI / mermaid rendering**, which is foreignObject-only and so
  behaves differently between the browser and resvg.

## Notes

- The editor auto-loads `?file=` only for paths under `/home/folio/projects`
  (hard-coded in `app.ts`). The harness passes a production-shaped path so the
  request lands on its own server; outside the container the editor cannot
  auto-load a design at all.
- `/__project_files/*` is token-gated in every environment, so the suite starts
  the server with a known token and exercises the real gate.
- It boots `src/editor/static-server.ts` (what production runs), not
  `vite preview` — only the former serves `/__project_files/*`. An asset check
  against `vite preview` would be meaningless.
- It needs a current `dist/` (`npx vite build`), because that is what the
  editor server serves.
