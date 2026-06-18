import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addLayers } from './engine-layer-tools';
import { writeYAML, readYAML } from './engine/utils';
import { hexToRgb, luminance } from './engine/reference';
import type { DesignSpec } from '../schema/types';

// A content-seeded "mood" used to ignore the design's theme: an AI/tech topic
// seeds a DARK indigo mood, so a `light-clean` poster came back on a dark
// gradient ("that is not a light theme"). seededDefaults now reconciles the
// mood's light/dark polarity with the chosen theme. These drive the real
// add_layers pipeline end-to-end.

// AI/tech content → the "indigo tech" dark mood lane.
const SECTIONS = [{
  type: 'sections', kicker: 'AI Design Proof',
  title: 'Can AI Create Designs Without Vision?',
  subtitle: 'Folio MCP enables LLMs to generate professional graphics through structured YAML.',
  blocks: [
    { kind: 'stats', items: [{ value: '5', label: 'Minutes' }, { value: '49', label: 'MCP Tools' }] },
    { kind: 'heading_text', heading: 'From Hours to Minutes', body: 'Traditional design takes hours; Folio MCP composes and exports in minutes.' },
  ],
}];

function firstBgColor(spec: DesignSpec): string {
  let color = '';
  const walk = (ls: unknown[]): void => {
    for (const l of ls as Record<string, unknown>[]) {
      if (l && String(l['id']).includes('_bg')) {
        const f = l['fill'] as Record<string, unknown> | undefined;
        const stops = f?.['stops'] as { color: string }[] | undefined;
        color = stops?.[0]?.color ?? String(f?.['color'] ?? '');
      }
      if (Array.isArray(l['layers'])) walk(l['layers'] as unknown[]);
    }
  };
  walk(spec.layers as unknown[]);
  return color;
}

function bgLuminance(themeRef: string, shorthand: unknown = SECTIONS): number {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-rec-'));
  try {
    const spec0 = {
      _protocol: 'design/v1', meta: { id: 't', name: 't', type: 'poster' },
      document: { width: 1080, height: 1350, unit: 'px', dpi: 96 },
      theme: { ref: themeRef }, layers: [],
    } as unknown as DesignSpec;
    const p = path.join(dir, 't.design.yaml');
    writeYAML(p, spec0);
    addLayers({ design_path: p, layers_shorthand: JSON.parse(JSON.stringify(shorthand)) as never });
    const spec = readYAML(p) as DesignSpec;
    const rgb = hexToRgb(firstBgColor(spec));
    expect(rgb).not.toBeNull();
    return rgb ? luminance(rgb) : -1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('add_layers reconciles a preset mood with the design theme', () => {
  it('a LIGHT theme stays light even for dark-mood (AI/tech) content', () => {
    expect(bgLuminance('light-clean')).toBeGreaterThan(0.5);
  });

  it('another light theme (editorial-cream) also stays light', () => {
    expect(bgLuminance('editorial-cream')).toBeGreaterThan(0.5);
  });

  it('a DARK theme renders dark (polarity honored both ways)', () => {
    expect(bgLuminance('dark-tech')).toBeLessThan(0.5);
  });

  it('an explicit bg still wins over the theme', () => {
    const withBg = [{ ...SECTIONS[0], bg: '#0A0A0A' }];
    expect(bgLuminance('light-clean', withBg)).toBeLessThan(0.5); // honored despite light theme
  });
});
