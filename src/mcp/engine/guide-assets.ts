// Asset guidance — uploading, placing, and now FINDING imagery. Kept out of
// guide.ts, which sits at the 700-line cap — same arrangement as craft.ts and
// guide-marks.ts.

export const ASSETS_GUIDE = `# Assets — photos, logos, fonts in designs
Assets live as FILES in one of TWO stores, and a design references either by path:
  lib/<folders>/<name>        SHARED library — one copy, every project, folders
                              nest ("lib/microsoft/logos/power-automate.svg").
                              This is where anything reusable belongs.
  assets/{images,icons,fonts,docs}/<name>   THIS project only — one-off material:
                              a brief, a screenshot for a single deck.
NEVER inline base64 into a design, NEVER use an https:// URL as a layer src (it
shows in the editor but exports render a placeholder — server exports cannot
fetch the web).

Workflow:
  1. manage_design {op:"asset_list", project_path}   ← what exists, project AND
     shared library together: per asset you get width/height, dominant_colors,
     luminance (dark|light|busy) and alt — enough to place an image you cannot
     see. RUN THIS FIRST: the logo you are about to search for is often already
     on disk, and reusing it costs nothing.
  2. manage_design {op:"asset_add", project_path, name:"team.jpg",
     data:"data:image/jpeg;base64,…", alt:"five people at a whiteboard"}
     ← stores the file + returns a ready-to-place layer_stub. alt is REQUIRED
     practice — it is a vision-less model's only eyes later.
     Add scope:"library" (and a nested folder, e.g. folder:"microsoft/logos") when
     the asset is reusable rather than particular to this one project.
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
                 alt:"what it actually shows"}  → stores it in the SHARED library,
                 records provenance, and returns the lib/ path to reference
Fetching the same ref twice does NOT download twice — the second call is answered
from disk. Pass scope:"project" only when the file is genuinely one-off.
Sources: Openverse + Wikimedia Commons (photos, diagrams, historic material),
Iconify (200k icons + brand marks), the open-font catalogue (what:"font" →
a real .ttf in assets/fonts). Every result already permits commercial use and
modification — the search filters for it.

  • Search engines index OBJECTS, not themes. "bureaucracy" finds nothing;
    "stack of paper folders" finds the picture that MEANS bureaucracy.
  • ICONS match on ONE word. what:"icon", query:"cloud" works; "weather cloud
    lightning" returns nothing. Search one concept at a time.
  • A fetched icon is monochrome and defaults to BLACK — invisible on a dark
    canvas. Pass icon_color:"#YourAccent" on asset_fetch. (For a common glyph
    the built-in {type:"icon", name, color} layer needs no fetch at all;
    reach for the finder when you need a specific set or a brand mark.)
  • DON'T GUESS a built-in icon name — an unknown name renders as a blank
    fallback circle you cannot see. manage_design {op:"icon_search", query:"…"}
    returns ranked real names, says whether the name you have resolves, and
    bridges concepts to objects ("cargo" → package, truck). The built-in
    {type:"icon"} layer inherits currentColor, so set color: on a dark canvas.
  • FONTS: in layers_shorthand the key is font: — font_family: is the verbose
    schema and shorthand IGNORES it, rendering a silent fallback face. Use the
    family string the reply gives you, VERBATIM. It is read from
    inside the file and is often not what you searched for — Space Grotesk's
    static weights declare themselves "Space Grotesk Light". Fetch each weight
    you need (weight:400, weight:700); they group under that one family name.
    The file covers the family's default subset, so unusual accented
    characters may fall back — keep them out of small print.
  • ATTRIBUTION IS PART OF THE DESIGN. If asset_fetch returns
    attribution_required, typeset that line on the canvas — 7–9px, 40–55%
    opacity, along a bottom or side edge. Without it the design is not
    licensed to publish. asset_list returns credits[] for everything at once.
  • Fetched files are LOCAL from then on. Nothing is downloaded at render
    time, so exports work exactly as they do for uploaded assets.

## Housekeeping
  • asset_promote {project_path, asset_path:"assets/images/logo.svg",
    folder:"microsoft"} moves a project asset INTO the shared library, repoints
    that project's designs at the new path, and retires the local copy — the fix
    for anything fetched before it was shared.
  • asset_move works on lib/ paths (folders nest there); asset_delete on a lib/
    path removes it for EVERY project, so check asset_list first.
  • A project file at the same path as a shared one WINS — that is how a project
    overrides a shared asset without renaming anything.`;
