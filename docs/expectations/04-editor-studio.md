# Expectation 04 — Editor / Studio

> The browser studio is the HUMAN half of the loop: watch the model work,
> finish by hand, manage the library. Bar: an operator never needs another
> design tool for the finishing pass.

---

## 1. Non-negotiable invariants (already the contract — must never regress)

```
✓ .design.yaml is canonical — canvas, Monaco, MCP writes converge on one file
✓ live SSE refresh — model writes paint into the open editor instantly
✓ what the canvas shows == what export produces (renderEntry single path)
✓ EVERY MCP-produced design is fully editable: grouped/nested selection
  (findLayerDeep), per-layer property edits, page ops, link (href) field
✓ works at desktop / tablet (768–1023px) / phone widths — panels reachable,
  toolbar never crops
✓ flat chrome — no drop-shadows in editor UI (operator preference, enforced)
✓ server-backed auto-save (30s + Ctrl+S) via PUT /__project_files; new designs
  Save-to-Library
```

## 2. Library = home base

- Live, sortable, searchable thumbnail catalog across ALL projects; SSE
  updates (no polling blink); folder (project) create/rename/delete;
  collections; open-in-editor links minted fresh (30-min output tokens).
- Expectation additions: asset visibility per project (§03), design count +
  last-modified sort, and "duplicate into project X".

## 3. Tier-1 UX backlog (from UX_ROADMAP — expected CLOSED for v1)

| Item | Why it matters |
|---|---|
| Common bbox + group transform for ad-hoc multi-select | today per-layer handles only — can't scale a selection together |
| Alt-click click-through to nested layers | selecting inside MCP group-wrapped designs takes layer-panel spelunking |
| Resize from center (Alt) + per-corner radius | muscle-memory parity with every other tool |
| Boolean ops (union/subtract/intersect/exclude) | required for real shape work |
| SVG import → layers | bring outside vectors in (today: underlay only) |
| Gradient editor with on-canvas handles | numeric-only gradient editing is a dead end for humans |
| Constraints / pinning (left/right/center) | responsive edits without re-layout |
| Asset panel (browse `<project>/assets`, drag onto canvas) | pairs with expectation 03 |
| Pattern/grain/blend UI controls | engine renders them; humans can't reach them |
| Background flicker on first load | polish; cheap fix |

## 4. Editing the model's output specifically

- Locked groups: editor must SHOW lock state and allow explicit unlock
  (`edit_layer`/inspect opacity on locked children has an MCP-side gap — the
  editor is the escape hatch).
- Notes/diagnostics surfaced: Problems panel shows the same
  `diagnose_design`-class findings a model sees, so the human fixes the same
  list.
- Reference underlay (Shift+drop) + `extract_reference` palette stay in sync.

## 5. Performance (unchanged targets, still binding)

```
cold start <1s · first render <100ms (50 layers) · drag 60fps ·
Monaco lazy <500ms · bundle <500KB gz (no Monaco) · 200 layers <150MB
```
