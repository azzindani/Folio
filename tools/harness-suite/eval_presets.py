#!/usr/bin/env python3
"""Report, per suite case, the EXPECTED intent vs the preset the blind model
actually used (the top-level group id prefix in the produced design), plus layer
count + bytes. The headline signal for whether the steering routes versus/
timeline/pricing to the matching structural preset instead of feature_grid.

Usage: eval_presets.py --from 1 --to 10   |   eval_presets.py --ids 1,5,9
"""
import argparse
import glob
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
USECASES = os.path.join(HERE, "usecases.json")
PROJ = "/root/Folio/folio-projects"

# Map an intent → the preset type(s) that render it TRUE to its structure. A
# match means the model picked a structurally-apt preset (not a card-grid collapse).
APT = {
    "event": {"event", "flyer", "hero"},
    "feature_grid": {"feature_grid"},
    "sections": {"sections", "infographic", "document", "report_poster"},
    "sections+bars": {"sections", "infographic", "document"},
    "sections+donut": {"sections", "infographic", "document"},
    "sections+line": {"sections", "infographic", "document"},
    "editorial": {"editorial", "poster", "split"},
    "flow": {"list", "steps", "checklist", "numbered_list", "sections"},
    "versus": {"versus", "compare", "comparison", "vs"},
    "timeline": {"timeline", "roadmap", "history", "milestones"},
    "pricing": {"pricing", "plans", "tiers", "price_table"},
    "stat": {"stat", "metric", "big_number"},
    "quote": {"editorial", "sections", "stat", "split"},
}
# A card grid used where the intent has its own structure = the "samey" failure.
COLLAPSE = "feature_grid"


def top_preset(design_path):
    """The top-level group id prefix (e.g. 'timeline_1' → 'timeline'), the layer
    count and the byte size. Reads the YAML cheaply by regex (avoids a yaml dep)."""
    try:
        txt = open(design_path).read()
    except Exception:
        return ("(missing)", 0, 0)
    size = len(txt)
    # first layer id under top-level `layers:`
    m = re.search(r"\nlayers:\s*\n\s*-\s*id:\s*([A-Za-z0-9_]+)", txt)
    ids = re.findall(r"id:\s*([a-z_]+)_\d+", txt)
    pid = (m.group(1) if m else (ids[0] if ids else "?"))
    preset = re.sub(r"_\d+$", "", pid)
    nlayers = txt.count("type:")
    return (preset, nlayers, size)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids")
    ap.add_argument("--from", dest="lo", type=int)
    ap.add_argument("--to", dest="hi", type=int)
    a = ap.parse_args()
    cases = {c["id"]: c for c in json.load(open(USECASES))}
    if a.ids:
        ids = [int(x) for x in a.ids.split(",")]
    else:
        ids = list(range(a.lo, a.hi + 1))

    apt_n = collapse_n = miss_n = 0
    print(f"{'id':>3} {'intent':14} {'→ preset':16} {'fit':4} {'lyrs':>4} {'bytes':>6}  title")
    for i in ids:
        c = cases.get(i)
        if not c:
            continue
        proj = c["project"]
        files = sorted(glob.glob(f"{PROJ}/{proj}/designs/*.design.yaml"))
        if not files:
            print(f"{i:>3} {c['intent']:14} {'(no design)':16} {'XX':4} {'':>4} {'':>6}  {c['title']}")
            miss_n += 1
            continue
        # if multiple, take the largest (the real composition)
        f = max(files, key=lambda p: os.path.getsize(p))
        preset, nlayers, size = top_preset(f)
        apt = APT.get(c["intent"], set())
        if preset in apt:
            fit, _ = "OK", apt_n
            apt_n += 1
        elif preset == COLLAPSE:
            fit = "CARD"
            collapse_n += 1
        else:
            fit = "??"
        print(f"{i:>3} {c['intent']:14} {preset:16} {fit:4} {nlayers:>4} {size:>6}  {c['title']}")
    total = apt_n + collapse_n + miss_n + (len(ids) - apt_n - collapse_n - miss_n)
    print(f"\napt-preset: {apt_n}/{len(ids)}   card-collapse: {collapse_n}   no-design: {miss_n}")


if __name__ == "__main__":
    main()
