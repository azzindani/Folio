# Expectation 02 — Model Support (Frontier AND Local)

> Folio must be drivable by the strongest model money buys AND a 4-GB-RAM
> local model. Same 21 tools, same files, different engine posture.
> Test references: frontier = Claude (Opus/Sonnet class); local = Gemma 3n E4B
> (≈4B effective params), Qwen 30B class mid-size, nemotron-class blind models.

---

## 1. The two postures

```
FRONTIER  model leads, engine yields   → free-hand layouts, minimal guidance,
                                          locked-escape hatch, rescue only what broke
LOCAL     engine leads, model follows  → presets, next_action batons, shorthand,
                                          aggressive heal, tiny token budgets
```

Both postures share: the design file is identical, the editor renders it
identically, no posture-specific output format.

## 2. Frontier expectations

| Aspect | Expectation |
|---|---|
| Free-hand layout | Hand-placed custom geometry survives: wrap in ONE group or mark `locked` → finalize passes must not reflow it |
| Guidance mode | `FOLIO_GUIDANCE=minimal` swaps `add_layers` to the light description — no preset pressure |
| Escape hatch | `locked: true` exempts layer/group from every rescue pass; heal notes ADVERTISE this (frontier discoverability) |
| Complex structures | columns, connectors, donut+line charts, bleeds, panels, cards compose without engine fights (unified containment) |
| One design default | Engine never nudges multi-option output; options only when the user explicitly asks |
| Anti-loop | create_project reuse hints prevent 40-projects-recreated loops after a "terrible" verdict |
| Iteration | render_preview inline PNG + diagnose notes → model self-reviews with its own vision |

## 3. Local expectations — the blind-model contract

Target floor: **Gemma 3n E4B** (≈4B effective, 32K usable ctx, no vision, weak
JSON discipline). Everything below must hold at that floor:

| Aspect | Expectation |
|---|---|
| Tool registration | Tier 1 alone fits 32K ctx WITH schemas; `all` fits 128K. Tool descriptions carry the workflow so no external prompt is needed |
| Handover | EVERY write returns `next_action {tool, params, remaining, hint}`; a model that only ever calls `next_action.tool` completes poster AND carousel end-to-end |
| Token economy | shorthand ≈80% cheaper than YAML; `FOLIO_OUTPUT_BUDGET` (default 1000) trims responses; `MCP_CONSTRAINED_MODE` halves list limits |
| Recovery | context reset → `tasks op:resume` / `manage_design op:resume` returns the exact next call; malformed payloads (JSON-in-text-layer, arrays serialized to strings, `text:` aliases, style.* blobs) are recovered, not rejected |
| Blind rescue | All finalize passes (geom/text/legibility/autoplace/pages/charts/presets) — the model never needs to see the render to ship a legible design |
| Notes protocol | `notes[]` tell the model what it can't see (invisible text, overflow, off-canvas); hint text is imperative + short |
| Completion metrics | ≥90% of created designs reach seal; ≥18/20 "strong" on a 20-design blind harness; 0 unsealed drafts presented as done; 0 blank/white posters |
| Failure honesty | model-side failures (timeout, thrash, sparse output) are logged as MODEL failures — the engine must not paper over them by inventing content |

## 4. Model-class sizing table (expectation to keep published + true)

```
Gemma 3n E4B   32K ctx  → tier 1 (6 tools), guide quick_ref only, 3–5 layers/page,
                          preset-only composing, OUTPUT_BUDGET 600
Qwen 9–14B     64K ctx  → tier 1+2 (13 tools), shorthand freeform + presets,
                          OUTPUT_BUDGET 800
Qwen/GLM 30B  128K ctx  → all 21 tools, full guide sections on demand,
                          treatments + bg grammar, OUTPUT_BUDGET 1000
Frontier      200K+ ctx → all 21, FOLIO_GUIDANCE=minimal, free-hand + locked,
                          multi-round refine loop
```

## 5. Transport parity

- stdio (LM Studio local) and HTTP (claude.ai, Claude Code, harnesses) expose
  identical behavior — same handlers, same results.
- Streamable-HTTP compliance holds for MCP SDK clients (LM Studio ≥0.3).
- claude.ai OAuth+PKCE connector: zero re-auth across container bounces.

## 6. What is explicitly NOT expected

- No per-model code paths beyond guidance mode + tier selection + budgets.
- No prompt-side scaffolding requirement: the tool surface is self-teaching
  (descriptions + guide + batons). A harness may add system prompts, but Folio
  must work without them.
- No vision requirement for local models: `render_preview` is optional sugar;
  the blind contract (§3) carries them.
