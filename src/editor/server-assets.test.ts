import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { listAssets, manageAssets, uploadAsset } from './server-assets';

// canonical valid 1×1 transparent PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const PNG = Buffer.from(PNG_B64, 'base64');

function makeProject(root: string, name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.yaml'),
    `_protocol: project/v1\nmeta:\n  name: ${name}\nassets:\n  fonts: []\n  images: []\n`);
  return dir;
}

const postBytes = (body: Buffer): Request =>
  new Request('http://x/upload', { method: 'POST', body: new Uint8Array(body), headers: { 'content-length': String(body.length) } });
const postJSON = (body: unknown): Request =>
  new Request('http://x/manage', { method: 'POST', body: JSON.stringify(body) });
const URL_NO_ALT = new URL('http://x/upload');

describe('editor server asset routes', () => {
  let tmp: string;
  let proj: string;
  let prevLib: string | undefined;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-srv-assets-'));
    proj = makeProject(tmp, 'p1');
    // The listing unions the SHARED library, so it must not read whatever
    // library this machine happens to hold — give each test an empty one.
    prevLib = process.env['FOLIO_LIBRARY_DIR'];
    process.env['FOLIO_LIBRARY_DIR'] = path.join(tmp, 'lib-root');
  });
  afterEach(() => {
    if (prevLib === undefined) delete process.env['FOLIO_LIBRARY_DIR'];
    else process.env['FOLIO_LIBRARY_DIR'] = prevLib;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('uploads into the project root and lists it', async () => {
    const up = await uploadAsset(postBytes(PNG), URL_NO_ALT, proj, 'images', undefined, 'shot.png');
    expect(up.status).toBe(200);
    const body = await up.json() as { ok: boolean; asset: { path: string } };
    expect(body.ok).toBe(true);
    expect(body.asset.path).toBe('assets/images/shot.png');

    const listed = await listAssets(proj).json() as { ok: boolean; assets: { path: string }[]; folders: string[] };
    expect(listed.assets.map(a => a.path)).toEqual(['assets/images/shot.png']);
    expect(listed.folders).toEqual([]);
  });

  it('uploads into a folder, and the listing reports the folder', async () => {
    const up = await uploadAsset(postBytes(PNG), URL_NO_ALT, proj, 'images', 'Power Automate', 'step-1.png');
    const body = await up.json() as { asset: { path: string; folder?: string } };
    expect(body.asset.path).toBe('assets/images/power-automate/step-1.png');

    const listed = await listAssets(proj).json() as { assets: unknown[]; folders: string[] };
    expect(listed.folders).toEqual(['power-automate']);
  });

  it('carries ?alt= through to the stored metadata', async () => {
    const url = new URL('http://x/upload?alt=Flow%20designer%20screen');
    await uploadAsset(postBytes(PNG), url, proj, 'images', undefined, 'a.png');
    const listed = await listAssets(proj).json() as { assets: { alt?: string }[] };
    expect(listed.assets[0]?.alt).toBe('Flow designer screen');
  });

  it('refuses a body over the size cap without writing anything', async () => {
    process.env['FOLIO_MAX_ASSET_BYTES'] = '10';
    try {
      const res = await uploadAsset(postBytes(PNG), URL_NO_ALT, proj, 'images', undefined, 'big.png');
      expect(res.status).toBe(413);
      expect(fs.existsSync(path.join(proj, 'assets/images/big.png'))).toBe(false);
    } finally {
      delete process.env['FOLIO_MAX_ASSET_BYTES'];
    }
  });

  it('refuses a disallowed file type', async () => {
    const res = await uploadAsset(postBytes(PNG), URL_NO_ALT, proj, 'images', undefined, 'payload.exe');
    expect(res.status).toBe(415);
  });

  it('moves an asset into a folder via manage', async () => {
    await uploadAsset(postBytes(PNG), URL_NO_ALT, proj, 'images', undefined, 'a.png');
    const res = await manageAssets(postJSON({ op: 'move', asset_path: 'assets/images/a.png', folder: 'shoot', new_name: 'b.png' }), proj);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; moved: string };
    expect(body.ok).toBe(true);
    expect(body.moved).toBe('assets/images/shoot/b.png');
    expect(fs.existsSync(path.join(proj, 'assets/images/shoot/b.png'))).toBe(true);
  });

  it('deletes an asset via manage (soft, to .trash)', async () => {
    await uploadAsset(postBytes(PNG), URL_NO_ALT, proj, 'images', undefined, 'a.png');
    const res = await manageAssets(postJSON({ op: 'delete', asset_path: 'assets/images/a.png' }), proj);
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(proj, 'assets/images/a.png'))).toBe(false);
  });

  it('rejects an unknown op, bad JSON, and a traversal path', async () => {
    expect((await manageAssets(postJSON({ op: 'nuke' }), proj)).status).toBe(400);
    const bad = new Request('http://x/manage', { method: 'POST', body: 'not json' });
    expect((await manageAssets(bad, proj)).status).toBe(400);
    const trav = await manageAssets(postJSON({ op: 'delete', asset_path: '../../project.yaml' }), proj);
    expect(trav.status).toBe(400);
    expect(fs.existsSync(path.join(proj, 'project.yaml'))).toBe(true);
  });
});

