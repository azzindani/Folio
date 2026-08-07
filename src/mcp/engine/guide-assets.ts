// Asset guidance — uploading, placing, and now FINDING imagery. Kept out of
// guide.ts, which sits at the 700-line cap — same arrangement as craft.ts and
// guide-marks.ts.

export const ASSETS_GUIDE = `# Project Assets — photos, logos, fonts in designs
Assets live as FILES under <project>/assets/{images,icons,fonts}. Reference them
as src:"assets/images/<name>" — NEVER inline base64 into a design, NEVER use an
https:// URL as a layer src (it shows in the editor but exports render a
placeholder — server exports cannot fetch the web).

Workflow:
  1. manage_design {op:"asset_list", project_path}   ← what exists: per asset you
     get width/height, dominant_colors, luminance (dark|light|busy) and alt —
     enough to place an image you cannot see.
  2. manage_design {op:"asset_add", project_path, name:"team.jpg",
     data:"data:image/jpeg;base64,…", alt:"five people at a whiteboard"}
     ← stores the file + returns a ready-to-place layer_stub. alt is REQUIRED
     practice — it is a vision-less model's only eyes later.
  3. Place: {type:"image", src:"assets/images/team.jpg", pos:[x,y,w,h], fit:"cover"}
     • Respect the native aspect (width/height from asset_list) or set fit:"cover".
     • luminance:"busy" → put a scrim between the photo and any text on top:
       {type:"rect", pos:[same], fill:"rgba(0,0,0,0.45)"} under the text layer —
       or use the built-in overlay treatment (next line).
     • TREATMENTS (all rasterize in exports): mask:"circle|blob|arch|rounded|hex"
       (shape-crops the photo), focal:[fx,fy] 0–1 (keep the subject when cover-
       cropping, e.g. [0.3,0.2] = face upper-left), overlay:{fill,opacity} (a
       legibility scrim INSIDE the mask), frame:{stroke,width,offset} (outline).
     • Shapes take image FILLS too: fill:{type:"image", src:"assets/images/…",
       mode:"cover"|"contain"|"tile"} — a photo inside a circle/blob/card.
  4. render_preview → any image the export can't resolve shows a placeholder
     frame + a note naming the fix. diagnose_design flags distortion (>5%
     aspect mismatch) and >2× upscaling.

Sizing: a hero photo is a DESIGN element — full-bleed + scrim + type on top
beats a small floating rectangle. Match photo tones to the palette (duotone/
overlay effects) instead of dropping an off-palette image on the canvas.

## No photo to hand? FIND one (free, no API key)
  manage_design {op:"asset_search", query:"overhead shot of a wooden desk",
                 what:"photo"}            → candidates w/ ref + native size + LICENCE
  manage_design {op:"asset_fetch", project_path, ref:"openverse:<id>",
                 alt:"what it actually shows"}  → stores it locally, records provenance
Sources: Openverse + Wikimedia Commons (photos, diagrams, historic material),
Iconify (200k icons + brand marks), the open-font catalogue (what:"font" →
a real .ttf in assets/fonts). Every result already permits commercial use and
modification — the search filters for it.

  • Search engines index OBJECTS, not themes. "bureaucracy" finds nothing;
    "stack of paper folders" finds the picture that MEANS bureaucracy.
  • what:"icon" beats drawing a glyph out of rects. what:"logo" gets a real
    brand mark instead of a coloured square with initials.
  • ATTRIBUTION IS PART OF THE DESIGN. If asset_fetch returns
    attribution_required, typeset that line on the canvas — 7–9px, 40–55%
    opacity, along a bottom or side edge. Without it the design is not
    licensed to publish. asset_list returns credits[] for everything at once.
  • Fetched files are LOCAL from then on. Nothing is downloaded at render
    time, so exports work exactly as they do for uploaded assets.`;
