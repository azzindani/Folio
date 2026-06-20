#!/usr/bin/env python3
"""Measure DIVERSITY across a batch of freely-composed designs — the opposite of
the old eval_presets.py, which scored whether the model routed to the EXPECTED
preset (a template-conformance metric that rewarded the very sameness we want to
kill). Here there is no "expected" anything: the prompt no longer names a preset,
so the only question worth asking is whether the outputs VARY — in structure,
type, colour and composition — or collapse toward one typical look.

Per design we extract cheap signals by regex (no yaml dep):
  · struct        — top-level group/layer id prefix (the shape the model reached for)
  · headline font — font_family on the largest-font_size text layer
  · align         — majority text alignment (left / center / right) = a structure tell
  · palette       — dominant background hue bucketed to a colour name
  · layers, bytes — rough richness

Then it reports distinct-counts and flags NEAR-DUPLICATE clusters (designs that
share struct + headline-font + align + palette). High distinct-counts + few
near-dupes = varied (good). Low distinct-counts + dupe clusters = samey (the bug).

Usage: eval_diversity.py --from 1 --to 10   |   eval_diversity.py --ids 1,5,9
"""
import argparse
import glob
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
USECASES = os.path.join(HERE, "usecases.json")
PROJ = "/root/Folio/folio-projects"


def hex_to_hue_bucket(hexc):
    """Map #RRGGBB → a coarse colour-family name (12 buckets + grey/black/white).
    Two designs sharing a bucket have the 'same' palette feel for sameness checks."""
    h = hexc.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return "?"
    try:
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return "?"
    mx, mn = max(r, g, b), min(r, g, b)
    light = (mx + mn) / 2
    if mx - mn < 0.08:                      # near-grey
        return "black" if light < 0.2 else "white" if light > 0.85 else "grey"
    if light < 0.16:
        return "near-black"
    d = mx - mn
    if mx == r:
        hue = ((g - b) / d) % 6
    elif mx == g:
        hue = (b - r) / d + 2
    else:
        hue = (r - g) / d + 4
    deg = hue * 60
    names = [(15, "red"), (45, "orange"), (70, "yellow"), (160, "green"),
             (200, "teal"), (255, "blue"), (290, "purple"), (335, "pink"), (360, "red")]
    fam = next(n for lim, n in names if deg < lim)
    return ("dark-" if light < 0.35 else "light-" if light > 0.7 else "") + fam


def signals(design_path):
    try:
        txt = open(design_path).read()
    except Exception:
        return None
    # top-level structure family
    m = re.search(r"\nlayers:\s*\n\s*-\s*id:\s*([A-Za-z0-9_]+)", txt)
    struct = re.sub(r"_\d+$", "", m.group(1)) if m else "?"
    # headline font = font_family near the largest font_size
    sizes = [(int(s), pos) for pos, s in
             ((mm.start(), mm.group(1)) for mm in re.finditer(r"font_size:\s*(\d+)", txt))]
    headline_font = "?"
    if sizes:
        _, pos = max(sizes)
        nearby = txt[pos:pos + 400]
        fm = re.search(r"font_family:\s*([^\n]+)", nearby)
        headline_font = fm.group(1).strip().strip("'\"") if fm else "(theme-default)"
    # alignment majority
    aligns = re.findall(r"align:\s*(left|center|right)", txt)
    align = max(set(aligns), key=aligns.count) if aligns else "?"
    # dominant background colour: first fill block's first hex
    hexes = re.findall(r"color:\s*['\"]?(#[0-9A-Fa-f]{3,8})", txt)
    palette = hex_to_hue_bucket(hexes[0]) if hexes else "?"
    return {
        "struct": struct, "font": headline_font, "align": align,
        "palette": palette, "layers": txt.count("type:"), "bytes": len(txt),
    }


def dist(items):
    out = {}
    for x in items:
        out[x] = out.get(x, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids")
    ap.add_argument("--from", dest="lo", type=int)
    ap.add_argument("--to", dest="hi", type=int)
    a = ap.parse_args()
    cases = {c["id"]: c for c in json.load(open(USECASES))}
    ids = ([int(x) for x in a.ids.split(",")] if a.ids
           else list(range(a.lo, a.hi + 1)))

    rows = []
    print(f"{'id':>3}  {'struct':14} {'headline-font':20} {'algn':6} {'palette':14} {'lyr':>3} {'kb':>4}  title")
    for i in ids:
        c = cases.get(i)
        if not c:
            continue
        files = sorted(glob.glob(f"{PROJ}/{c['project']}/designs/*.design.yaml"))
        if not files:
            print(f"{i:>3}  {'(no design)':14}")
            continue
        f = max(files, key=os.path.getsize)
        s = signals(f)
        if not s:
            continue
        rows.append((i, s))
        print(f"{i:>3}  {s['struct']:14.14} {s['font']:20.20} {s['align']:6} "
              f"{s['palette']:14} {s['layers']:>3} {s['bytes']//1000:>4}  {c['title']}")

    n = len(rows)
    if not n:
        print("\n(no designs found)")
        return
    structs = [s["struct"] for _, s in rows]
    fonts = [s["font"] for _, s in rows]
    aligns = [s["align"] for _, s in rows]
    pals = [s["palette"] for _, s in rows]
    sig = lambda s: (s["struct"], s["font"], s["align"], s["palette"])
    seen = {}
    for i, s in rows:
        seen.setdefault(sig(s), []).append(i)
    dupes = {k: v for k, v in seen.items() if len(v) > 1}

    print(f"\n── DIVERSITY (n={n}) ──")
    print(f"  structures ({len(set(structs))}/{n}): {dist(structs)}")
    print(f"  headline fonts ({len(set(fonts))}/{n}): {dist(fonts)}")
    print(f"  palettes ({len(set(pals))}/{n}): {dist(pals)}")
    print(f"  alignment: {dist(aligns)}")
    if dupes:
        print("  NEAR-DUPLICATES (same struct+font+align+palette):")
        for k, v in dupes.items():
            print(f"    {v} → {k}")
    else:
        print("  near-duplicates: none")
    # crude verdict from distinct-ratio of the three strongest axes + dupe load
    ratio = (len(set(structs)) + len(set(fonts)) + len(set(pals))) / (3 * n)
    duped = sum(len(v) for v in dupes.values())
    verdict = ("VARIED (good)" if ratio >= 0.6 and duped <= n * 0.2 else
               "SAMEY (investigate)" if ratio < 0.4 or duped > n * 0.4 else
               "MIXED")
    print(f"  distinct-ratio: {ratio:.2f} | in-dupe: {duped}/{n} | verdict: {verdict}")


if __name__ == "__main__":
    main()
