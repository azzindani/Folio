import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { Resvg } from '@resvg/resvg-js';
import { animateText } from './text-animate-op';
import { renderToSVGString } from './svg-export';
import { resvgFontOption } from './fonts';
import type { DesignSpec } from '../../schema/types';

// Found live: op:text with mask:true sized each mask to one line box, so at rest
// — the pose the video holds longest — the tails of g, y and p were cut off. A
// mask is there to hide the unit BEFORE it arrives, never to crop it once it has.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-maskink-'));
let dPath = '';
let n = 0;
const spec = (lineHeight: number): unknown => ({
  _protocol: 'design/v1', meta: { id: 'm', name: 'm', type: 'poster', created: '', modified: '' },
  document: { width: 1080, height: 600, unit: 'px', dpi: 96 },
  layers: [{ id: 'title', type: 'text', z: 1, x: 80, y: 150, width: 920,
    content: { type: 'plain', value: 'gypsy jump' },
    style: { font_family: 'Archivo', font_size: 140, font_weight: 800, line_height: lineHeight, color: '#000000', align: 'left' } }],
});

beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** The first and last rows resvg inks, at rest (the renderer draws the authored pose). */
const inkRows = (s: DesignSpec): { top: number; bottom: number } => {
  const img = new Resvg(renderToSVGString(s), { background: '#FFFFFF', font: resvgFontOption() }).render();
  const px = img.pixels; // a native getter that copies the buffer — read it once
  let top = img.height, bottom = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if ((px[(y * img.width + x) * 4] ?? 255) < 128) { top = Math.min(top, y); bottom = Math.max(bottom, y); break; }
    }
  }
  return { top, bottom };
};

describe('op:text mask — the rest pose keeps all its ink', () => {
  it.each([1.0, 0.9])('line_height %s: descenders and caps survive the mask', (lh) => {
    fs.writeFileSync(dPath, yaml.dump(spec(lh)));
    const before = inkRows(yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec);
    const r = animateText({ design_path: dPath, layer_id: 'title', by: 'word', preset: 'fade_in', mask: true });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const after = inkRows(yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec);
    const note = `unsplit ink ${before.top}→${before.bottom}, masked ${after.top}→${after.bottom}`;
    expect(before.bottom - before.top, note).toBeGreaterThan(100);
    expect(after.bottom, note).toBeGreaterThanOrEqual(before.bottom - 1);
    expect(after.top, note).toBeLessThanOrEqual(before.top + 1);
  });
});
