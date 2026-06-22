#!/usr/bin/env python3
"""Drive harness-claude (vision-less model + Folio MCP) over a batch of use cases.

Each case runs `claude -p` headless inside the harness-claude container, which
composes a design via the Folio MCP under project suite-NNN. We then locate the
produced design file(s) and record status. One stdout line per finished case
(for Monitor); full structured results written to results.json (merged).

Usage:
  run_batch.py --ids 1,2,3
  run_batch.py --from 1 --to 10
  run_batch.py --from 1 --to 10 --workers 4 --timeout 360 --max-turns 30
"""
import argparse
import concurrent.futures as cf
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
USECASES = os.path.join(HERE, "usecases.json")
RESULTS = os.path.join(HERE, "results.json")
HARNESS = "harness-claude"
FOLIO = "folio"
PROJ_ROOT = "/home/folio/projects"


def run_one(case, timeout, max_turns):
    proj = case["project"]
    t0 = time.time()
    # Run the agent headless. --output-format json prints one JSON result object.
    inner = (
        f"cd /workspace && claude -p {json_quote(case['prompt'])} "
        f"--allowedTools mcp__folio --max-turns {max_turns} --output-format json"
    )
    cmd = ["docker", "exec", HARNESS, "bash", "-lc", inner]
    # usecases.json schema: id/project/title/job/n/tags/prompt (the rewritten
    # hand-authored suite). Use .get() so a future schema tweak can't crash the run.
    rec = {"id": case["id"], "project": proj, "title": case.get("title", ""),
           "job": case.get("job"), "n": case.get("n"), "tags": case.get("tags")}
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        out = p.stdout.strip()
        meta = parse_result(out)
        rec.update(meta)
        rec["agent_exit"] = p.returncode
    except subprocess.TimeoutExpired:
        rec.update({"agent_exit": "timeout", "is_error": True, "num_turns": None,
                    "agent_result": "TIMEOUT"})
    # Locate produced design(s) regardless of agent self-report.
    designs = list_designs(proj)
    rec["designs"] = designs
    rec["design_count"] = len(designs)
    rec["dur_s"] = round(time.time() - t0, 1)
    # Status heuristic: produced at least one design file => generated.
    rec["generated"] = len(designs) > 0
    return rec


def json_quote(s):
    # Safe single-arg quoting for bash -lc (the whole inner cmd is one string).
    return "'" + s.replace("'", "'\\''") + "'"


def parse_result(out):
    if not out:
        return {"is_error": True, "num_turns": None, "agent_result": "(no output)"}
    last = out.splitlines()[-1]
    try:
        o = json.loads(last)
        return {"is_error": bool(o.get("is_error")), "num_turns": o.get("num_turns"),
                "agent_result": str(o.get("result", ""))[:240],
                "cost_usd": o.get("total_cost_usd")}
    except Exception:
        return {"is_error": None, "num_turns": None, "agent_result": last[:240]}


def list_designs(proj):
    d = f"{PROJ_ROOT}/{proj}/designs"
    cmd = ["docker", "exec", FOLIO, "sh", "-lc",
           f"ls -1 {d}/*.design.yaml 2>/dev/null"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return [ln.strip() for ln in p.stdout.splitlines() if ln.strip()]
    except Exception:
        return []


def load_results():
    if os.path.exists(RESULTS):
        try:
            return {r["id"]: r for r in json.load(open(RESULTS))}
        except Exception:
            return {}
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids")
    ap.add_argument("--from", dest="lo", type=int)
    ap.add_argument("--to", dest="hi", type=int)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--timeout", type=int, default=360)
    ap.add_argument("--max-turns", type=int, default=30)
    a = ap.parse_args()

    cases = {c["id"]: c for c in json.load(open(USECASES))}
    if a.ids:
        ids = [int(x) for x in a.ids.split(",")]
    elif a.lo and a.hi:
        ids = list(range(a.lo, a.hi + 1))
    else:
        print("need --ids or --from/--to", file=sys.stderr)
        sys.exit(2)
    todo = [cases[i] for i in ids if i in cases]

    print(f"[batch] {len(todo)} cases, {a.workers} workers, timeout {a.timeout}s", flush=True)
    results = load_results()
    done = 0
    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = {ex.submit(run_one, c, a.timeout, a.max_turns): c for c in todo}
        for fut in cf.as_completed(futs):
            rec = fut.result()
            results[rec["id"]] = rec
            json.dump(sorted(results.values(), key=lambda r: r["id"]), open(RESULTS, "w"), indent=1)
            done += 1
            flag = "OK " if rec["generated"] and not rec.get("is_error") else \
                   ("GENbut?" if rec["generated"] else "FAIL")
            print(f"[{done}/{len(todo)}] id={rec['id']:03d} {rec['project']} "
                  f"{flag} designs={rec['design_count']} turns={rec.get('num_turns')} "
                  f"dur={rec['dur_s']}s :: {rec['title']}", flush=True)
    print(f"[batch-complete] {done} cases done", flush=True)


if __name__ == "__main__":
    main()
