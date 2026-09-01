import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assetProcess } from './asset-process-op';
import { processAsset, hasWork } from './asset-process';
import { encodePNG, decodePNG, type RasterImage } from '../../utils/png-codec';

let root: string;
let projectsBefore: string | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-aproc-'));
  projectsBefore = process.env['FOLIO_PROJECTS_DIR'];
  process.env['FOLIO_PROJECTS_DIR'] = root;
  fs.mkdirSync(path.join(root, 'demo', 'assets', 'images'), { recursive: true });
});
afterEach(() => {
  if (projectsBefore === undefined) delete process.env['FOLIO_PROJECTS_DIR']; else process.env['FOLIO_PROJECTS_DIR'] = projectsBefore;
  fs.rmSync(root, { recursive: true, force: true });
});

/** A 20×10 red PNG on a white backdrop with a 4px white border. */
function fixture(): Buffer {
  const w = 20, h = 10;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = x >= 4 && x < w - 4 && y >= 2 && y < h - 2;
    const i = (y * w + x) * 4;
    px[i] = inside ? 220 : 255; px[i + 1] = inside ? 30 : 255; px[i + 2] = inside ? 30 : 255; px[i + 3] = 255;
  }
  return encodePNG({ width: w, height: h, pixels: px });
}
const decode = (b: Buffer): RasterImage => decodePNG(b);

describe('processAsset pipeline', () => {
  it('runs crop → remove_bg → trim → adjust → pad in order with notes', () => {
    const out = processAsset(fixture(), 'png', {
      remove_bg: { feather: 0 }, trim: true, adjust: { saturation: 0 }, pad: { top: 1, bottom: 1, left: 1, right: 1, color: '#000000' },
    });
    const img = decode(out.buffer);
    expect([img.width, img.height]).toEqual([14, 8]); // 12×6 subject + 1px pad
    expect(out.notes.join(' | ')).toMatch(/removed background.*trimmed 20×10 → 12×6.*grayscale.*padded/);
    const c = img.pixels.subarray((4 * 14 + 7) * 4, (4 * 14 + 7) * 4 + 3);
    expect(c[0]).toBe(c[1]); // grey
  });

  it('aspect crop, rotate and flatten', () => {
    const out = processAsset(fixture(), 'png', { crop: { aspect: '1:1' }, rotate: 90, flatten: '#0000ff' });
    const img = decode(out.buffer);
    expect([img.width, img.height]).toEqual([10, 10]);
    expect(out.notes[0]).toBe('cropped 20×10 → 10×10');
    expect(out.notes).toContain('rotated 90°');
  });

  it('hasWork ignores an empty adjust and rejects a bad aspect', () => {
    expect(hasWork({ adjust: {} })).toBe(false);
    expect(hasWork({ blur: 2 })).toBe(true);
    expect(() => processAsset(fixture(), 'png', { crop: { aspect: 'wide' } })).toThrow(/ratio/);
  });
});

describe('manage_design(op:asset_process)', () => {
  it('writes a derivative next to the source and leaves the source alone', () => {
    const src = path.join(root, 'demo', 'assets', 'images', 'hero.png');
    fs.writeFileSync(src, fixture());
    const before = fs.readFileSync(src);
    const r = assetProcess({ project_path: 'demo', asset_path: 'assets/images/hero.png', process: { adjust: { brightness: -30, saturation: 0.4 }, vignette: 0.3 } });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const asset = r['asset'] as { path: string; width: number };
    expect(asset.path).toBe('assets/images/hero-edit.png');
    expect(asset.width).toBe(20);
    expect(fs.readFileSync(src).equals(before)).toBe(true);
    expect(fs.existsSync(path.join(root, 'demo', asset.path))).toBe(true);
    expect((r['layer_stub'] as { src: string }).src).toBe(asset.path);
    // A second run does not overwrite the first derivative.
    const r2 = assetProcess({ project_path: 'demo', asset_path: 'assets/images/hero.png', process: { blur: 1 } });
    expect((r2['asset'] as { path: string }).path).toBe('assets/images/hero-edit-2.png');
  });

  it('refuses empty recipes, missing assets and non-PNGs with hints', () => {
    fs.writeFileSync(path.join(root, 'demo', 'assets', 'images', 'x.png'), fixture());
    fs.writeFileSync(path.join(root, 'demo', 'assets', 'images', 'y.jpg'), Buffer.from('notapng'));
    expect(assetProcess({ project_path: 'demo', asset_path: 'assets/images/x.png', process: {} }).error).toMatch(/empty/);
    expect(assetProcess({ project_path: 'demo', asset_path: 'assets/images/nope.png', process: { blur: 1 } }).error).toMatch(/not found/);
    expect(assetProcess({ project_path: 'demo', asset_path: 'assets/images/y.jpg', process: { blur: 1 } }).error).toMatch(/PNG/);
    expect(assetProcess({ project_path: 'demo', asset_path: '../../etc/passwd', process: { blur: 1 } }).success).toBe(false);
  });
});
