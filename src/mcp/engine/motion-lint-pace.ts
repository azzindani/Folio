/**
 * Pacing a viewer feels, not reads off a timeline: where lines land at once
 * with nothing to say which comes first, and stretches that never hold still.
 *
 *   crowd     Three or more sentences landing in the same instant. A stagger
 *             of even 80 ms gives the eye an order; landing together, the
 *             viewer picks one and the others are skimmed. Lines only count
 *             when this shot brought them in — words already on a still
 *             opening frame are a layout, read by its hierarchy.
 *   restless  Something always moving for seconds on end: every rest shorter
 *             than a second. Slow drifts and ambient loops are not counted;
 *             they are what a rest looks like in a living scene.
 *
 * The engine measures and says when; the fix is the designer's.
 */

import type { LintNote } from './motion-lint';

/** Lines landing within this many ms of each other land together (two frames at 30 fps). */
const TOGETHER_MS = 60;
/** A sentence, not a label: this many words. */
const SENTENCE_WORDS = 3;
const CROWD = 3;
/** Stillness the eye needs to land, and how long it can go without. */
const REST_MS = 1000;
const RESTLESS_MS = 4000;

/** A text a shot shows: its words, the line it is a piece of (itself when whole), when it lands, and whether this shot brought it in. */
export interface Shown { id: string; text: string; block: string; settle: number; x: number; y: number; entered: boolean }
/** A line as a viewer reads it. */
export interface ReadLine { id: string; words: number; settle: number; x: number; y: number; entered: boolean }

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;
/** Letters per word, for a line split into letters (the pieces carry no spaces). */
const LETTERS_PER_WORD = 5;

/**
 * What a viewer reads, from what a shot shows. The pieces of a split line are
 * ONE line — its words, landed when its last piece lands — and words already
 * being read are not read again: an RGB ghost, or the whole-line echo behind a
 * split title. Found in the A4 sweep: a letter-split title read as thirteen
 * one-word lines put its ghost 3.7 s down the reading order.
 */
export function readingLines(shown: Shown[]): ReadLine[] {
  const blocks = new Map<string, Shown[]>();
  for (const s of shown) blocks.set(s.block, [...(blocks.get(s.block) ?? []), s]);
  const lines = [...blocks].map(([block, parts]) => {
    const ordered = [...parts].sort((a, b) => a.y - b.y || a.x - b.x);
    const letters = ordered.every(p => [...p.text.trim()].length <= 1);
    const text = ordered.map(p => p.text.trim()).join(letters ? '' : ' ');
    return {
      id: parts.length > 1 ? block : ordered[0]?.id ?? block,
      words: letters && parts.length > 1 ? Math.max(1, Math.round([...text].length / LETTERS_PER_WORD)) : wordCount(text),
      settle: Math.max(...parts.map(p => p.settle)),
      x: Math.min(...parts.map(p => p.x)), y: Math.min(...parts.map(p => p.y)),
      entered: parts.some(p => p.entered),
      key: text.toLowerCase().replace(/\s+/g, ''),
    };
  }).sort((a, b) => a.settle - b.settle || a.y - b.y || a.x - b.x);
  const read = new Set<string>();
  return lines.filter(l => !read.has(l.key) && Boolean(read.add(l.key))).map(({ key: _key, ...l }) => l);
}

/** Shots where CROWD or more separate sentences land in the same instant. */
export function crowdNotes(shots: Array<{ shot: string; lines: ReadLine[] }>): LintNote[] {
  const notes: LintNote[] = [];
  for (const { shot, lines } of shots) {
    const said = lines.filter(l => l.entered && l.words >= SENTENCE_WORDS).sort((a, b) => a.settle - b.settle);
    let run: ReadLine[] = [];
    const flush = (): void => {
      if (run.length >= CROWD) {
        const at = run[0]?.settle ?? 0, ids = run.map(r => r.id);
        notes.push({ kind: 'crowd', shot, at_ms: at, layers: ids.slice(0, 8),
          note: `In "${shot}", ${run.length} lines land together at ${at}ms (${ids.slice(0, 5).map(i => `"${i}"`).join(', ')}${ids.length > 5 ? ', …' : ''}) — nothing says which to read first. Stagger them 80–200 ms in the order they should be read, or let the headline land before the rest.` });
      }
    };
    for (const l of said) {
      const last = run[run.length - 1];
      if (last && l.settle - last.settle > TOGETHER_MS) { flush(); run = []; }
      run.push(l);
    }
    flush();
  }
  return notes;
}

/** Stretches of RESTLESS_MS or more in which nothing ever holds still for REST_MS. */
export function restlessNotes(moves: Array<{ start: number; end: number }>): LintNote[] {
  const spans = [...moves].filter(m => m.end > m.start).sort((a, b) => a.start - b.start);
  const notes: LintNote[] = [];
  let from = spans[0]?.start ?? 0, reach = from;
  const close = (): void => {
    if (reach - from >= RESTLESS_MS) {
      notes.push({ kind: 'restless', at_ms: Math.round(from),
        note: `From ${Math.round(from)} to ${Math.round(reach)}ms (${((reach - from) / 1000).toFixed(1)} s) something is always moving — no rest of ${REST_MS / 1000} s anywhere in it for the eye to land. Let a beat land and hold before the next move, or slow the background to a drift.` });
    }
  };
  for (const m of spans) {
    if (m.start - reach >= REST_MS) { close(); from = m.start; }
    reach = Math.max(reach, m.end);
  }
  if (spans.length) close();
  return notes;
}
