#!/bin/sh
# Retry-on-thrash wrapper for the blind-30B design harness.
# Per topic: run the model, then verify it produced a NON-BLANK sealed design
# (a design path exists in the log AND render_preview returns >= MIN_BYTES).
# A no-op (no tool calls → no design) or a blank/bg-only render triggers a retry
# with a more forceful brief. Catches g_mars (no-op), g_coffee (empty group),
# g_summit (bg-only) without touching the engine.
cd /workspace || exit 1
TOK=$(python3 -c "import json;print(json.load(open('/root/.claude.json'))['mcpServers']['folio']['headers']['Authorization'])")
MIN_BYTES=20000
MAX_TRIES=3

render_bytes() { # $1 = design_path → echoes PNG byte count (0 on failure)
  curl -s -m 45 -X POST https://folio.casava.space/mcp \
    -H "Authorization: $TOK" -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"render_preview\",\"arguments\":{\"design_path\":\"$1\",\"scale\":0.3}}}" \
    | grep -oaE '"bytes\\?":[0-9]+' | head -1 | grep -oE '[0-9]+'
}

run_topic() { # $1 = topic, $2 = proj
  topic="$1"; proj="$2"
  base="Use the Folio design MCP (tools prefixed mcp__folio__) to make ONE finished, sealed poster about: \"$topic\". Call mcp__folio__enrich_brief with exactly that topic, then follow its returned instruction EXACTLY — create_design at the suggested width/height in project_path \"$proj\", then ONE add_layers with a single preset layer of the suggested design_type, copying the suggested bg_style/bg/accent/text_color/font/headline_style/palette VERBATIM and filling every slot (kicker, title, subtitle, and EVERY block) with real, specific content from your own knowledge. Do NOT use web search. Then diagnose_design; if clean, seal_design. Reply with only the final share_url."
  force=" YOU MUST ACTUALLY BUILD AND SEAL IT — do not reply conversationally. Steps: (1) create_design; (2) ONE add_layers with a 'sections' preset whose blocks array has 5-7 FILLED blocks — a stats block with 4 real numbers+labels, 2-3 heading_text blocks (heading + a full-sentence body), a bars block, and a callout; pass title and subtitle on the layer; (3) diagnose_design; (4) seal_design. Every block must contain real content. Reply with only the share_url."
  try=1
  while [ "$try" -le "$MAX_TRIES" ]; do
    if [ "$try" -gt 1 ]; then printf '%s%s' "$base" "$force" > "brief_$proj.txt"; else printf '%s' "$base" > "brief_$proj.txt"; fi
    echo "=== START $proj try $try :: $topic ==="
    claude -p "$(cat brief_$proj.txt)" --dangerously-skip-permissions --max-turns 26 \
      --output-format stream-json --verbose > "log_${proj}_t${try}.jsonl" 2>&1
    dp=$(grep -aoE '/home/folio/projects/[A-Za-z0-9_./-]+\.design\.yaml' "log_${proj}_t${try}.jsonl" | tail -1)
    if [ -z "$dp" ]; then
      echo "=== $proj try $try: NO-OP (no design produced) → retry ==="
    else
      b=$(render_bytes "$dp"); b=${b:-0}
      if [ "$b" -ge "$MIN_BYTES" ]; then
        echo "=== END $proj OK (try $try, ${b}B) :: $dp ==="
        return 0
      fi
      echo "=== $proj try $try: BLANK (${b}B < ${MIN_BYTES}) → retry :: $dp ==="
    fi
    try=$((try + 1))
  done
  echo "=== END $proj FAILED after $MAX_TRIES tries ==="
  return 1
}

# Default to the full 20; override by passing "topic|proj" args (used to retest).
if [ "$#" -eq 0 ]; then
  set -- \
   "the future of artificial intelligence|g_ai" "a brief history of jazz music|g_jazz" \
   "saving our oceans from plastic|g_oceans" "the race to explore Mars|g_mars" \
   "the global coffee economy|g_coffee" "the renewable energy revolution|g_energy" \
   "ancient Roman engineering|g_rome" "the rise of sustainable fashion|g_fashion" \
   "the physics of black holes|g_blackholes" "the electric vehicle era|g_evs" \
   "the science of marathon training|g_marathon" "the psychology of color|g_color" \
   "the rising cost of cybercrime|g_cyber" "the science of sleep|g_sleep" \
   "a launch poster for a productivity app|g_app" "meditation and mindfulness for beginners|g_meditate" \
   "the art of modern architecture|g_arch" "in praise of slowness an essay|g_slow" \
   "a design systems conference flyer|g_summit" "six habits of deep work|g_habits"
fi
for entry in "$@"; do
  topic=${entry%%|*}; proj=${entry##*|}
  run_topic "$topic" "$proj"
done
echo "ALL_DONE_20R"
