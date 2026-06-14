# Blind-model design harness — retry wrapper

Rig for hardening Folio's MCP so a **vision-less ~30B model** autonomously produces
professional designs from one-line prompts. The model runs in a separate
`harness-claude` container with the deployed Folio registered as an HTTP MCP server
(`mcp__folio__*`); a vision critic reviews the rendered output and fixes the engine.

## `run20r.sh` — retry-on-thrash driver

Drives N topics through the blind model, one `claude -p` run each, and **verifies the
output is a non-blank sealed design** before moving on. The model's two non-deterministic
failure modes — a **no-op** (it replies conversationally, makes zero tool calls) and a
**blank/bg-only** seal — are caught and retried:

1. Run the model on the topic's brief.
2. Extract the produced design path from the stream-json log.
   - No path → **no-op** → retry.
3. Render it via `render_preview` (scale 0.3) and read the PNG `bytes`.
   - `bytes < 20000` → **blank** (real posters render 60–700 KB at 0.3×; blanks < 5 KB) → retry.
4. Retry up to `MAX_TRIES` (default 3) with a **forceful brief** that spells out the
   create → add_layers(sections, 5–7 filled blocks) → diagnose → seal sequence.

This closes the *missing-output* gap; the engine-side guards close the *malformed-input*
gap (stringified-preset recovery, stat label/value repair, content-sized lists,
canvas auto-fit, non-array-layers crash-proofing). Together they took the blind 30B
from ~70–90 % usable to 20/20 non-blank.

### Usage (inside the harness container)

```sh
# full 20-topic suite
./run20r.sh

# retest specific topics ("topic|project" pairs)
./run20r.sh "the race to explore Mars|g_mars" "the global coffee economy|g_coffee"
```

Reads the Folio MCP endpoint + token from the harness's own `~/.claude.json`
(`mcpServers.folio`), so the render check authenticates the same way the model does.
Prints `=== END <proj> OK (try N, <bytes>B) :: <path> ===` per topic and `ALL_DONE_20R`
at the end.

> Rig-only — not part of the Folio product or its CI. It runs in the `harness-claude`
> container, not against the repo.
