import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addLayers } from './engine-layer-tools';
import { writeYAML, readYAML } from './engine/utils';
import type { DesignSpec } from '../schema/types';

// A boxless `sections` poster used to silently lose its requested aspect ratio:
// the canvas auto-fit set document.height = content height, turning a 4:5 request
// into 3:5. These exercise the real add_layers pipeline end-to-end.

const SECTIONS = [{
  type: 'sections', kicker: 'AI Design', title: 'AI Creates Designs',
  subtitle: 'No vision needed. No image generation. Pure reasoning.',
  blocks: [
    { kind: 'stats', items: [{ value: '90%', label: 'Time Saved' }, { value: '4x', label: 'Faster Delivery' }, { value: '10x', label: 'Bulk Capacity' }, { value: '24/7', label: 'Always On' }] },
    { kind: 'heading_text', heading: 'The Proof', body: 'This poster was created entirely by an AI model using only the Folio MCP system — no vision, no image generation, just structured reasoning.' },
    { kind: 'heading_text', heading: 'How It Works', body: 'Folio MCP provides a design engine and editor that AI interacts with through precise function calls.' },
    { kind: 'heading_text', heading: 'The Impact', body: 'What once took hours of manual work now completes in minutes, enabling rapid iteration.' },
    { kind: 'callout', label: 'Takeaway', text: "AI doesn't need to see to design — it needs to understand structure and intent." },
  ],
}];

function design(dir: string, w: number, h: number): string {
  const spec = {
    _protocol: 'design/v1',
    meta: { id: 'ratio', name: 'ratio', type: 'poster' },
    document: { width: w, height: h, unit: 'px', dpi: 96 },
    theme: { ref: 'light-clean' },
    layers: [],
  } as unknown as DesignSpec;
  const p = path.join(dir, 'r.design.yaml');
  writeYAML(p, spec);
  return p;
}

function ratioAfterAddLayers(reqW: number, reqH: number): number {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-ratio-'));
  try {
    const p = design(dir, reqW, reqH);
    const res = addLayers({ design_path: p, layers_shorthand: SECTIONS as never });
    expect((res as { success?: boolean }).success).not.toBe(false);
    const spec = readYAML(p) as DesignSpec;
    return spec.document.width / spec.document.height;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('add_layers honors a deliberate poster aspect ratio when content overflows', () => {
  // This `sections` content is taller than 1350 and 1080, so honoring kicks in.
  it('keeps 4:5 (1080×1350) at 4:5 — not the content-height 3:5', () => {
    expect(Math.abs(ratioAfterAddLayers(1080, 1350) - 4 / 5)).toBeLessThan(0.02);
  });
  it('keeps 1:1 (1080×1080) square — not a tall portrait', () => {
    expect(Math.abs(ratioAfterAddLayers(1080, 1080) - 1)).toBeLessThan(0.02);
  });
});
