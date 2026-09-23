# Folio asset pack — licences

Everything under `library/` ships with Folio and is copied into the shared
asset library (`lib/folio/…`) when the MCP server starts. Only files that anyone
may redistribute, modify and use commercially are allowed in here:

| Allowed | Not allowed |
|---|---|
| CC0 · public domain · OFL-1.1 · MIT · ISC | CC BY / BY-SA (credit line on every piece) · any NC or ND licence · "free to use, no redistribution" licences (Pixabay, unDraw, …) |

`manifest.json` is the per-file record: path, licence, source, landing page,
creator, title and search tags. The server refuses to seed a file whose licence
is not in the allowed list (`src/mcp/engine/library-pack.ts`).

## Sources

| Folder | Source | Licence |
|---|---|---|
| `sfx/ui`, `sfx/impact`, `sfx/digital` | Kenney — Interface Sounds, UI Audio, Impact Sounds, Digital Audio (<https://kenney.nl>) | CC0 1.0 |

Processing: leading silence trimmed, peak normalised to −1 dBFS, re-encoded as
128 kbps MP3. The originals' licence carries over unchanged.

## Turning it off

`FOLIO_PACK=0` skips seeding. A seeded file you delete stays deleted — the
server remembers what it seeded (`<library>/.pack/ledger.json`) and does not
put it back; a file you edit in place is never overwritten by a pack update.
