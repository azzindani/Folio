#!/usr/bin/env python3
"""Drive the LIVE harness-claude session (the interactive `claude` running in
tmux `main`, visible in the browser terminal at claude.lab.casava.space).

Unlike run_batch.py (which spawns hidden headless `claude -p` instances), this
types each use case straight into the live session so you can watch the
vision-less model compose every design in real time. Serial by nature — there
is one live session.

Per case: /clear (fresh context) → type the prompt → submit → poll the pane
until the model goes idle (and the design file exists) or a timeout → record.

Usage:
  run_live.py --from 1 --to 10
  run_live.py --ids 3,7,12 --timeout 480
"""
import argparse
import json
import os
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
USECASES = os.path.join(HERE, "usecases.json")
RESULTS = os.path.join(HERE, "results.json")
C = "harness-claude"
FOLIO = "folio"
PROJ_ROOT = "/home/folio/projects"
PANE = "main"

# Substrings that mean the TUI is actively working (busy). When none are
# present for `settle` consecutive polls, the turn is considered done.
BUSY = ("esc to interrupt", "interrupt)", "cogitat", "thinking", "✻", "✶", "✻", "tool use",
        "running", "pondering", "working", "esc to")


def tmux(*args):
    subprocess.run(["docker", "exec", C, "tmux", *args], capture_output=True, text=True, timeout=30)


def pane():
    p = subprocess.run(["docker", "exec", C, "tmux", "capture-pane", "-t", PANE, "-p"],
                       capture_output=True, text=True, timeout=30)
    return p.stdout


def busy(text):
    low = text.lower()
    return any(b in low for b in BUSY)


def designs(proj):
    p = subprocess.run(["docker", "exec", FOLIO, "sh", "-lc",
                        f"ls -1 {PROJ_ROOT}/{proj}/designs/*.design.yaml 2>/dev/null"],
                       capture_output=True, text=True, timeout=30)
    return [ln.strip() for ln in p.stdout.splitlines() if ln.strip()]


def design_sig(proj):
    """(max_mtime, total_size, count) over the project's design files. Used to
    detect 'composition done' = the file stops changing — interactive nemotron
    has no turn cap and rambles long past seal, so waiting for the model to go
    idle wastes ~8min/case; the sealed design file going stable is the real
    'done' signal, and the next case's /clear cuts off any leftover chatter."""
    p = subprocess.run(["docker", "exec", FOLIO, "sh", "-lc",
                        f"stat -c '%Y %s' {PROJ_ROOT}/{proj}/designs/*.design.yaml 2>/dev/null"],
                       capture_output=True, text=True, timeout=30)
    mt = sz = n = 0
    for ln in p.stdout.splitlines():
        parts = ln.split()
        if len(parts) == 2 and parts[0].isdigit():
            mt = max(mt, int(parts[0])); sz += int(parts[1]); n += 1
    return (mt, sz, n)


def send_prompt(text):
    # Reset context for a clean, comparable run, then type + submit the prompt.
    tmux("send-keys", "-t", PANE, "Escape")
    tmux("send-keys", "-t", PANE, "C-u")
    time.sleep(0.5)
    tmux("send-keys", "-t", PANE, "-l", "/clear")
    tmux("send-keys", "-t", PANE, "Enter")
    time.sleep(3)
    tmux("send-keys", "-t", PANE, "-l", text)
    time.sleep(0.5)
    tmux("send-keys", "-t", PANE, "Enter")


# The ONLY thing the runner injects around the hand-written human brief: a
# constant, non-creative scaffold naming the project so the output is locatable.
# It is identical for all 100 cases, so it cannot bias design variety — every
# difference between outputs comes from the (pure, hand-written) brief itself.
SCAFFOLD = (
    '(Setup — not part of the creative brief: use the Folio design tools, create a '
    'project named "{proj}", and keep everything you make inside it. Seal each '
    'design when it is finished. Work entirely within the Folio MCP tools — do NOT '
    'launch research, web-search, or sub-agent tasks; compose the design directly '
    'from the brief.)\n\n{brief}'
)


def run_one(case, timeout, poll, settle, min_bytes):
    proj = case["project"]
    n = int(case.get("n", 1) or 1)
    # bulk (3·5·10·20) and multi-format briefs make several designs in one turn —
    # give them proportionally longer before the timeout backstop fires.
    eff_timeout = min(timeout + (n - 1) * 100, 1500)
    t0 = time.time()
    send_prompt(SCAFFOLD.format(proj=proj, brief=case["prompt"]))
    # Advance when the design file STABILIZES (composition + seal done) for
    # `settle` consecutive polls AND has real content (> min_bytes, so a bare
    # create_design scaffold mid-think doesn't count). Backstopped by timeout.
    last = (0, 0, 0)
    stable = 0
    started = False
    while time.time() - t0 < eff_timeout:
        time.sleep(poll)
        sig = design_sig(proj)
        if sig[2] > 0:
            started = True
        if sig == last and sig[2] > 0 and sig[1] >= min_bytes:
            stable += 1
            # once stable AND the model has also stopped working, we're confident
            if stable >= settle and not busy(pane()):
                break
            # even if still "busy" (rambling post-seal), a long stable file is done
            if stable >= settle + 4:
                break
        else:
            stable = 0
        last = sig
    ds = designs(proj)
    total_bytes = design_sig(proj)[1]
    # A bare create_design scaffold (~260 bytes, 0 layers) is NOT a real design —
    # the model stalled before add_layers. Require real content to count as built.
    composed = len(ds) > 0 and total_bytes >= min_bytes
    return {
        "id": case["id"], "project": proj, "title": case.get("title", proj),
        "job": case.get("job", "single"), "n": n, "tags": case.get("tags", ""),
        "prompt": case["prompt"], "designs": ds, "design_count": len(ds),
        "bytes": total_bytes, "generated": composed, "started": started,
        "dur_s": round(time.time() - t0, 1), "mode": "live",
    }


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
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--poll", type=int, default=6)
    ap.add_argument("--settle", type=int, default=4)
    # a bare create_design scaffold is ~260 bytes / 0 layers; a legitimately MINIMAL
    # real design (a "BACK IN 10 MIN" sign, a tip-jar card) is ~600+ with real layers.
    # 450 tells them apart without false-FAILing terse briefs (which SHOULD be small).
    ap.add_argument("--min-bytes", type=int, default=450)
    a = ap.parse_args()

    cases = {c["id"]: c for c in json.load(open(USECASES))}
    if a.ids:
        ids = [int(x) for x in a.ids.split(",")]
    elif a.lo and a.hi:
        ids = list(range(a.lo, a.hi + 1))
    else:
        raise SystemExit("need --ids or --from/--to")

    print(f"[live] driving tmux '{PANE}' — {len(ids)} cases, watch at claude.lab.casava.space", flush=True)
    results = load_results()
    done = 0
    for i in ids:
        if i not in cases:
            continue
        c = cases[i]
        print(f"[start] id={i:03d} {c['project']} :: {c['title']}", flush=True)
        rec = run_one(c, a.timeout, a.poll, a.settle, a.min_bytes)
        results[rec["id"]] = rec
        json.dump(sorted(results.values(), key=lambda r: r["id"]), open(RESULTS, "w"), indent=1)
        done += 1
        flag = "OK " if rec["generated"] else "FAIL"
        print(f"[{done}/{len(ids)}] id={i:03d} {rec['project']} {flag} "
              f"designs={rec['design_count']} dur={rec['dur_s']}s :: {rec['title']}", flush=True)
    print(f"[live-complete] {done} cases", flush=True)


if __name__ == "__main__":
    main()
