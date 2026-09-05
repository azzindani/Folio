// Folio MCP — what this project has already made.
//
// The review's A2, bounded novelty: "design novel within bounds ... memory
// past_specs + avoid/inspire ... verify via layout signature, retry if
// duplicate." The engine could not answer "what did I make last time", so every
// design was composed as if it were the first, and N of them converged.
//
// Two rules this module is built around:
//
//  1. It REPORTS, it does not choose. It can say four posters share a structure
//     and a palette; it must never hand back the fifth look. Picking the way out
//     is the model's job — an engine that answers "use a timeline in teal" is a
//     template-stamping engine, and §0.4's litmus says that makes outputs MORE
//     uniform, not less.
//
//  2. Sameness is not automatically a fault. A set of twelve monthly posters
//     SHOULD share a signature; that is the brief. So a match is only worth
//     raising when it was not asked for — and lineage already knows, because a
//     design cloned on purpose carries the op that cloned it.
import * as fs from 'fs';
import * as path from 'path';

import type { DesignSpec } from '../schema/types';
import type { Finding } from './engine/diagnose';
import { readYAML, resolveProjectPath } from './engine/utils';
import { readLineage } from './design-lineage';
import { designSignature, compareSignatures, type Signature, type Similarity } from './design-signature';

export interface PriorDesign {
  name: string;
  path: string;
  modified?: string;
  signature: Signature;
  /** The op that created it, when that op was a deliberate copy. */
  cloned_by?: string;
  /** The style seed it was authored under, when it was given one. Recorded so
   *  a seed can be CHECKED rather than believed: two designs made under
   *  different seeds that still sign identically prove the seed did nothing. */
  seed?: string;
}

/** Ops whose whole purpose is to produce something that looks the same. */
const CLONE_OPS = [/duplicate/i, /batch/i, /:clone/i];

/** The op that created this design, when that op was a deliberate copy. */
export function cloneOriginOf(designPath: string): string | undefined {
  const { records } = readLineage(designPath);
  const first = records[0];
  if (!first) return undefined;
  return CLONE_OPS.some(re => re.test(first.op)) ? first.op : undefined;
}

/** Every design in a project, signed. Reads files, so it is capped and the
 *  caller is told when it stopped short rather than being handed a partial
 *  answer that looks whole. */
export function readStyleHistory(
  projectDir: string, opts: { limit?: number; exclude?: string } = {},
): { designs: PriorDesign[]; scanned: number; unreadable: number } {
  const dir = path.join(projectDir, 'designs');
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter(n => n.endsWith('.design.yaml'));
  } catch { return { designs: [], scanned: 0, unreadable: 0 }; }

  const limit = Math.max(1, Math.min(opts.limit ?? 40, 200));
  const excl = opts.exclude ? path.resolve(opts.exclude) : '';
  const rows: { p: string; mtime: number }[] = [];
  for (const n of names) {
    const p = path.join(dir, n);
    if (excl && path.resolve(p) === excl) continue;
    let mtime = 0;
    try { mtime = fs.statSync(p).mtimeMs; } catch { /* keep it, ordered last */ }
    rows.push({ p, mtime });
  }
  rows.sort((a, b) => b.mtime - a.mtime);          // newest first: recency is what drifts

  const designs: PriorDesign[] = [];
  let unreadable = 0;
  for (const { p, mtime } of rows.slice(0, limit)) {
    try {
      const spec = readYAML<DesignSpec>(p);
      designs.push({
        name: spec.meta?.name ?? path.basename(p, '.design.yaml'),
        path: p,
        modified: mtime ? new Date(mtime).toISOString().split('T')[0] : undefined,
        signature: designSignature(spec),
        cloned_by: cloneOriginOf(p),
        ...(spec.meta?.style_seed ? { seed: String(spec.meta.style_seed) } : {}),
      });
    } catch { unreadable++; }
  }
  return { designs, scanned: rows.length, unreadable };
}

// ── Reading the history ─────────────────────────────────────

export type Axis = 'structure' | 'composition' | 'palette' | 'type_scale';
export const AXES: Axis[] = ['structure', 'composition', 'palette', 'type_scale'];

