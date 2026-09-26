/**
 * Compact YAML for design files (phase 3, S8 — "efficient YAML").
 *
 * js-yaml writes every mapping as a block, so one style object took six lines,
 * a keyframe four, a gallery row five, and a 30-layer motion piece ran past
 * 1,600 lines — most of them a key and a number. Here the structure stays
 * block-style, but any mapping or sequence whose one-line flow form fits
 * (a style, a fill, a keyframe, a gallery row, a small layer) is written on
 * one line. The document parses to exactly the same data (tested on every
 * benchmark design); only its shape on disk changes.
 */

import yaml from 'js-yaml';

/**
 * A line's longest flow form, indent included. 240, not 160: across the 33
 * benchmark designs 240 writes 29% fewer lines (and 3% fewer bytes) — a
 * design file is read by a model first, and a newline + indent per key is the
 * structure it pays for.
 */
const WIDTH = 240;
/** The tree's structure: always a block list, one entry per line or more. */
const BLOCK_KEYS = new Set(['layers', 'pages', 'template']);

type Node = unknown;
const isMap = (v: Node): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** js-yaml's one-line flow form of a node (it quotes keys and scalars itself). */
const flow = (v: Node): string => yaml.dump(v, { flowLevel: 0, lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd();

/**
 * A scalar entry (`key: value`) or item (`- value`) as js-yaml writes it, moved
 * to `indent` whole: a multi-line string's block, and any indentation
 * indicator on it, stay relative to its own key.
 */
const scalarLines = (entry: Record<string, unknown> | unknown[], indent: string): string[] =>
  yaml.dump(entry, { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd().split('\n').map(l => indent + l);

/** Whether a node may go on one line: flow form short enough, and no multi-line string inside. */
function fits(v: Node, room: number): string | null {
  if (!isMap(v) && !Array.isArray(v)) return null;
  const f = flow(v);
  return f.includes('\n') || f.length > room ? null : f;
}

function emit(v: Node, indent: string, out: string[]): void {
  if (isMap(v)) {
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) continue;
      const key = flow(k);
      const head = `${indent}${key}:`;
      const one = BLOCK_KEYS.has(k) && Array.isArray(val) && val.length ? null : fits(val, WIDTH - head.length - 1);
      if (one !== null) { out.push(`${head} ${one}`); continue; }
      if (isMap(val) || Array.isArray(val)) {
        if (isMap(val) && !Object.keys(val).length) { out.push(`${head} {}`); continue; }
        if (Array.isArray(val) && !val.length) { out.push(`${head} []`); continue; }
        out.push(head);
        emit(val, Array.isArray(val) ? indent : `${indent}  `, out);
        continue;
      }
      out.push(...scalarLines({ [k]: val }, indent));
    }
    return;
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const one = fits(item, WIDTH - indent.length - 2);
      if (one !== null) { out.push(`${indent}- ${one}`); continue; }
      if (isMap(item) || Array.isArray(item)) {
        // The item's first line shares the dash; the rest sit under it.
        const inner: string[] = [];
        emit(item, `${indent}  `, inner);
        const [first = '', ...rest] = inner;
        out.push(`${indent}- ${first.slice(indent.length + 2)}`, ...rest);
        continue;
      }
      out.push(...scalarLines([item], indent));
    }
  }
}

/** A design (or any plain data) as compact YAML text. */
export function compactYAML(data: unknown): string {
  if (!isMap(data) && !Array.isArray(data)) return yaml.dump(data, { noRefs: true });
  const out: string[] = [];
  emit(data, '', out);
  return `${out.join('\n')}\n`;
}
