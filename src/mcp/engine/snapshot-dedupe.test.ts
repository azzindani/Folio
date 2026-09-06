import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { snapshot } from './utils';

// Most mutating ops snapshot FIRST and validate after, so a call that fails
// validation — `update` on a layer id that does not exist, the commonest slip a
// model makes — still wrote a .bak byte-identical to the previous one. With
// retention capped at 20, twelve fumbled layer ids evicted the three oldest REAL
// restore points. Measured live before the fix: 19 snapshots in, the oldest
// three gone, and the design had never changed.

describe('a snapshot is a restore point, not a receipt', () => {
  let tmp: string;
  let fp: string;
  const dir = (): string => path.join(tmp, '.mcp_versions');
  const count = (): number => (fs.existsSync(dir()) ? fs.readdirSync(dir()).filter(n => n.endsWith('.bak')).length : 0);

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-snap-'));
    fp = path.join(tmp, 'd.design.yaml');
    fs.writeFileSync(fp, 'a: 1\n');
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('makes one for the first write', () => {
    const p = snapshot(fp);
    expect(fs.existsSync(p)).toBe(true);
    expect(count()).toBe(1);
  });

  it('does not duplicate when the design has not changed', () => {
    const first = snapshot(fp);
    for (let i = 0; i < 12; i++) expect(snapshot(fp)).toBe(first);
    expect(count()).toBe(1);
  });

  it('makes a new one as soon as the design does change', () => {
    const first = snapshot(fp);
    fs.writeFileSync(fp, 'a: 2\n');
    const second = snapshot(fp);
    expect(second).not.toBe(first);
    expect(count()).toBe(2);
    expect(fs.readFileSync(first, 'utf8')).toBe('a: 1\n');   // the older state is still recoverable
  });

  it('keeps real history through a burst of no-op calls', () => {
    // The live failure, in miniature: three real edits, then a dozen calls that
    // change nothing. All three restore points must survive.
    const marks: string[] = [];
    for (const v of ['1', '2', '3']) {
      fs.writeFileSync(fp, `a: ${v}\n`);
      marks.push(snapshot(fp));
    }
    for (let i = 0; i < 12; i++) snapshot(fp);
    expect(count()).toBe(3);
    for (const m of marks) expect(fs.existsSync(m)).toBe(true);
  });
});