// ── Traits ──────────────────────────────────────────────────
//
// The four signature fields are what a design IS; a trait is one decision
// inside one of them. The difference matters when reporting where a project has
// stopped moving: "palette has settled" is true of a set that always uses a
// near-black ground with a different accent each time, and acting on it would
// be wrong. "ground has settled at dark-neutral in 6 of 6, accent has not" is
// the same measurement, said precisely enough to be useful.
//
// `readings` is the set of values the MEASURE can report — not a menu of looks.
// A reading this project has never produced is a gap in its own catalogue, and
// that is all the reply ever claims it is.

export type Trait = 'structure' | 'measure' | 'band' | 'anchor' | 'ground' | 'accent' | 'scale' | 'ratio';

const TONES = ['dark', 'mid', 'light'], TEMPS = ['neutral', 'warm', 'cool'];
const GROUNDS = TONES.flatMap(t => TEMPS.map(w => `${t}-${w}`));
const ACCENTS = ['mono', 'red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'azure', 'blue', 'violet', 'magenta', 'rose'];

const field = (v: string, i: number): string => v.split('/')[i] ?? '?';

export const TRAITS: { key: Trait; of: (s: Signature) => string; means: string; readings: string[] }[] = [
  { key: 'structure', of: s => s.structure,             means: 'what the design is built from',        readings: [] },
  { key: 'measure',   of: s => field(s.composition, 0), means: 'which thirds of the width carry ink',  readings: ['100', '010', '001', '110', '011', '101', '111'] },
  { key: 'band',      of: s => field(s.composition, 1), means: 'where the content sits vertically',    readings: ['top', 'mid', 'low', 'full'] },
  { key: 'anchor',    of: s => field(s.composition, 2), means: 'what the composition hangs off',       readings: ['left', 'center', 'right'] },
  { key: 'ground',    of: s => field(s.palette, 0),     means: 'tone and temperature of the page',     readings: GROUNDS },
  { key: 'accent',    of: s => field(s.palette, 1),     means: 'the hue family doing the work',        readings: ACCENTS },
  { key: 'scale',     of: s => field(s.type_scale, 0),  means: 'how loud the headline is',             readings: ['s', 'm', 'l', 'xl', 'mega'] },
  { key: 'ratio',     of: s => field(s.type_scale, 1),  means: 'headline against body',                readings: ['flat', '2x', '3x', '4x+'] },
];

/** How often each trait has taken each of its readings — the raw material for a
 *  model's own decision about where there is room to move. */
export function traitCounts(designs: PriorDesign[]): Record<Trait, Record<string, number>> {
  const out = {} as Record<Trait, Record<string, number>>;
  for (const t of TRAITS) {
    const counts: Record<string, number> = {};
    for (const d of designs) {
      const v = t.of(d.signature);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    out[t.key] = counts;
  }
  return out;
}

export interface SettledTrait {
  trait: Trait;
  means: string;
  value: string;
  count: number;
  of: number;
  /** Readings the measure can report that this project never has. Empty for
   *  structure, which has no fixed set of readings to be missing from. */
  unused: string[];
}

/** Traits where this project has stopped varying.
 *
 *  Phrased as an observation with its evidence, never as an instruction: the
 *  reply says "every one of 6 designs is dark-neutral", and the model decides
 *  whether that is a house style or a rut. */
export function saturatedAxes(designs: PriorDesign[], minRun = 3): SettledTrait[] {
  if (designs.length < minRun) return [];
  const counts = traitCounts(designs);
  const out: SettledTrait[] = [];
  for (const t of TRAITS) {
    for (const [value, count] of Object.entries(counts[t.key])) {
      if (count < minRun || count < designs.length * 0.8) continue;
      out.push({
        trait: t.key, means: t.means, value, count, of: designs.length,
        unused: t.readings.filter(r => !(r in counts[t.key])),
      });
    }
  }
  return out.sort((x, y) => y.count - x.count || x.trait.localeCompare(y.trait));
}

export interface SeedCheck {
  distinct_seeds: number;
  unseeded: number;
  /** Pairs authored under DIFFERENT seeds that still sign as one design. */
  ineffective: { a: string; b: string; seeds: [string, string] }[];
  note: string;
}

/** Did the seeds actually do anything?
 *
 *  A seed asks for a departure; nothing about asking makes it happen. Two
 *  designs made under different seeds that still sign as one design are proof
 *  the departure was not taken — which is worth reporting, because the
 *  alternative is a knob everyone trusts and no one measures. Null when there
 *  are fewer than two seeds to compare, since there is nothing to check. */
export function seedCheck(designs: PriorDesign[]): SeedCheck | null {
  const seeded = designs.filter(d => d.seed);
  const seeds = new Set(seeded.map(d => d.seed));
  if (seeds.size < 2) return null;
  const ineffective: { a: string; b: string; seeds: [string, string] }[] = [];
  for (let i = 0; i < seeded.length; i++) {
    for (let j = i + 1; j < seeded.length; j++) {
      const [x, y] = [seeded[i], seeded[j]];
      if (x.seed === y.seed) continue;
      if (compareSignatures(x.signature, y.signature).verdict !== 'duplicate') continue;
      ineffective.push({ a: x.name, b: y.name, seeds: [x.seed as string, y.seed as string] });
    }
  }
  return {
    distinct_seeds: seeds.size,
    unseeded: designs.length - seeded.length,
    ineffective: ineffective.slice(0, 6),
    note: ineffective.length
      ? `${ineffective.length} pair(s) were authored under DIFFERENT seeds and still sign as one design — the seed was passed, the departure was not made. A seed names where the room is; taking it is the composing step's job.`
      : 'Every pair of designs made under different seeds signs differently. The seeds are doing what they were passed for.',
  };
}

export interface EchoFinding {
  of: PriorDesign;
  similarity: Similarity;
  /** True when the match was asked for — a clone, or a deliberate set. */
  intentional: boolean;
  message: string;
}

/** Does this design already exist in the project under another name?
 *
 *  Returns the closest prior design when the two are near enough to read as one
 *  design, and states which traits they share so the caller knows which axis is
 *  still free. */
export function findEcho(sig: Signature, prior: PriorDesign[], selfClonedBy?: string): EchoFinding | null {
  let best: EchoFinding | null = null;
  for (const of of prior) {
    const similarity = compareSignatures(sig, of.signature);
    if (similarity.verdict === 'distinct') continue;
    if (best && similarity.distance >= best.similarity.distance) continue;
    const intentional = Boolean(selfClonedBy ?? of.cloned_by);
    const shared = similarity.shared.join(' + ') || 'nothing';
    best = {
      of, similarity, intentional,
      message: intentional
        ? `Shares ${shared} with "${of.name}" — deliberately: it was made by ${selfClonedBy ?? of.cloned_by}.`
        : similarity.verdict === 'duplicate'
          ? `This is "${of.name}" with different words — same ${shared}. Different copy is not a different design.`
          : `Close to "${of.name}" — same ${shared}; only ${similarity.differs.join(' + ') || 'nothing'} differs.`,
    };
  }
  return best;
}

/** The echo as a diagnose finding.
 *
 *  Always a SUGGESTION, never an error or a warning: the engine can see that
 *  two designs match but not whether that was the brief, and a lint that calls
 *  a deliberate set a defect is the "diagnose that lies" problem in a new
 *  costume. It is also, deliberately, not in heal's repairable set — the fix is
 *  a different design, and choosing one is the model's job.
 *
 *  Capped and silent on any failure: a diagnosis must not break because a
 *  neighbouring file will not parse. */
export function echoFinding(spec: DesignSpec, designPath: string, projectPath?: string): Finding | null {
  try {
    const projectDir = projectPath ? resolveProjectPath(projectPath) : path.dirname(path.dirname(designPath));
    const { designs } = readStyleHistory(projectDir, { limit: 24, exclude: designPath });
    if (designs.length === 0) return null;
    const hit = findEcho(designSignature(spec), designs, cloneOriginOf(designPath));
    if (!hit || hit.intentional) return null;
    return {
      code: hit.similarity.verdict === 'duplicate' ? 'design_duplicate' : 'design_echo',
      severity: 'suggestion',
      message: hit.message,
      fix: `Vary ${hit.similarity.shared.join(' or ')} — that is what the two share; different copy will not separate them. manage_design {op:"style_history"} shows the whole project's pattern.`,
    };
  } catch { return null; }
}
