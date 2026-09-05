import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { DesignSpec, Layer } from '../../schema/types';
import { buildManifest, embedManifest, manifestScript, sourceHash, MANIFEST_ID } from './export-manifest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-manifest-'));
let designPath = '';
let n = 0;

beforeEach(() => {
  const dir = path.join(root, `case-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  designPath = path.join(dir, 'deck.design.yaml');
  fs.writeFileSync(designPath, 'meta:\n  name: Deck\n');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const preset = (id: string, type: string): Layer => ({
  id, type: 'group', _spec: { type, title: 'T' }, layers: [{ id: `${id}-t`, type: 'text' }],
} as unknown as Layer);

const design = (over: Partial<DesignSpec> = {}): DesignSpec => ({
  meta: { id: 'd1', name: 'Deck', type: 'poster' },
  document: { width: 1080, height: 1350 },
  layers: [preset('sections_1', 'sections')],
  ...over,
} as unknown as DesignSpec);

describe('sourceHash', () => {
  it('changes when the design changes, and is undefined for a file that is gone', () => {
    const a = sourceHash(designPath);
    fs.writeFileSync(designPath, 'meta:\n  name: Deck 2\n');
    expect(sourceHash(designPath)).not.toBe(a);
    expect(sourceHash(path.join(root, 'nope.yaml'))).toBeUndefined();
  });
});

describe('buildManifest', () => {
  it('carries identity, canvas and the source hash', () => {
    const m = buildManifest(design(), designPath);
    expect(m.protocol).toBe('folio/export-manifest@1');
    expect(m.design).toMatchObject({ id: 'd1', name: 'Deck', width: 1080, height: 1350 });
    expect(m.source.path).toBe(designPath);
    expect(m.source.hash).toHaveLength(32);
  });

  it('embeds the AUTHORED specs, not the expanded tree — sparse is the point', () => {
    const m = buildManifest(design(), designPath);
    expect(m.specs).toHaveLength(1);
    expect(m.specs[0]).toMatchObject({ layer_id: 'sections_1', type: 'sections' });
    // The preset's generated children must NOT be in there.
    expect(JSON.stringify(m.specs)).not.toContain('sections_1-t');
  });

  it('walks pages and tags each spec with the page it came from', () => {
    const m = buildManifest(design({
      layers: [],
      pages: [
        { id: 'p1', layers: [preset('a', 'stat')] },
        { id: 'p2', layers: [preset('b', 'list')] },
      ],
    } as unknown as Partial<DesignSpec>), designPath);
    expect(m.design.pages).toBe(2);
    expect(m.specs.map(s => s.page_id)).toEqual(['p1', 'p2']);
  });

  it('is still valid for a hand-composed design with no specs at all', () => {
    const m = buildManifest(design({ layers: [{ id: 'r', type: 'rect' } as unknown as Layer] }), designPath);
    expect(m.specs).toEqual([]);
    expect(m.source.hash).toBeDefined();
  });

  it('names the round-trip, so the artifact says how to act on itself', () => {
    expect(buildManifest(design(), designPath).round_trip).toContain('patch_spec');
  });
});

describe('manifestScript', () => {
  it('escapes < so embedded content cannot close the script element early', () => {
    const m = buildManifest(design({
      layers: [{ id: 'x', type: 'group', _spec: { type: 'sections', title: '</script><img>' } } as unknown as Layer],
    }), designPath);
    const tag = manifestScript(m);
    expect(tag).not.toContain('</script><img>');
    expect(tag).toContain('\\u003c');
    // Exactly one closing tag: the real one.
    expect(tag.match(/<\/script>/g)).toHaveLength(1);
  });

  it('round-trips back to the same object through JSON.parse', () => {
    const m = buildManifest(design(), designPath);
    const json = manifestScript(m).replace(new RegExp(`^<script[^>]*id="${MANIFEST_ID}">`), '').replace(/<\/script>$/, '');
    expect(JSON.parse(json.replace(/\\u003c/g, '<'))).toEqual(m);
  });
});

describe('embedManifest', () => {
  const m = (): ReturnType<typeof buildManifest> => buildManifest(design(), designPath);

  it('goes in the head when there is one', () => {
    const out = embedManifest('<html><head><title>x</title></head><body>b</body></html>', m());
    expect(out.indexOf(MANIFEST_ID)).toBeLessThan(out.indexOf('</head>'));
  });

  it('falls back to the body when there is no head', () => {
    const out = embedManifest('<html><body>b</body></html>', m());
    expect(out).toContain(MANIFEST_ID);
    expect(out.indexOf(MANIFEST_ID)).toBeLessThan(out.indexOf('</body>'));
  });

  it('leaves a document it cannot place into untouched rather than corrupting it', () => {
    const raw = '<svg><rect/></svg>';
    expect(embedManifest(raw, m())).toBe(raw);
  });
});
