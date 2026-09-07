#!/usr/bin/env bash
# Call a Folio MCP tool with arguments read from a JSON FILE.
#
#   mcallf.sh <tool> <args.json> [max_chars]
#
# Same wire path as mcall.sh; the file avoids shell-quoting a large layer
# payload, which is the thing that breaks when a design gets interesting.
set -euo pipefail
KEY=$(grep -o 'FOLIO_API_KEY=.*' /root/Folio/.env | head -1 | cut -d= -f2- | tr -d '"'"'"'')
LIMIT="${3:-2500}"
python3 -c '
import json, sys
args = json.load(open(sys.argv[1]))
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call",
                  "params":{"name":sys.argv[2],"arguments":args}}))
' "$2" "$1" > /tmp/.folio-rpc.$$.json
curl -s -X POST https://folio.casava.space/mcp \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data-binary @/tmp/.folio-rpc.$$.json \
| LIMIT="$LIMIT" python3 -c '
import sys, json, os
limit = int(os.environ["LIMIT"])
raw = sys.stdin.read()
for line in raw.splitlines():
    if line.startswith("data: "):
        raw = line[6:]; break
d = json.loads(raw)
if "error" in d:
    print("RPC ERROR:", json.dumps(d["error"])); sys.exit(0)
t = json.loads(d["result"]["content"][0]["text"])
for p in (t.get("progress") or []):
    if p.get("status") != "ok":
        print("  %-6s %s%s" % (p.get("status","?"), p.get("message",""),
                               " — " + p["detail"] if p.get("detail") else ""))
drop = {"context","handover","progress","token_estimate","backup","next_action"}
kept = {k: v for k, v in t.items() if k not in drop}
fs = kept.pop("findings", None)
if fs is not None:
    errs = [f for f in fs if f.get("severity") == "error"]
    print(f"findings: {len(fs)} ({len(errs)} error)")
    for f in fs[:14]:
        print("  %-10s %-14s %s" % (f.get("severity","?"), f.get("code",""), str(f.get("message",""))[:105]))
s = json.dumps(kept, indent=1)
print(s if len(s) <= limit else s[:limit] + f"\n… TRUNCATED at {limit} of {len(s)}")
'
rm -f /tmp/.folio-rpc.$$.json
