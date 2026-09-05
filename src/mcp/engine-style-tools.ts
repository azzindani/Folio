// Folio MCP — style history: what this project already looks like.
//
//   manage_design {op:"style_history"}   what has been made, and where it has
//                                        stopped varying
//
// The review's A2 asks for bounded novelty: a style_seed, a novelty level, a
// past_specs memory and layout-signature dedupe. All four are here, and all four
// stop at the same line — this tool reports traits and never proposes a look.
// `direction` names the TRAIT with room in it ("every one of 5 grounds is
// dark-neutral") and leaves the choice of what to put there to the model.
// Naming the replacement is how an assistant becomes a template stamp, which is
// the failure §0.4 exists to prevent.
//
// The seed is checkable, not just passable: create_design records it on the
// design, so `seed_check` can answer whether designs made under different seeds
// actually came out different — a knob nobody measures is a knob that lies.
import * as fs from 'fs';
import * as path from 'path';

import type { ToolResult, ProgressItem } from './types';
import { resolveProjectPath, errResult, okResult, pOk, pInfo, pWarn, buildContext } from './engine/utils';
import { readStyleHistory, saturatedAxes, traitCounts, seedCheck, notEvidence, AXES, TRAITS, type Trait, type PriorDesign } from './design-history';

/** How far to move from what is already there. */
export type Novelty = 0 | 1 | 2;

const NOVELTY_NAME: Record<Novelty, string> = {
  0: 'match — stay in the house style',
  1: 'sibling — vary one trait, hold the rest',
  2: 'explore — vary every trait that has settled',
};

/** Deterministic from the seed, so the same seed asks for the same kind of
 *  departure twice. A seed with nothing to act on is not an error; it just has
 *  no purchase yet, and the reply says so. */
function directionFor(
  designs: PriorDesign[], seed: number, novelty: Novelty,
): { novelty: string; vary: Trait[]; because: string[]; unused?: Record<string, string[]>; note: string } {
  const saturated = saturatedAxes(designs);
  if (novelty === 0) {
    const counts = traitCounts(designs);
    const house = TRAITS.map(t => {
      const top = Object.entries(counts[t.key]).sort((x, y) => y[1] - x[1])[0];
      return top ? `${t.key}=${top[0]}` : '';
    }).filter(Boolean);
    return {
      novelty: NOVELTY_NAME[0], vary: [], because: house,
      note: designs.length
        ? 'Asked to MATCH: build the new design on these same traits. A set is supposed to look like a set — sameness here is the brief, not a fault.'
        : 'Asked to match, but there is nothing to match yet — this is the first design in the project.',
    };
  }
  if (saturated.length === 0) {
    return {
      novelty: NOVELTY_NAME[novelty], vary: [], because: [],
      note: designs.length < 3
        ? `Only ${designs.length} prior design(s) — too few for a pattern to mean anything. Design freely.`
        : 'No trait has settled: the prior designs already differ from each other. Nothing to push against.',
    };
  }
  const vary: Trait[] = novelty === 2
    ? [...new Set(saturated.map(s => s.trait))]
    : [saturated[Math.abs(Math.trunc(seed)) % saturated.length].trait];
  const chosen = saturated.filter(s => vary.includes(s.trait));
  const because = chosen.map(s => `${s.trait} (${s.means}): ${s.count} of ${s.of} are "${s.value}"`);
  // Readings the MEASURE can report that this project never has. Coverage of
  // its own catalogue — deliberately not a shortlist to pick from, and empty
  // for structure, which has no fixed set of readings to be missing from.
  const unused: Record<string, string[]> = {};
  for (const s of chosen) if (s.unused.length) unused[s.trait] = s.unused;
  return {
    novelty: NOVELTY_NAME[novelty], vary, because,
    ...(Object.keys(unused).length ? { unused } : {}),
    note: `Change ${vary.join(' and ')} in the new design; hold the rest so it still belongs to the project. What to change it TO is your call — this says where the room is, not what to put in it. \`unused\` is what this project has never produced on those traits, listed as coverage, not as a shortlist.`,
  };
}

