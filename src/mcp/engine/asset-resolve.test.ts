import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveImageAssets, assetBaseDirs, auditImageAssets } from './asset-resolve';
import type { DesignSpec, Layer } from '../../schema/types';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

function makeSpec(layers: Layer[], pages?: { id: string; layers: Layer[] }[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'x', name: 'x', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
    document: { width: 100, height: 100, unit: 'px', dpi: 96 },
    layers, ...(pages ? { pages } : {}),
  } as unknown as DesignSpec;
}
const img = (id: string, src: string): Layer => ({ id, type: 'image', x: 0, y: 0, width: 10, height: 10, src } as unknown as Layer);

describe('resolveImageAssets', () => {
  let tmp: string, proj: string, dPath: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-resolve-'));
    proj = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(proj, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'assets/images'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'assets/images/dot.png'), Buffer.from(PNG_B64, 'base64'));
    dPath = path.join(proj, 'designs/d.design.yaml');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('embeds an existing assets/ file as a data: URI (no note)', () => {
    const spec = makeSpec([img('a', 'assets/images/dot.png')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect(notes).toEqual([]);
    expect((spec.layers![0] as Layer & { src: string }).src).toMatch(/^data:image\/png;base64,/);
  });

  it('blanks a missing file and says how to fix it', () => {
    const spec = makeSpec([img('a', 'assets/images/nope.jpg')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect((spec.layers![0] as Layer & { src: string }).src).toBe('');
    expect(notes[0]).toMatch(/not found/);
    expect(notes[0]).toMatch(/asset_add/);
  });

  it('blanks an https URL with the editor-only warning', () => {
    const spec = makeSpec([img('a', 'https://example.com/x.png')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect((spec.layers![0] as Layer & { src: string }).src).toBe('');
    expect(notes[0]).toMatch(/EDITOR only/);
  });

  it('blanks an undecodable data: URI', () => {
    const spec = makeSpec([img('a', 'data:image/png;base64,not-a-png')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect((spec.layers![0] as Layer & { src: string }).src).toBe('');
    expect(notes[0]).toMatch(/not a decodable image/);
  });

  it('keeps a valid data: URI untouched', () => {
    const uri = `data:image/png;base64,${PNG_B64}`;
    const spec = makeSpec([img('a', uri)]);
    expect(resolveImageAssets(spec, dPath, proj)).toEqual([]);
    expect((spec.layers![0] as Layer & { src: string }).src).toBe(uri);
  });

  it('resolves image FILLS: embeds found files, degrades missing ones to a neutral solid', () => {
    const ok = { id: 'r1', type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: { type: 'image', src: 'assets/images/dot.png' } } as unknown as Layer;
    const missing = { id: 'r2', type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: { type: 'image', src: 'assets/images/nope.png' } } as unknown as Layer;
    const spec = makeSpec([ok, missing]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect((spec.layers![0] as Layer & { fill: { src: string } }).fill.src).toMatch(/^data:/);
    expect((spec.layers![1] as Layer & { fill: { type: string } }).fill.type).toBe('solid');
    expect(notes[0]).toMatch(/image fill on "r2"/);
  });

  it('recurses groups and carousel pages', () => {
    const grp = { id: 'g', type: 'group', x: 0, y: 0, width: 10, height: 10, layers: [img('inner', 'https://x.com/a.png')] } as unknown as Layer;
    const spec = makeSpec([grp], [{ id: 'p2', layers: [img('pg', 'assets/images/dot.png')] }]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect(notes).toHaveLength(1);
    const pageImg = (spec.pages![0].layers![0]) as Layer & { src: string };
    expect(pageImg.src).toMatch(/^data:/);
  });

  it('sniffs content over a lying extension (PNG bytes named .jpg)', () => {
    fs.writeFileSync(path.join(proj, 'assets/images/liar.jpg'), Buffer.from(PNG_B64, 'base64'));
    const spec = makeSpec([img('a', 'assets/images/liar.jpg')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect(notes).toEqual([]);
    expect((spec.layers![0] as Layer & { src: string }).src).toMatch(/^data:image\/png;base64,/);
  });

  it('keeps the historical base-dir search order', () => {
    // path.join uses the platform separator — normalize so the assertion
    // holds on Windows runners too ('\\p\\assets').
    const dirs = assetBaseDirs('/p/designs/d.design.yaml', '/p').map(d => d.replace(/\\/g, '/'));
    expect(dirs).toEqual(['/p/designs', '/p', '/p', '/p/assets']);
  });
});

describe('auditImageAssets — text on a BUSY photo without a scrim (WP-1.4)', () => {
  let tmp: string, proj: string, dPath: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-busy-'));
    proj = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(proj, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'assets/images'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'assets/images/crowd.png'), Buffer.from(PNG_B64, 'base64'));
    // JSON is valid YAML — write the manifest the ingest pipeline would.
    fs.writeFileSync(path.join(proj, 'project.yaml'), JSON.stringify({
      name: 'proj',
      assets: { images: [{ id: 'crowd', path: 'assets/images/crowd.png', kind: 'images', bytes: 68, luminance: 'busy', added: '2026-07-11' }] },
    }));
    dPath = path.join(proj, 'designs/d.design.yaml');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const photo = (): Layer => ({ id: 'photo', type: 'image', z: 1, x: 0, y: 0, width: 100, height: 100, src: 'assets/images/crowd.png' } as unknown as Layer);
  const headline = (): Layer => ({ id: 'headline', type: 'text', z: 5, x: 10, y: 40, width: 80, height: 0, content: { type: 'plain', value: 'BIG NIGHT' }, style: { font_size: 24 } } as unknown as Layer);

  it('flags a headline sitting on a busy photo with no scrim', () => {
    const spec = makeSpec([photo(), headline()]);
    const findings = auditImageAssets(spec, dPath, proj);
    const f = findings.find(x => x.code === 'text_on_busy_image');
    expect(f).toBeTruthy();
    expect(f!.layer_id).toBe('headline');
    expect(f!.severity).toBe('suggestion');
    expect(f!.message).toMatch(/scrim/);
  });

  it('stays quiet when a scrim rect sits between the photo and the text', () => {
    const scrim = { id: 'scrim', type: 'rect', z: 3, x: 5, y: 35, width: 90, height: 60, opacity: 0.5, fill: { type: 'solid', color: '#000000' } } as unknown as Layer;
    const spec = makeSpec([photo(), scrim, headline()]);
    const findings = auditImageAssets(spec, dPath, proj);
    expect(findings.find(x => x.code === 'text_on_busy_image')).toBeUndefined();
  });

  it('stays quiet for text BESIDE the photo and for non-busy assets', () => {
    const beside = { ...headline() } as unknown as Record<string, unknown>;
    beside['x'] = 200;                                            // off the photo
    const spec = makeSpec([photo(), beside as unknown as Layer]);
    expect(auditImageAssets(spec, dPath, proj).find(x => x.code === 'text_on_busy_image')).toBeUndefined();
    // flip manifest to light → no flag even when overlapping
    fs.writeFileSync(path.join(proj, 'project.yaml'), JSON.stringify({
      name: 'proj',
      assets: { images: [{ id: 'crowd', path: 'assets/images/crowd.png', kind: 'images', bytes: 68, luminance: 'light', added: '2026-07-11' }] },
    }));
    const spec2 = makeSpec([photo(), headline()]);
    expect(auditImageAssets(spec2, dPath, proj).find(x => x.code === 'text_on_busy_image')).toBeUndefined();
  });
});

describe('shared library srcs', () => {
  let tmp: string, proj: string, dPath: string, prevLib: string | undefined;
  const libFile = (rel: string, buf: Buffer): void => {
    const abs = path.join(process.env['FOLIO_LIBRARY_DIR'] ?? '', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
  };
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-libsrc-'));
    prevLib = process.env['FOLIO_LIBRARY_DIR'];
    process.env['FOLIO_LIBRARY_DIR'] = path.join(tmp, 'lib-root');
    proj = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(proj, 'designs'), { recursive: true });
    dPath = path.join(proj, 'designs/d.design.yaml');
  });
  afterEach(() => {
    if (prevLib === undefined) delete process.env['FOLIO_LIBRARY_DIR'];
    else process.env['FOLIO_LIBRARY_DIR'] = prevLib;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('embeds an asset that lives in the shared library', () => {
    libFile('microsoft/logos/pa.png', Buffer.from(PNG_B64, 'base64'));
    const spec = makeSpec([img('a', 'lib/microsoft/logos/pa.png')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect(notes).toEqual([]);
    expect(String(((spec.layers ?? [])[0] as unknown as { src: string }).src)).toMatch(/^data:image\/png;base64,/);
  });

  it('lets the project shadow a library path with its own copy', () => {
    libFile('microsoft/logos/pa.png', Buffer.from(PNG_B64, 'base64'));
    const own = path.join(proj, 'lib/microsoft/logos/pa.png');
    fs.mkdirSync(path.dirname(own), { recursive: true });
    fs.writeFileSync(own, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'));
    const spec = makeSpec([img('a', 'lib/microsoft/logos/pa.png')]);
    expect(resolveImageAssets(spec, dPath, proj)).toEqual([]);
    // The project's file won — it is an SVG, the library's is a PNG.
    expect(String(((spec.layers ?? [])[0] as unknown as { src: string }).src)).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('names the library in the note when a lib/ path is missing', () => {
    const spec = makeSpec([img('a', 'lib/nope/missing.png')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect(notes[0]).toContain('not in the shared library');
    expect(notes[0]).toContain('scope:"library"');
  });

  it('refuses a lib path that climbs out of the library root', () => {
    fs.writeFileSync(path.join(tmp, 'outside.png'), Buffer.from(PNG_B64, 'base64'));
    const spec = makeSpec([img('a', 'lib/../../outside.png')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect(notes[0]).toContain('points outside the project');
    expect(String(((spec.layers ?? [])[0] as unknown as { src: string }).src)).toBe('');
  });
});

describe('resolveImageAssets — an src may not leave the project', () => {
  let tmp: string, proj: string, dPath: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-escape-'));
    proj = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(proj, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'assets/images'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'assets/images/dot.png'), Buffer.from(PNG_B64, 'base64'));
    // The file a malicious/careless src would try to reach. It is a real image
    // so nothing but the containment check can stop it being embedded.
    fs.writeFileSync(path.join(tmp, 'secret.png'), Buffer.from(PNG_B64, 'base64'));
    dPath = path.join(proj, 'designs/d.design.yaml');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const srcOf = (spec: DesignSpec): string => String(((spec.layers ?? [])[0] as unknown as { src: string }).src);

  it('refuses a relative src that climbs out of the project', () => {
    const spec = makeSpec([img('a', '../../secret.png')]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect(srcOf(spec)).toBe('');
    expect(notes[0]).toContain('points outside the project');
  });

  it('refuses an absolute src, however real the file is', () => {
    const spec = makeSpec([img('a', path.join(tmp, 'secret.png'))]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect(srcOf(spec)).toBe('');
    expect(notes[0]).toContain('points outside the project');
  });

  it('refuses an escaping path in an image FILL too', () => {
    const rect = { id: 'r', type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: { type: 'image', src: '../../secret.png' } } as unknown as Layer;
    const spec = makeSpec([rect]);
    const notes = resolveImageAssets(spec, dPath, proj);
    expect((spec.layers?.[0] as Layer & { fill: { type: string } }).fill.type).toBe('solid');
    expect(notes[0]).toContain('points outside the project');
  });

  it('still allows ../ that stays INSIDE the project', () => {
    const spec = makeSpec([img('a', '../assets/images/dot.png')]);
    expect(resolveImageAssets(spec, dPath, proj)).toEqual([]);
    expect(srcOf(spec)).toMatch(/^data:image\/png;base64,/);
  });
});
