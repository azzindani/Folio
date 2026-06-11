import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { shortCode, registerShortLink, resolveShortLink } from './short-link';

describe('short-link store (mangle-proof /o/<code> editor links)', () => {
  let dir: string;
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env['FOLIO_PROJECTS_DIR'];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-sl-'));
    process.env['FOLIO_PROJECTS_DIR'] = dir;
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env['FOLIO_PROJECTS_DIR']; else process.env['FOLIO_PROJECTS_DIR'] = prev;
  });

  it('shortCode is deterministic, url-safe, and short (≤11 chars)', () => {
    const p = '/home/folio/projects/x/designs/a.design.yaml';
    expect(shortCode(p)).toBe(shortCode(p));
    expect(shortCode(p)).toMatch(/^[a-z0-9]{1,11}$/);
    expect(shortCode(p)).not.toBe(shortCode(p + 'b')); // different path ⇒ different code
  });

  it('register → resolve round-trips the path and page', () => {
    const code = registerShortLink('/home/folio/projects/x/designs/a.design.yaml', 2);
    expect(resolveShortLink(code)).toEqual({ path: '/home/folio/projects/x/designs/a.design.yaml', page: 2 });
  });

  it('re-registering the same path reuses the code and does not grow the store', () => {
    const a = registerShortLink('/p/a.design.yaml');
    const b = registerShortLink('/p/a.design.yaml');
    expect(a).toBe(b);
    const store = JSON.parse(fs.readFileSync(path.join(dir, '.short-links.json'), 'utf-8')) as Record<string, unknown>;
    expect(Object.keys(store)).toHaveLength(1);
  });

  it('tolerates a trailing markdown artifact a small model glues on (] or backtick)', () => {
    const code = registerShortLink('/p/a.design.yaml');
    expect(resolveShortLink(`${code}]`)).not.toBeNull();
    expect(resolveShortLink(`${code}\``)).not.toBeNull();
  });

  it('an unknown or empty code resolves to null', () => {
    expect(resolveShortLink('zzzznotreal99')).toBeNull();
    expect(resolveShortLink('')).toBeNull();
  });
});
