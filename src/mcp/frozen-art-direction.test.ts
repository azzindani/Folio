import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProject, createDesign, addLayers, patchDesignSpec } from './engine';
import { readYAML } from './engine/utils';
import { seededDefaults } from './shorthand-helpers';
import type { DesignSpec, Layer } from '../schema/types';

// The art direction for a preset with no explicit `bg` is seeded from the
// design's own COPY — right the first time, wrong every time after. Editing any
// text field re-rolled it, so patching one kicker five times gave five designs:
//
//   after add    bg #F3EEF6 accent #7A3FA0   (light lilac)
//   after edit 1 bg #14100A accent #FFB000   (near-black gold)
//   after edit 2 bg #F4F1EA accent #1F4FD8   (light blue)
//   after edit 3 bg #08140F accent #34C77B   (dark green)
//   after edit 4 bg #F2F0E6 accent #3E7C5A   (light green)
//   after edit 5 bg #EDE7DD accent #A8432A   (light terracotta)
//
// The seed could not just be made stable: that changes what every NEW design
// looks like, and "two topics render differently" is the point of seeding. So
// the DECISION is frozen, not the inputs — picked from content exactly as
// before on the first expansion, remembered, reused after.

let dir = '';
let proj = '';

const SPEC = {
  type: 'sections',
  title: 'Ship it on Friday',
  subtitle: 'A short guide to release trains',
  kicker: 'ENGINEERING',
  blocks: [
    { type: 'heading_text', heading: 'Cut the branch', text: 'Freeze on Wednesday so the tests have a day.' },
    { type: 'callout', label: 'Rule', text: 'No release without a rollback.' },
  ],
};

function build(name: string, width = 1080, height = 1350, theme?: string): string {
  createDesign({ project_path: proj, name, type: 'poster', width, height, ...(theme ? { theme } : {}) } as never);
  const dp = path.join(proj, `designs/${name}.design.yaml`);
  addLayers({ design_path: dp, layers_shorthand: [SPEC] as never } as never);
  return dp;
}

/** The frozen art direction stored on the preset group, if any. */
function art(dp: string): { bg?: string; accent?: string; bg_style?: string } | null {
  let found: { bg?: string; accent?: string; bg_style?: string } | null = null;
  const walk = (ls?: Layer[]): void => {
    for (const l of ls ?? []) {
      const o = l as unknown as Record<string, unknown>;
      const env = o['_spec_env'] as Record<string, unknown> | undefined;
      const a = env?.['__art'] as Record<string, unknown> | undefined;
      if (a) {
        const m = (a['mood'] ?? {}) as Record<string, unknown>;
        found = { bg: String(m['bg']), accent: String(m['accent']), bg_style: String(a['bg_style']) };
      }
      if (Array.isArray(o['layers'])) walk(o['layers'] as Layer[]);
    }
  };
  walk(readYAML<DesignSpec>(dp).layers);
  return found;
}

const specLayerId = (dp: string): string => {
  let id = '';
  const walk = (ls?: Layer[]): void => {
    for (const l of ls ?? []) {
      const o = l as unknown as Record<string, unknown>;
      if (o['_spec'] && !id) id = String(o['id']);
      if (Array.isArray(o['layers'])) walk(o['layers'] as Layer[]);
    }
  };
  walk(readYAML<DesignSpec>(dp).layers);
  return id;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-art-'));
  proj = path.join(dir, 'p');
  createProject({ name: 'P', path: proj } as never);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('editing the copy no longer re-rolls the art direction', () => {
  it('five edits to one field leave the palette alone', () => {
    const dp = build('mood');
    const first = art(dp);
    expect(first?.bg, 'nothing was frozen at all').toBeTruthy();
    const id = specLayerId(dp);
    for (let i = 1; i <= 5; i++) {
      patchDesignSpec({ design_path: dp, layer_id: id, changes: { kicker: `ENGINEERING ${i}` } } as never);
      expect(art(dp), `flipped on edit ${i}`).toEqual(first);
    }
  });

  it('and the edit still lands', () => {
    const dp = build('lands');
    const id = specLayerId(dp);
    patchDesignSpec({ design_path: dp, layer_id: id, changes: { kicker: 'RELEASES' } } as never);
    expect(JSON.stringify(readYAML<DesignSpec>(dp))).toContain('RELEASES');
  });

  it('freezes the background GEOMETRY too, not just the colours', () => {
    const dp = build('geo');
    const before = art(dp)?.bg_style;
    expect(before).toBeTruthy();
    patchDesignSpec({ design_path: dp, layer_id: specLayerId(dp), changes: { title: 'A different headline entirely' } } as never);
    expect(art(dp)?.bg_style).toBe(before);
  });
});

describe('what must NOT change', () => {
  it('the first expansion is still seeded from the content', () => {
    // Two different topics must still land on different art. Freezing the
    // decision must not flatten every new design onto one look — that is the
    // failure this whole mechanism exists to avoid.
    const a = build('topica');
    createDesign({ project_path: proj, name: 'topicb', type: 'poster', width: 1080, height: 1350 } as never);
    const bPath = path.join(proj, 'designs/topicb.design.yaml');
    addLayers({ design_path: bPath, layers_shorthand: [{
      type: 'sections', title: 'Deep sea vents', subtitle: 'Life without sunlight', kicker: 'ABYSSAL',
      blocks: [{ type: 'heading_text', heading: 'Chemosynthesis', text: 'Energy from sulphur, not light.' }],
    }] as never } as never);
    expect(art(a)?.bg).not.toBe(art(bPath)?.bg);
  });

  it('an explicit bg still wins outright — nothing is frozen over it', () => {
    expect(seededDefaults({ bg: '#123456', title: 'x' }, ['x'])).toBeNull();
  });

  it('the frozen mood is the RAW pick, so a theme can still override polarity', () => {
    // Only the content-seeded roll is frozen. The theme keeps its authority over
    // light/dark, or a light theme could come back dark for ever.
    const r: Record<string, unknown> = { title: 'Ship it on Friday', kicker: 'ENGINEERING' };
    const dark = seededDefaults(r, ['Ship it on Friday', 'ENGINEERING']);
    expect(dark).not.toBeNull();
    const frozen = r['__art'] as { mood: { bg: string } };
    expect(frozen?.mood?.bg).toBeTruthy();
    // Re-run with a theme whose polarity fights the frozen mood.
    const themed = seededDefaults(
      { ...r, __theme: { bg: '#0A0A0A', text: '#FAFAFA' } },
      ['Ship it on Friday', 'ENGINEERING'],
    );
    const themedLight = seededDefaults(
      { ...r, __theme: { bg: '#FFFFFF', text: '#111111' } },
      ['Ship it on Friday', 'ENGINEERING'],
    );
    expect(themed?.bg).not.toBe(themedLight?.bg);
  });

  it('a malformed stored art direction is ignored, not half-applied', () => {
    for (const bad of [null, 'nope', {}, { mood: {}, bg_style: 'x' }, { mood: { bg: '#fff' }, bg_style: 'x' }]) {
      const m = seededDefaults({ __art: bad, title: 'Ship it' }, ['Ship it']);
      expect(m?.bg, JSON.stringify(bad)).toMatch(/^#/);
      expect(m?.accent).toMatch(/^#/);
    }
  });
});
