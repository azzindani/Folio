# EXPECTATIONS.md — What Folio Must Be
# The product bar for "graphic-design studio with MCP support"
# Written 2026-07-07 · basis for REQUIREMENTS.md → GAP-ANALYSIS.md → ROADMAP.md

> This is the **expectation** side of the planning chain. Each area has a
> detailed file under `docs/expectations/`. Compare against reality in
> [GAP-ANALYSIS.md](GAP-ANALYSIS.md); execution plan in [ROADMAP.md](ROADMAP.md);
> must/nice split in [REQUIREMENTS.md](REQUIREMENTS.md).

---

## The one-sentence bar

**Any MCP-capable model — frontier (Claude Opus/Sonnet, GPT, Gemini) or local
(Gemma 3n E4B class) — produces designs a human would ship from Canva/Figma,
using the operator's own uploaded assets, on a self-hosted box, with a browser
studio for the human finishing pass.**

Hard constraints inherited from the project:

```
✓ MCP tool count stays 21 — new capability = new `op` on an existing
  multiplexed tool, or a richer field on a 1:1 tool. NEVER a 22nd tool.
✓ Model designs, engine assists (CLAUDE.md §0.4) — no canned layouts.
✓ Local-first, file-based — .design.yaml IS the product.
✓ Deploy = docker cp src + restart (no build step on the host).
✓ Runs offline after install (documented CDN exceptions: report charts).
```

---

## Area index

| # | Area | File | Weight |
|---|---|---|---|
| 1 | Design quality — output looks human-made | [expectations/01-design-quality.md](expectations/01-design-quality.md) | ★★★ core |
| 2 | Model support — frontier AND local | [expectations/02-model-support.md](expectations/02-model-support.md) | ★★★ core |
| 3 | Assets + file system — upload, browse, place | [expectations/03-assets-filesystem.md](expectations/03-assets-filesystem.md) | ★★★ **new priority** |
| 4 | Editor / studio — the human finishing pass | [expectations/04-editor-studio.md](expectations/04-editor-studio.md) | ★★ |
| 5 | Outputs + exports — every deliverable format | [expectations/05-outputs-exports.md](expectations/05-outputs-exports.md) | ★★ |
| 6 | Platform + ops — deploy, auth, performance | [expectations/06-platform-ops.md](expectations/06-platform-ops.md) | ★★ |
| 7 | Testing + validation — harness, vision loop | [expectations/07-testing-validation.md](expectations/07-testing-validation.md) | ★★ |

---

## Summary of the bar per area

**1 · Design quality.** The 20 reference PNGs in `examples/` are the floor, not
the ceiling. Output diversity ≥ output correctness: two prompts in the same
mood must yield visibly different designs. Zero AI tells (indigo gradient,
emoji-icons, fake stats, untracked caps). Every major poster archetype
(editorial, event, infographic, comparison, timeline, mindmap, newsletter,
pricing, stat, cards) reachable by name and by inference.

**2 · Model support.** Frontier models design free-hand — engine stays out of
the way (`locked`, minimal guidance) and rescues only what's broken. Local
models (Gemma 3n E4B, 32–128K ctx) complete the full loop — create → compose →
seal → export — driven purely by `next_action` batons, with heal passes making
blind payloads render well. ≥90% of started designs reach seal; ≥18/20 strong
on a 20-design blind harness run.

**3 · Assets + file system.** An operator uploads photos/logos/fonts once
(editor drag-drop, HTTP, or MCP op); assets live under `<project>/assets/` as
plain files; the model can LIST assets (with dimensions + dominant colors, so
a blind model places them intelligently) and PLACE them (`src:"assets/…"`)
and every surface — editor canvas, preview, PNG, PDF, HTML — resolves them
identically. Two hard invariants (live-audit 2026-07-07): **no silent
blanks** (unresolvable src → placeholder + note, everywhere) and **preview ==
export** image parity. No base64 blobs inside YAML. All within the 21 tools.

**4 · Editor.** Any MCP-produced design is fully editable (grouped selection,
nested edit, page ops). Studio works desktop/tablet/phone. Library is the
always-on home: browse, search, open, manage every project. Tier-1 UX backlog
(multi-select bbox, alt-click through, boolean ops, SVG import) closed.

**5 · Outputs.** What you see is what you export (`renderEntry()` single
path). PNG/SVG/vector-PDF(selectable text + clickable links)/PPTX/HTML/
Lottie/GIF/MP4. Carousel = per-page files. Interactive reports and presenters
are self-contained single files.

**6 · Platform.** One container, 4 GiB, `bun --smol`, cold start <1s, hot
deploy via `docker cp`. Two-lifetime auth (30d session / 30m output links)
holds. No OOM under a full harness run. Offline-safe.

**7 · Testing.** 100 hand-written realistic prompts (never templated), scored
for diversity not preset-conformance. Both model classes tested: frontier
free-hand AND local blind. Vision-critic loop: mid-size model designs via the
claude.lab.casava.space harness → Claude reviews renders → engine fixes land
as failing-case tests first. Infra failures (OOM, 429, plan-mode) triaged
separately from engine failures.
