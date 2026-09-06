import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { expandShorthand } from './shorthand-expand';
import type { ShorthandLayer } from './shorthand-helpers';

// The guide is the door the MODEL walks through, and nothing checked it against
// the engine. Found live: the guide recommends `newsletter` by name ("a
// newsletter / bulletin → newsletter"), gives its height multiplier and
// describes its look — and documented no fields at all. A model reaching for
// `blocks`, the only multi-section shape the guide teaches, got:
//
//   add_layers -> success: true
//   4 of 7 content strings gone, a 326px masthead and nothing else
//
// newsletter/bulletin/digest, mindmap, value_list and ribbon_cards all take
// `items`. These tests keep the guide's promises and the engine's behaviour
// from drifting apart again.

const GUIDE = readFileSync('src/mcp/engine/guide.ts', 'utf8');

const expand = (sh: Record<string, unknown>): Record<string, unknown> =>
  expandShorthand({ id: 'x', pos: [0, 0, 1000, 1200], ...sh } as unknown as ShorthandLayer) as unknown as Record<string, unknown>;

/** Every string the expansion actually PAINTS — `_spec` records what was authored, so it proves nothing. */
const painted = (layer: unknown): string => JSON.stringify(layer, (k, v) =>
  (k.startsWith('_spec') || k.startsWith('_env') ? undefined : v));

describe('the guide names presets the engine really has', () => {
  // Layer types the guide writes as {type:"x" — its own examples.
  const named = [...new Set([...GUIDE.matchAll(/\{type:"([a-z_0-9]+)"/g)].map(m => m[1] ?? ''))];

  it('finds a decent sample of preset examples to check', () => {
    expect(named.length).toBeGreaterThan(15);
  });

  for (const type of named) {
    it(`{type:"${type}"} expands`, () => {
      const out = expand({ type, title: 'T', text: 'T', label: 'T', value: '1',
        items: [{ title: 'A', desc: 'B', icon: 'star' }],
        blocks: [{ kind: 'text', text: 'B' }] });
      expect(out).toBeTruthy();
      expect(out['type']).toBeTruthy();
    });
  }
});

// Each row of the alias table the guide publishes: the alias must accept the
// PRIMARY's documented field and actually paint it. Written after checking all
// eight live — every one passed, which is why the table can be stated as fact.
const ALIASES: [string, Record<string, unknown>, string][] = [
  ['bulletin',      { items: [{ title: 'ZQA', desc: 'ZQB' }] },                        'ZQA'],
  ['digest',        { items: [{ title: 'ZQA', desc: 'ZQB' }] },                        'ZQA'],
  ['infographic',   { title: 'T', blocks: [{ kind: 'text', text: 'ZQA' }] },           'ZQA'],
  ['document',      { title: 'T', blocks: [{ kind: 'text', text: 'ZQA' }] },           'ZQA'],
  ['report_poster', { title: 'T', blocks: [{ kind: 'text', text: 'ZQA' }] },           'ZQA'],
  ['flyer',         { title: 'T', details: ['ZQA'] },                                  'ZQA'],
  ['hero',          { title: 'T', details: ['ZQA'] },                                  'ZQA'],
  ['metric',        { stat: 'ZQA', caption: 'C' },                                     'ZQA'],
  ['big_number',    { stat: 'ZQA', caption: 'C' },                                     'ZQA'],
  ['plans',         { title: 'T', plans: [{ name: 'ZQA', price: '$9' }] },             'ZQA'],
  ['tiers',         { title: 'T', plans: [{ name: 'ZQA', price: '$9' }] },             'ZQA'],
  ['compare',       { title: 'T', a: { label: 'X' }, b: { label: 'Y' }, rows: [{ label: 'ZQA', a: '1', b: '2' }] }, 'ZQA'],
  ['steps',         { title: 'T', items: ['ZQA'] },                                    'ZQA'],
  ['checklist',     { title: 'T', items: ['ZQA'] },                                    'ZQA'],
  ['roadmap',       { title: 'T', items: [{ date: 'Q1', title: 'ZQA', desc: 'D' }] },  'ZQA'],
];

describe('the alias table the guide publishes is true', () => {
  for (const [alias, fields, sentinel] of ALIASES) {
    it(`${alias} paints the primary's field`, () => {
      expect(painted(expand({ type: alias, ...fields }))).toContain(sentinel);
    });
  }
});

// The four the guide now documents explicitly, because a model could not have
// guessed them: their content arrives in `items`, not `blocks`.
const ITEMS_PRESETS = ['newsletter', 'mindmap', 'value_list', 'ribbon_cards'];

describe('the presets that take items, not blocks', () => {
  for (const type of ITEMS_PRESETS) {
    it(`${type} paints its items`, () => {
      const out = expand({ type, title: 'T', center: 'T',
        items: [{ title: 'ZQONE', desc: 'ZQTWO' }] });
      const p = painted(out);
      expect(p).toContain('ZQONE');
      expect(p).toContain('ZQTWO');
    });

    it(`${type} carries a worked example that names items:`, () => {
      // The live failure was silent — blocks accepted, content dropped — so the
      // guard has to be on the EXAMPLE, not the name. Anchoring on the bare name
      // passed even with the example gutted, because the alias table mentions it
      // too; anchoring on `{type:"x"` is what actually fails when it goes.
      // Stop at the NEXT {type:"…" — a fixed-width window bled into the
      // following example, which also says items:, so a gutted newsletter block
      // still passed. Verified by mutation: replace this example's `items:` and
      // this test must fail.
      const example = GUIDE.match(new RegExp(`\\{type:"${type}"(?:(?!\\{type:")[\\s\\S]){0,600}`));
      expect(example, `no {type:"${type}"} example in the guide`).not.toBeNull();
      expect(example?.[0] ?? '', `the ${type} example must show items:`).toContain('items:');
    });
  }
});
