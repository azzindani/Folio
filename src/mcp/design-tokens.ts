// Folio MCP — design tokens: colour by ROLE, not by literal.
//
// The gap this closes is stated in Folio's own tool description: "apply sets the
// PROJECT default; it does NOT recolor an existing design's baked-in hexes."
// Across 267 stored designs, ZERO used a token. One deck bakes the same accent
// #FF5C8A sixty times, plus #662537, #8c334c and #fbd6d8 — shades DERIVED from
// it, then frozen. So "make the accent cooler" is a sixty-site find-and-replace
// that still leaves three wrong shades behind, because the relationship between
// them and the accent no longer exists anywhere. That is what "design from rects"
// means in practice, and why a theme could not restyle anything.
//
// The fix is not a new colour syntax. A preset's `_spec` ALREADY names colour by
// role — bg, accent, text_color, muted — so the roles are recoverable, and
// re-expanding from the spec RE-DERIVES every shade instead of carrying a frozen
// copy. A design therefore gets one small `tokens` table as its palette of
// record, and changing a role rewrites the specs and rebuilds their layers:
//
//     tokens.accent = "#0EA5E9"   →  specs updated  →  presets re-expanded
//                                 →  derived shades recomputed, not stale
//
// Hand-placed layers have no spec to re-derive from, so their literal use of the
// OLD value is swapped for the new one — a true statement about what can and
// cannot be done, not a silent partial job.
import type { DesignSpec, Layer } from '../schema/types';

import { specOf, SPEC_FIELD } from './design-spec';

/** The semantic roles a preset spec already names. Order is the order they are
 *  reported in — background first, then the colour that carries meaning. */
export const TOKEN_ROLES = ['bg', 'accent', 'text', 'muted', 'card_fill', 'panel'] as const;
export type TokenRole = typeof TOKEN_ROLES[number];

/** Spec field(s) each role is written as. A model may reach for either name,
 *  and presets read both, so a role has to own all of its aliases. */
const ROLE_FIELDS: Record<TokenRole, string[]> = {
  bg: ['bg'],
  accent: ['accent'],
  text: ['text_color', 'color'],
  muted: ['muted'],
  card_fill: ['card_fill'],
  panel: ['panel_fill', 'panel'],
};

/** A design's palette of record. */
export type TokenTable = Partial<Record<TokenRole, string>>;

/** Where a colour actually appears, so a change is never a blind swap. */
export interface TokenUsage {
  role: TokenRole;
  value: string;
  /** Preset specs naming this role at this value. */
  specs: string[];
  /** Literal uses of the value on layers with no spec to re-derive from. */
  literal_layers: number;
}

// ── Reading ─────────────────────────────────────────────────

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const norm = (v: unknown): string | null => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : null);

/** Every page's layers. */
function allSurfaces(design: DesignSpec): Layer[][] {
  if (design.pages?.length) return design.pages.map(p => p.layers ?? []);
  return [design.layers ?? []];
}

/** Read a role's value off one spec, trying each alias in order. */
function roleValue(spec: Record<string, unknown>, role: TokenRole): string | null {
  for (const f of ROLE_FIELDS[role]) {
    const v = norm(spec[f]);
    if (v) return v;
  }
  return null;
}

/** Count literal uses of a colour on layers that carry NO spec — the ones a
 *  role change cannot re-derive and must swap by value instead. */
function countLiteral(layers: Layer[], value: string, out: { n: number }, insideSpec = false): void {
  for (const l of layers) {
    const o = l as unknown as Record<string, unknown>;
    const owned = insideSpec || Boolean(o[SPEC_FIELD]);
    if (!owned) {
      const seen = new Set<string>();
      collectColors(o, seen);
      if (seen.has(value)) out.n++;
    }
    const kids = o['layers'];
    if (Array.isArray(kids)) countLiteral(kids as Layer[], value, out, owned);
  }
}

/** Every hex string anywhere in a layer object (fill, stroke, style, effects). */
function collectColors(node: unknown, out: Set<string>, depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 6) return;
  if (Array.isArray(node)) { for (const v of node) collectColors(v, out, depth + 1); return; }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'layers') continue;
    const hex = norm(v);
    if (hex) { out.add(hex); continue; }
    if (v && typeof v === 'object') collectColors(v, out, depth + 1);
  }
}

/** Read a design's palette of record: the stored table when it has one, else
 *  what its preset specs say — the roles were always there, just never named. */
