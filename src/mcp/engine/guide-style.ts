// The `style` guide section — how a project's own history is read back, and
// what to do with the answer.
//
// This lived inline in the manage_design tool description, where it was the
// single heaviest entry (~394 tokens) and was paid for on EVERY request whether
// or not the caller ever asked about style. Review §VI.4/§VI.5: keep tool
// descriptions to what the caller needs to CALL the tool; the reasoning belongs
// in a guide that loads only when wanted.
export const STYLE_GUIDE = `# Style history — not repeating yourself

manage_design {op:"style_history", project_path} reads every prior design in a
project as a STYLE SIGNATURE with the copy stripped out. Call it BEFORE
composing into a project that already holds designs.

## What a signature is
Four axes, none of which contain any words:
  structure    what the design is built from (preset + block kinds)
  composition  columns, vertical extent, anchor
  palette      ground tone, accent family, hue count
  type_scale   how loud the headline is, and the range beneath it

Two designs matching on all four ARE the same design with different words. That
is the point: content is supposed to differ, so content cannot be the measure.

## Traits, not axes
"Palette has settled" is also true of a set that changes its accent every time,
and acting on that would be wrong. So the four axes decompose into TRAITS,
reported one at a time with the count as evidence:

  ground   tone + temperature      accent  hue family
  anchor   where the eye enters    measure which thirds carry ink
  band     where content sits      scale   headline loudness
  ratio    the type range          structure what it is built from

A trait is reported as SETTLED only when it stops varying — "6 of 6 are
dark-neutral". \`unused\` then lists the readings this project has never
produced on that trait: coverage of its own catalogue, NOT a shortlist to pick
from.

## Evidence, not coincidence
A trait counts only when the design COULD have chosen it. A single full-bleed
preset centres its own text and fills its own measure, so \`anchor\` and
\`measure\` are constants of that preset rather than project choices — they are
withheld for single-preset designs and named in \`not_evidence\` instead.
Silence would read as "that one varies", which is the opposite of the truth.

## The knobs
  novelty:0   MATCH the house style. A set is MEANT to look like a set —
              sameness here is the brief, not a fault.
  novelty:1   vary ONE settled trait, hold the rest (default)
  novelty:2   vary every trait that has settled
  style_seed  picks WHICH trait, deterministically — the same seed asks for the
              same kind of departure twice

create_design {style_seed} records the seed on the design, so \`seed_check\`
can answer whether designs made under DIFFERENT seeds actually came out
different. A pair that still signs as one design proves the departure was never
taken. A knob nobody measures is a knob that lies.

## Where it stops
It names the trait with room in it and NEVER the look to put there. "Every one
of 5 grounds is dark-neutral" is the engine's job; what the sixth should be is
yours. An engine that named the replacement would converge every project on one
house style, which is the failure the whole module exists to prevent.

## The neighbouring check
diagnose_design raises \`design_echo\` / \`design_duplicate\` when a design signs
too close to one already in the project. Always a SUGGESTION, never an error:
suppressed when lineage shows the copy was deliberate, and never in heal's
repairable set — an engine must not "fix" a resemblance you chose.`;