describe('editor server asset routes — the shared library', () => {
  let tmp: string, proj: string, prevLib: string | undefined;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-srv-lib-'));
    proj = makeProject(tmp, 'p1');
    prevLib = process.env['FOLIO_LIBRARY_DIR'];
    process.env['FOLIO_LIBRARY_DIR'] = path.join(tmp, 'lib-root');
  });
  afterEach(() => {
    if (prevLib === undefined) delete process.env['FOLIO_LIBRARY_DIR'];
    else process.env['FOLIO_LIBRARY_DIR'] = prevLib;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('files an upload into the library when scope=library, nesting the folder', async () => {
    const url = new URL('http://x/upload?scope=library&folder=microsoft/logos');
    const up = await uploadAsset(postBytes(PNG), url, proj, 'images', undefined, 'pa.png');
    expect(up.status).toBe(200);
    const body = await up.json() as { ok: boolean; asset: { path: string } };
    expect(body.asset.path).toBe('lib/microsoft/logos/pa.png');
  });

  it('lists both stores together, with the library folder tree', async () => {
    await uploadAsset(postBytes(PNG), URL_NO_ALT, proj, 'images', undefined, 'mine.png');
    await uploadAsset(postBytes(Buffer.concat([PNG, Buffer.from([1])])),
      new URL('http://x/upload?scope=library&folder=ai/logos'), proj, 'images', undefined, 'shared.png');
    const listed = await listAssets(proj).json() as { assets: { path: string }[]; folders: string[]; library_folders: string[] };
    expect(listed.assets.map(a => a.path).sort()).toEqual(['assets/images/mine.png', 'lib/ai/logos/shared.png']);
    expect(listed.library_folders).toEqual(['ai', 'ai/logos']);
  });

  it('routes a manage op on a lib/ path to the library, not the project', async () => {
    await uploadAsset(postBytes(PNG), new URL('http://x/upload?scope=library&folder=inbox'), proj, 'images', undefined, 'x.png');
    const moved = await manageAssets(postJSON({ op: 'move', asset_path: 'lib/inbox/x.png', folder: 'microsoft' }), proj);
    const mBody = await moved.json() as { ok: boolean; moved?: { to: string } };
    expect(mBody.ok).toBe(true);
    expect(mBody.moved?.to).toBe('lib/microsoft/x.png');

    const del = await manageAssets(postJSON({ op: 'delete', asset_path: 'lib/microsoft/x.png' }), proj);
    expect((await del.json() as { ok: boolean }).ok).toBe(true);
    const listed = await listAssets(proj).json() as { assets: { path: string }[] };
    expect(listed.assets).toEqual([]);
  });
});