/** Read a project's designs as STYLE rather than as content. */
export function styleHistory(args: {
  project_path: string; limit?: number; style_seed?: number; novelty?: number; design_path?: string;
}): ToolResult {
  const op = 'style_history';
  const progress: ProgressItem[] = [];
  let projectDir: string;
  try {
    projectDir = resolveProjectPath(args.project_path);
  } catch (err) {
    return errResult(op, `Could not resolve project: ${err instanceof Error ? err.message : String(err)}`, 'Pass the project name, e.g. project_path:"air-cargo".');
  }
  // What this op needs is DESIGNS, and `project.yaml` is only a proxy for having
  // them — one that does not hold: 186 of the 203 project dirs on the live
  // server carry a designs/ folder and no project.yaml (they predate it, or were
  // written by a tool that never made one). Guarding on the manifest made the
  // op refuse 92% of the real library while reporting "Project not found" about
  // a directory holding 25 designs. Guard on the thing actually read.
  if (!fs.existsSync(path.join(projectDir, 'designs')) && !fs.existsSync(path.join(projectDir, 'project.yaml'))) {
    return errResult(op, `No project at: ${projectDir}`, 'Pass the project name (e.g. project_path:"air-cargo"). manage_design {op:"browse"} lists what exists.');
  }

  const { designs, scanned, unreadable } = readStyleHistory(projectDir, { limit: args.limit, exclude: args.design_path });
  const novelty = ([0, 1, 2].includes(Number(args.novelty)) ? Number(args.novelty) : 1) as Novelty;
  const seed = Number.isFinite(Number(args.style_seed)) ? Number(args.style_seed) : 0;
  const direction = directionFor(designs, seed, novelty);
  const saturated = saturatedAxes(designs);

  if (designs.length === 0) {
    progress.push(pInfo('Nothing made here yet', 'no prior designs to echo'));
    return okResult(op, {
      designs: [], count: 0, direction,
      note: 'An empty project has no house style and nothing to avoid. Design freely; this becomes useful from the second design on.',
      progress, context: buildContext(op, `No prior designs in ${path.basename(projectDir)}`),
    });
  }

  progress.push(pOk(`${designs.length} prior design(s)`, `${new Set(designs.map(d => d.signature.structure)).size} distinct structure(s)`));
  for (const s of saturated) progress.push(pWarn(`Every design shares one ${s.trait}`, `${s.count} of ${s.of} are "${s.value}" — ${s.means}`));

  const clones = designs.filter(d => d.cloned_by).length;
  const seeds = seedCheck(designs);
  const blind = notEvidence(designs);
  if (seeds?.ineffective.length) progress.push(pWarn('Seeds that changed nothing', `${seeds.ineffective.length} pair(s) under different seeds still sign as one design`));

  return okResult(op, {
    designs: designs.map(d => ({
      name: d.name, modified: d.modified,
      structure: d.signature.structure, composition: d.signature.composition,
      palette: d.signature.palette, type: d.signature.type_scale,
      ...(d.cloned_by ? { cloned_by: d.cloned_by } : {}),
      ...(d.seed ? { seed: d.seed } : {}),
    })),
    count: designs.length,
    ...(scanned > designs.length ? { scanned, showing: designs.length } : {}),
    ...(unreadable ? { unreadable } : {}),
    distinct: Object.fromEntries(AXES.map(a => [a, new Set(designs.map(d => d.signature[a])).size])),
    // The never-produced readings ride on `direction` only, where they are
    // scoped to the traits actually being varied. Repeating all of them on
    // every settled trait triples this reply for nothing — and an expensive
    // read is what sent the review's author back to 20 full-size previews.
    saturated: saturated.map(({ unused: _unused, ...row }) => row),
    // A trait missing from `saturated` because nobody could have chosen it is
    // said out loud. Silence would read as "that one varies", which is the
    // opposite of the truth.
    ...(blind ? { not_evidence: blind } : {}),
    direction,
    ...(seeds ? { seed_check: seeds } : {}),
    ...(clones ? { deliberate_copies: clones } : {}),
    scope: 'STYLE only — structure, composition, palette, type scale. No copy, no colours as hexes: two designs matching here are the same design with different words.',
    progress, context: buildContext(op, `${designs.length} prior design(s) in ${path.basename(projectDir)}`),
  });
}
