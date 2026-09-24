// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DesignSpec } from '../../schema/types';
import { collectFindings } from './diagnose-collect';
import { fontsDir } from './fonts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-italic-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const design = path.join(root, 'designs', 'std.design.yaml');
fs.mkdirSync(path.dirname(design), { recursive: true });
const spec = { meta: { id: 's', name: 'S', type: 'poster' }, document: { width: 1080, height: 1080 },
  layers: [{ id: 'names', type: 'text', z: 3, x: 90, y: 360, width: 900, content: { type: 'plain', value: 'Nadia & Tomás' },
    style: { font_family: 'Playfair Display', font_size: 124, font_weight: 400, font_style: 'italic', color: '#4A2E2A' } }] } as unknown as DesignSpec;
const italic = (): Array<{ code: string; call?: { params: Record<string, unknown> } }> =>
  collectFindings(spec, design, root).filter(f => f.code === 'missing_italic');

describe('missing_italic', () => {
  it('says the export draws italic text upright when no italic face is installed, with the fetch that fixes it (r8)', () => {
    const [f] = italic();
    expect(f?.call?.params).toMatchObject({ op: 'asset_fetch', ref: 'font:playfair-display', italic: true, weight: 400 });
  });

  it('is quiet once the italic face is in the project', () => {
    fs.mkdirSync(path.join(root, 'assets', 'fonts'), { recursive: true });
    fs.copyFileSync(path.join(fontsDir(), 'PlayfairDisplay-Regular.ttf'), path.join(root, 'assets', 'fonts', 'playfair-display-400-italic.ttf'));
    expect(italic()).toEqual([]);
  });
});
