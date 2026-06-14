#!/bin/sh
# Bulk OPTIONS for ONE topic — "give me N designs of the same subject to choose from".
#
#   ./bulk_variants.sh "the economics of streaming music" 5 [project-prefix]
#
# For each option i in 0..N-1 it asks enrich_brief for variant:i (a DISTINCT
# art-direction — palette + typography treatment + background geometry for the
# same topic), bakes that look into the brief, and drives the blind model to fill
# it with the topic's content in its own project (<prefix>_v<i>). Reuses the
# retry-on-thrash check (no design / render < MIN_BYTES → retry) so every option
# is non-blank. Same content, N looks → pick the one you like.
cd /workspace || exit 1
TOPIC="$1"; COUNT="${2:-5}"; PREFIX="${3:-opt}"
[ -z "$TOPIC" ] && { echo "usage: bulk_variants.sh <topic> <count> [prefix]"; exit 1; }
TOK=$(python3 -c "import json;print(json.load(open('/root/.claude.json'))['mcpServers']['folio']['headers']['Authorization'])")
MCP=https://folio.casava.space/mcp
MIN_BYTES=20000; MAX_TRIES=3

mcp_call() { curl -s -m 60 -X POST "$MCP" -H "Authorization: $TOK" -H "Content-Type: application/json" -d "$1"; }
render_bytes() {
  mcp_call "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"render_preview\",\"arguments\":{\"design_path\":\"$1\",\"scale\":0.3}}}" \
    | grep -oaE '"bytes\\?":[0-9]+' | head -1 | grep -oE '[0-9]+'
}
# enrich_brief(topic, variant) → its `instruction` string (carries the variant's
# bg/accent/bg_style/font/headline_style/palette + canvas, verbatim-copyable).
enrich_instruction() {
  req=$(python3 -c "import json,sys;print(json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'enrich_brief','arguments':{'prompt':sys.argv[1],'variant':int(sys.argv[2])}}}))" "$1" "$2")
  mcp_call "$req" | python3 -c "import json,sys;d=json.load(sys.stdin);print(json.loads(d['result']['content'][0]['text'])['instruction'])"
}

i=0
while [ "$i" -lt "$COUNT" ]; do
  proj="${PREFIX}_v${i}"
  instr=$(enrich_instruction "$TOPIC" "$i")
  brief="Use the Folio design MCP (tools prefixed mcp__folio__) to make ONE finished, sealed poster about: \"$TOPIC\" — this is OPTION $((i + 1)) of $COUNT, a DISTINCT visual treatment. Create it in project_path \"$proj\". Follow this art-direction EXACTLY, copying the bg/accent/bg_style/font/headline_style/palette VERBATIM: $instr Fill kicker, title, subtitle, and EVERY block with real, specific content from your own knowledge. Do NOT use web search. Reply with only the final share_url."
  force=" YOU MUST BUILD AND SEAL IT: create_design, then ONE add_layers with a 'sections' preset whose blocks array has 5-7 FILLED blocks (a stats block with 4 real numbers+labels, 2-3 heading_text blocks each with a full-sentence body, a bars block, and a callout), then diagnose_design, then seal_design. Do not reply conversationally without sealing."
  try=1
  while [ "$try" -le "$MAX_TRIES" ]; do
    if [ "$try" -gt 1 ]; then printf '%s%s' "$brief" "$force" > "brief_$proj.txt"; else printf '%s' "$brief" > "brief_$proj.txt"; fi
    echo "=== START $proj (variant $i) try $try :: $TOPIC ==="
    claude -p "$(cat brief_$proj.txt)" --dangerously-skip-permissions --max-turns 26 \
      --output-format stream-json --verbose > "log_${proj}_t${try}.jsonl" 2>&1
    dp=$(grep -aoE '/home/folio/projects/[A-Za-z0-9_./-]+\.design\.yaml' "log_${proj}_t${try}.jsonl" | tail -1)
    if [ -n "$dp" ]; then
      b=$(render_bytes "$dp"); b=${b:-0}
      if [ "$b" -ge "$MIN_BYTES" ]; then echo "=== END $proj OK (variant $i, try $try, ${b}B) :: $dp ==="; break; fi
      echo "=== $proj try $try: BLANK (${b}B) → retry ==="
    else
      echo "=== $proj try $try: NO-OP → retry ==="
    fi
    try=$((try + 1))
    [ "$try" -gt "$MAX_TRIES" ] && echo "=== END $proj FAILED after $MAX_TRIES tries (variant $i) ==="
  done
  i=$((i + 1))
done
echo "ALL_DONE_BULK"