export function collectTokens(design: DesignSpec): { table: TokenTable; usage: TokenUsage[] } {
  const stored = ((design as unknown as Record<string, unknown>)['tokens'] ?? {}) as TokenTable;
  const votes = new Map<TokenRole, Map<string, string[]>>();

  for (const layers of allSurfaces(design)) {
    const walk = (ls: Layer[]): void => {
      for (const l of ls) {
        const s = specOf(l);
        if (s) {
          for (const role of TOKEN_ROLES) {
            const v = roleValue(s.spec, role);
            if (!v) continue;
            const byValue = votes.get(role) ?? new Map<string, string[]>();
            byValue.set(v, [...(byValue.get(v) ?? []), String((l as unknown as Record<string, unknown>)['id'] ?? '')]);
            votes.set(role, byValue);
          }
          continue;                                  // children are generated output
        }
        const kids = (l as unknown as Record<string, unknown>)['layers'];
        if (Array.isArray(kids)) walk(kids as Layer[]);
      }
    };
    walk(layers);
  }

  const table: TokenTable = { ...stored };
  const usage: TokenUsage[] = [];
  for (const role of TOKEN_ROLES) {
    const byValue = votes.get(role);
    // The stored table wins — it is what the design DECLARES. Otherwise the most
    // used value for the role is the de-facto token.
    const winner = stored[role]?.toLowerCase()
      ?? [...(byValue?.entries() ?? [])].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
    if (!winner) continue;
    table[role] = winner;
    const lit = { n: 0 };
    for (const layers of allSurfaces(design)) countLiteral(layers, winner, lit);
    usage.push({ role, value: winner, specs: byValue?.get(winner) ?? [], literal_layers: lit.n });
  }
  return { table, usage };
}

// ── Writing ─────────────────────────────────────────────────

/** What a retokenize actually did. */
export interface RetokenizeResult {
  /** Roles whose value changed, as "role: old → new". */
  changed: string[];
  /** Preset groups re-expanded, so their derived shades recomputed. */
  respecced: number;
  /** Hand-placed layers whose literal use of the old value was swapped. */
  swapped: number;
  notes: string[];
}

/** Replace a colour literal wherever it appears in a layer object. Used only
 *  for layers with NO spec: they have no derivation to re-run, so a value swap
 *  is the honest most that can be done for them. */
function swapLiteral(node: unknown, from: string, to: string, count: { n: number }, depth = 0): boolean {
  if (!node || typeof node !== 'object' || depth > 6) return false;
  let hit = false;
  if (Array.isArray(node)) {
    for (const v of node) if (swapLiteral(v, from, to, count, depth + 1)) hit = true;
    return hit;
  }
  const o = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (k === 'layers') continue;
    if (norm(v) === from) { o[k] = to; hit = true; continue; }
    if (v && typeof v === 'object' && swapLiteral(v, from, to, count, depth + 1)) hit = true;
  }
  return hit;
}

/** Set one or more roles across a whole design.
 *
 *  A preset is UPDATED AT ITS SPEC and rebuilt, which is the point: the builders
 *  derive their tints, rules and scrims from the role colours, so re-expanding
 *  recomputes every one of them. Freezing a new hex into thirty layers would
 *  leave the old derived shades behind, which is exactly the state this module
 *  exists to end. */
export function retokenize(
  design: DesignSpec,
  set: TokenTable,
  reexpand: (layer: Layer, specPatch: Record<string, unknown>) => Layer | null,
): RetokenizeResult {
  const { table } = collectTokens(design);
  const out: RetokenizeResult = { changed: [], respecced: 0, swapped: 0, notes: [] };

  const wanted: [TokenRole, string, string][] = [];
  for (const role of TOKEN_ROLES) {
    const next = norm(set[role]);
    if (!next) continue;
    const prev = table[role]?.toLowerCase();
    if (!prev) { out.notes.push(`No "${role}" was in use on this design, so there was nothing to change — set it on the preset spec instead (edit_layer {op:"patch_spec", changes:{${ROLE_FIELDS[role][0]}:"${set[role]}"}}).`); continue; }
    if (prev === next) continue;
    wanted.push([role, prev, next]);
  }
  if (wanted.length === 0) return out;

  for (const layers of allSurfaces(design)) {
    const walk = (ls: Layer[], insideSpec = false): void => {
      for (let i = 0; i < ls.length; i++) {
        const l = ls[i];
        const o = l as unknown as Record<string, unknown>;
        const s = specOf(l);
        if (s) {
          // Patch every role this spec names at the OLD value, then rebuild.
          const patch: Record<string, unknown> = {};
          for (const [role, prev, next] of wanted) {
            for (const f of ROLE_FIELDS[role]) if (norm(s.spec[f]) === prev) patch[f] = next;
          }
          if (Object.keys(patch).length) {
            const rebuilt = reexpand(l, patch);
            if (rebuilt) { ls[i] = rebuilt; out.respecced++; continue; }
            out.notes.push(`Preset "${o['id']}" would not rebuild, so its colours were swapped literally — its derived shades may not match the new palette. edit_layer {op:"patch_spec"} on it to see the error.`);
          }
        }
        const owned = insideSpec || Boolean(o[SPEC_FIELD]);
        if (!owned) {
          const c = { n: 0 };
          let hit = false;
          for (const [, prev, next] of wanted) if (swapLiteral(o, prev, next, c)) hit = true;
          if (hit) out.swapped++;
        }
        const kids = o['layers'];
        if (Array.isArray(kids)) walk(kids as Layer[], owned);
      }
    };
    walk(layers);
  }

  const next: TokenTable = { ...table };
  for (const [role, prev, val] of wanted) { next[role] = val; out.changed.push(`${role}: ${prev} → ${val}`); }
  (design as unknown as Record<string, unknown>)['tokens'] = next;
  return out;
}
