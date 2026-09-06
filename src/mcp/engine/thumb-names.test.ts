import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { thumbPrefix, projectThumbPrefix, pruneProjectThumbs, renameProjectThumbs } from './thumb-names';
import { renameFolder, deleteFolder } from './library-folders';

// A thumbnail is named <project>__<file>.<fingerprint>.png in one flat
// directory, so the project name lives in the FILEname and does not move when
// the folder does. Measured on the deployed box: 81 of 371 cached thumbnails
// belonged to projects that had been binned. library-gallery had a pruner all
// along — it prunes one design's older renderer generations — but the folder
// ops that delete and rename projects called nothing at all.

let root = '';
const thumbs = (): string => path.join(root, '.library', 'thumbs');
const put = (name: string): void => fs.writeFileSync(path.join(thumbs(), name), 'png');
const ls = (): string[] => fs.readdirSync(thumbs()).sort();

function project(name: string, designs: string[]): void {
  fs.mkdirSync(path.join(root, name, 'designs'), { recursive: true });
  for (const d of designs) {
    fs.writeFileSync(path.join(root, name, 'designs', `${d}.design.yaml`), 'meta: {}\n');
    put(`${name}__${d}_design_yaml.abc123.png`);
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-thumbnames-'));
  fs.mkdirSync(thumbs(), { recursive: true });
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('the naming rule', () => {
  it('puts the project name in the filename, ahead of the design', () => {
    const p = thumbPrefix('/projects/my proj/designs/a b.design.yaml');
    expect(p).toBe('my_proj__a_b_design_yaml.');
    expect(p.startsWith(projectThumbPrefix('my proj'))).toBe(true);
  });

  it('does not confuse a project with one whose name extends it', () => {
    // "sweep2__x.png" must not be swept away with project "sweep".
    expect(projectThumbPrefix('sweep')).toBe('sweep__');
    expect('sweep2__x.png'.startsWith(projectThumbPrefix('sweep'))).toBe(false);
  });
});

describe('pruneProjectThumbs', () => {
  it('removes only the named project thumbnails', () => {
    project('alpha', ['one', 'two']);
    project('alphabet', ['three']);
    expect(pruneProjectThumbs(root, 'alpha')).toBe(2);
    expect(ls()).toEqual(['alphabet__three_design_yaml.abc123.png']);
  });

  it('is silent when there is no cache at all', () => {
    fs.rmSync(thumbs(), { recursive: true, force: true });
    expect(pruneProjectThumbs(root, 'alpha')).toBe(0);
  });
});

describe('renameProjectThumbs', () => {
  it('carries the cache across, keeping the design half of the name', () => {
    project('old', ['one', 'two']);
    expect(renameProjectThumbs(root, 'old', 'new')).toBe(2);
    expect(ls()).toEqual(['new__one_design_yaml.abc123.png', 'new__two_design_yaml.abc123.png']);
  });

  it('drops the stale copy rather than clobbering one already at the destination', () => {
    project('old', ['one']);
    put('new__one_design_yaml.abc123.png');
    renameProjectThumbs(root, 'old', 'new');
    expect(ls()).toEqual(['new__one_design_yaml.abc123.png']);
  });

  it('does nothing when the slug is unchanged', () => {
    project('my proj', ['one']);
    expect(renameProjectThumbs(root, 'my proj', 'my/proj')).toBe(0);
  });
});

describe('the folder ops actually call them', () => {
  // The point of the fix. Both of these passed their own tests before — they
  // moved the directory correctly — while leaving the cache behind untouched.
  it('deleting a project takes its thumbnails with it', () => {
    project('gone', ['a', 'b']);
    project('stays', ['c']);
    expect(deleteFolder(root, 'gone').success).toBe(true);
    expect(ls()).toEqual(['stays__c_design_yaml.abc123.png']);
  });

  it('renaming a project renames its thumbnails', () => {
    project('before', ['a']);
    expect(renameFolder(root, 'before', 'after').success).toBe(true);
    expect(ls()).toEqual(['after__a_design_yaml.abc123.png']);
  });

  it('a failed delete leaves the cache alone', () => {
    project('kept', ['a']);
    expect(deleteFolder(root, 'missing').success).toBe(false);
    expect(ls()).toEqual(['kept__a_design_yaml.abc123.png']);
  });

  it('a failed rename leaves the cache alone', () => {
    project('one', ['a']);
    project('two', ['b']);
    expect(renameFolder(root, 'one', 'two').success).toBe(false); // destination exists
    expect(ls()).toEqual(['one__a_design_yaml.abc123.png', 'two__b_design_yaml.abc123.png']);
  });
});
