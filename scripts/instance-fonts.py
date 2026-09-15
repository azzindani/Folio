#!/usr/bin/env python3
"""Cut the bundled variable fonts into static weight files for raster export.

Why: resvg-js ignores font-weight on a variable font and draws its DEFAULT
instance. Measured on 2026-09-15: Archivo "WWWW" came out 455 px at weight 400
and at 800, and Inter, Plus Jakarta Sans and Manrope were identical at
400/700/800 — so every export drew Montserrat Thin, Fira Code Light, Archivo
SemiBold, whatever the design asked for, while the editor (real weights from
Google Fonts) showed the right ones. A static file per weight is something
resvg's font matching understands (family + usWeightClass), and its hmtx holds
that weight's true advances for font-metrics.ts.

Input:  fonts/variable/*[*].ttf   (the variable sources, kept out of the bundle)
Output: src/mcp/fonts/<Base>-<Style>.ttf for 300–900 within each font's weight
        range, every other axis at its default. Re-run
        `node scripts/gen-font-manifest.mjs` afterwards.

Usage (fontTools is not a project dependency; use a throwaway venv):
    python3 -m venv /tmp/fonts-venv && /tmp/fonts-venv/bin/pip install fonttools
    /tmp/fonts-venv/bin/python scripts/instance-fonts.py [src_dir] [out_dir]
"""

import glob
import os
import re
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

STYLES = {300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black"}
VARIATION_TABLES = ("STAT", "avar", "fvar", "HVAR", "MVAR", "VVAR", "gvar", "cvar")


def family_of(font: TTFont) -> str:
    names = font["name"]
    return (names.getDebugName(16) or names.getDebugName(1) or "").strip()


def set_names(font: TTFont, family: str, weight: int, style: str) -> None:
    """Static naming by hand: fontTools' own renaming needs STAT axis values some families lack."""
    names = font["name"]
    for name_id in (1, 2, 3, 4, 6, 16, 17, 25):
        names.removeNames(nameID=name_id)
    ribbi = style in ("Regular", "Bold")
    postscript = re.sub(r"[^A-Za-z0-9]", "", family) + "-" + style
    records = {
        1: family if ribbi else f"{family} {style}",
        2: style if ribbi else "Regular",
        3: f"{postscript};folio-static",
        4: f"{family} {style}",
        6: postscript,
        16: family,
        17: style,
    }
    for name_id, text in records.items():
        names.setName(text, name_id, 3, 1, 0x409)
        names.setName(text, name_id, 1, 0, 0)
    os2 = font["OS/2"]
    os2.usWeightClass = weight
    # fsSelection: bit 0 italic, bit 5 bold, bit 6 regular.
    os2.fsSelection = (os2.fsSelection & ~0b1100001) | (1 << 5 if style == "Bold" else 1 << 6 if style == "Regular" else 0)
    font["head"].macStyle = (font["head"].macStyle & ~1) | (1 if style == "Bold" else 0)


def main() -> int:
    src_dir = sys.argv[1] if len(sys.argv) > 1 else "fonts/variable"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "src/mcp/fonts"
    sources = sorted(glob.glob(os.path.join(src_dir, "*[[]*.ttf")))
    if not sources:
        print(f"no variable fonts in {src_dir}", file=sys.stderr)
        return 1
    written = 0
    for path in sources:
        base = os.path.basename(path).split("[")[0]
        probe = TTFont(path, lazy=True)
        family = family_of(probe)
        axes = {a.axisTag: a for a in probe["fvar"].axes}
        wght = axes["wght"]
        cut = []
        for weight, style in STYLES.items():
            if not wght.minValue <= weight <= wght.maxValue:
                continue
            pins = {tag: axis.defaultValue for tag, axis in axes.items()}
            pins["wght"] = weight
            font = instantiateVariableFont(TTFont(path), pins)
            for table in VARIATION_TABLES:
                if table in font:
                    del font[table]
            set_names(font, family, weight, style)
            font.save(os.path.join(out_dir, f"{base}-{style}.ttf"))
            cut.append(style)
            written += 1
        print(f"{family:<22} {', '.join(cut)}")
    print(f"{written} static files written to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
