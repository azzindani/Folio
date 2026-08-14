# Commissioning suite

Run: `npm run test:commissioning` (~25s, 11 checks)

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
