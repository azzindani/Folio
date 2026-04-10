/**
 * Performance benchmarks for core engine modules.
 * Run: npm run test:bench
 * Targets from CLAUDE.md §17.6:
 *   token resolver (50 tokens)  < 10ms
 *   SVG renderer (50 layers)    < 100ms
 *   YAML parse (200 layers)     < 50ms
 */
import { bench, describe } from 'vitest';
import { resolveAllTokens, type TokenResolutionContext } from './token-resolver';
import { renderDesign } from '../renderer/renderer';
import { parseDesign } from '../schema/parser';
import type { DesignSpec, ThemeSpec, RectLayer, TextLayer } from '../schema/types';

// ── Shared fixtures ─────────────────────────────────────────

const DARK_TECH_THEME: ThemeSpec = {
  _protocol: 'theme/v1',
  name: 'Dark Tech',
  version: '1.0.0',
  colors: {
    background: '#1A1A2E',
    surface: '#16213E',
    primary: '#E94560',
    secondary: '#3D9EE4',
    text: '#FFFFFF',
    text_muted: '#8892A4',
    border: '#2A2A4A',
  },
  typography: {
    scale: {
      h1: { size: 72, weight: 700, line_height: 1.1 },
      body: { size: 18, weight: 400, line_height: 1.6 },
    },
    families: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
  },
  spacing: { unit: 8, scale: [0, 4, 8, 16, 24, 32, 48, 64, 80, 96, 128] },
  effects: {
    shadow_card: '0 4px 24px rgba(0,0,0,0.4)',
    shadow_glow: '0 0 32px rgba(233,69,96,0.3)',
  },
  radii: { sm: 4, md: 8, lg: 16, xl: 24, full: 9999 },
};

function makeLayers(count: number) {
  const layers = [];
  for (let i = 0; i < count; i++) {
    const z = i * 2;
    if (i % 3 === 0) {
      layers.push({
        id: `rect-${i}`,
        type: 'rect',
        z,
        x: (i % 10) * 100,
        y: Math.floor(i / 10) * 100,
        width: 80,
        height: 80,
        fill: { type: 'solid', color: '$primary' },
      } as RectLayer);
    } else if (i % 3 === 1) {
      layers.push({
        id: `text-${i}`,
        type: 'text',
        z,
        x: (i % 10) * 100,
        y: Math.floor(i / 10) * 100,
        width: 200,
        content: { type: 'plain', value: `Layer ${i}` },
        style: { font_family: '$heading', font_size: 16, color: '$text' },
      } as TextLayer);
    } else {
      layers.push({
        id: `rect2-${i}`,
        type: 'rect',
        z,
        x: (i % 10) * 100,
        y: Math.floor(i / 10) * 100,
        width: 90,
        height: 40,
        fill: { type: 'linear', angle: 135, stops: [{ color: '$background', position: 0 }, { color: '$secondary', position: 100 }] },
      } as RectLayer);
    }
  }
  return layers;
}

function makeDesign(layers: ReturnType<typeof makeLayers>): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'bench', name: 'Bench', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers,
  };
}

const FIFTY_LAYERS = makeLayers(50);
const TWO_HUNDRED_LAYERS = makeLayers(200);
const FIFTY_DESIGN = makeDesign(FIFTY_LAYERS);
const TWO_HUNDRED_DESIGN = makeDesign(TWO_HUNDRED_LAYERS);
const TOKEN_CTX: TokenResolutionContext = { theme: DARK_TECH_THEME };

// ── Benchmarks ───────────────────────────────────────────────

describe('Token Resolver', () => {
  bench('resolveAllTokens — 50 token-referenced layers', () => {
    resolveAllTokens(FIFTY_LAYERS, TOKEN_CTX);
  });

  bench('resolveAllTokens — 200 token-referenced layers', () => {
    resolveAllTokens(TWO_HUNDRED_LAYERS, TOKEN_CTX);
  });
});

describe('SVG Renderer', () => {
  bench('renderDesign — 50 layers (cold, cache miss)', () => {
    renderDesign(FIFTY_DESIGN, { theme: DARK_TECH_THEME });
  });

  bench('renderDesign — 200 layers (cold, cache miss)', () => {
    renderDesign(TWO_HUNDRED_DESIGN, { theme: DARK_TECH_THEME });
  });
});

describe('YAML Parser', () => {
  // Build a 200-layer YAML string once, reuse in bench
  const yamlLines = [
    '_protocol: "design/v1"',
    'meta:',
    '  id: bench',
    '  name: Bench Design',
    '  type: poster',
    '  created: "2026-04-09"',
    '  modified: "2026-04-09"',
    'document:',
    '  width: 1080',
    '  height: 1080',
    '  unit: px',
    '  dpi: 96',
    'layers:',
    ...Array.from({ length: 200 }, (_, i) => [
      `  - id: layer-${i}`,
      `    type: rect`,
      `    z: ${i * 2}`,
      `    x: ${(i % 10) * 100}`,
      `    y: ${Math.floor(i / 10) * 100}`,
      `    width: 80`,
      `    height: 80`,
    ]).flat(),
  ].join('\n');

  bench('parseDesign — 200-layer YAML', () => {
    parseDesign(yamlLines);
  });
});
