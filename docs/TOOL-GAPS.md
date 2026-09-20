# Tool gaps — what still needs a shell

Folio's promise is that a model with only the MCP surface can build a finished
piece. Every time an author has to reach for a shell, a file read or a probe
script, that promise has a hole in it. This is the list, kept from real builds
(the 62 s billboard, 2026-09-18; the 36 s zoom piece, 2026-09-20), newest first.

Rule for this file: an entry names what the author was trying to do, what they
had to do instead, and the tool that would close it. An entry comes off the list
only when the MCP can do the job end to end.

## Open

| # | The author wanted to | Had to instead | The tool that closes it |
|---|---|---|---|
| 1 | Write verbose layers without guessing field names (`radius` vs `corner_radius`, `stroke:{color,width}`, `style.letter_spacing`, `circle` needs `cx/cy/rx/ry`) | Read `src/schema/types/layers.ts` + `primitives.ts` over a shell | `get_engine_guide {section:"layers"}` — the verbose schema per layer type, with the one-line rule for each field. The shorthand is documented; the verbose form a motion piece needs is not. |
| 2 | Pick a font that will actually rasterise | `cat src/mcp/fonts/manifest.json` in the container | A fonts listing op (bundled families + weights + which are in the project), so "is Archivo bundled?" is a call, not a file read. |
| 3 | Add a layer INSIDE an existing group (an icon into shot 4) | `patch_design` with `layers[1].layers[1].layers[3].layers[9]`, index paths learned from an error hint | `add_layers {parent_id}` / `edit_layer {op:"add", into:"<group id>"}`. Index paths are unreadable and break when anything is inserted before them. |
| 4 | Rotate the camera while it moves | Not possible — tilted the content instead, which breaks the geometry a portal depends on | `op:camera shots[].rotation` (**shipped 2026-09-20** — see Closed). |
| 5 | End a piece framed exactly where it began, so it loops | Hand-computed a scaled replica of the opening frame and hand-placed a final camera shot | `op:camera {loop:true}`: frame the last shot so it matches shot 1, or a `replica` layer that draws a region of the world scaled into a box (a Droste/infinite-zoom primitive). |
| 6 | Know WHY the lint flagged a shot — which segments were moving at that moment | Wrote `scratchpad/seg-probe.ts` to walk the resolved timeline | `op:timeline {at:<ms>}` — every segment live at a time, with the channels each one changes. `op:lint` says what is wrong; nothing says what was moving. |
| 7 | Place content by nesting regions (each frame inside the last) | Computed 8 nested boxes and every font size by hand, outside the engine | A geometry helper op: given a box and a ratio, return the nested boxes — or let `op:camera` take a chain and report the regions. Spatial math is the engine's job (CLAUDE.md §0.4); here the author did it. |
| 8 | Check that a design's sound actually plays in the editor | Drove the live editor with Playwright | Nothing to build here — verifying the deployed UI is out of the MCP's scope. Listed so it is not mistaken for a gap. |

## Closed

| Was | Closed by |
|---|---|
| No way to find or fetch music and sound effects | `asset_search {what:"music"\|"sound"}` + `asset_fetch` (2026-09-18) |
| No way to act on "this shot is too short to read" without re-blocking the piece | `animation op:retime` — ripple insert/close on the scene clock (2026-09-18) |
| Camera could not rotate | `op:camera shots[].rotation`, degrees, about the world centre (2026-09-20) |
