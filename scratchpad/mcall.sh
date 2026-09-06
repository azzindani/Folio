#!/usr/bin/env bash
# Call a Folio MCP tool over raw JSON-RPC — the real wire surface, unaffected by
# any client-side tool-schema cache.
#
#   mcall.sh <tool> '<json args>' [max_chars]
#
# Parse the FULL reply, then trim for display. The earlier version sliced the
# JSON string at 2500 chars before anything read it, so a long reply arrived as
# a JSONDecodeError and looked like a server fault — twice. Truncation is now
# visible and never happens before parsing.
set -euo pipefail
KEY=$(grep -o 'FOLIO_API_KEY=.*' /root/Folio/.env | head -1 | cut -d= -f2- | tr -d '"'"'"'')
LIMIT="${3:-2500}"
curl -s -X POST https://folio.casava.space/mcp \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}" \
| LIMIT="$LIMIT" python3 -c '
import sys, json, os
limit = int(os.environ["LIMIT"])
d = json.load(sys.stdin)
if "error" in d:
    print("RPC ERROR:", json.dumps(d["error"])); sys.exit(0)
t = json.loads(d["result"]["content"][0]["text"])
drop = {"context", "handover", "progress", "token_estimate", "backup", "next_action"}
kept = {k: v for k, v in t.items() if k not in drop}
# Findings are the point of diagnose/heal — never let them fall off the end.
fs = kept.pop("findings", None)
if fs is not None:
    errs = [f for f in fs if f.get("severity") == "error"]
    print(f"findings: {len(fs)} ({len(errs)} error)")
    for f in fs[:12]:
        sev, code = str(f.get("severity", "?")), str(f.get("code", ""))
        msg = str(f.get("message", ""))[:110]
        print("  %-10s %-22s %s" % (sev, code, msg))
    if len(fs) > 12: print(f"  … {len(fs)-12} more")
s = json.dumps(kept, indent=1)
print(s if len(s) <= limit else s[:limit] + f"\n… TRUNCATED for display at {limit} of {len(s)} chars (pass a 3rd arg to raise)")
'
