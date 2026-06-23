import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createFolder, renameFolder, deleteFolder, safeFolderName } from './library-folders';

describe('library folders (project-directory file ops)', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-fld-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('createFolder makes a project dir + designs/ + project.yaml', () => {
    const r = createFolder(root, 'My Posters');
    expect(r.success).toBe(true);
    expect(r.project).toBe('My Posters');
    expect(fs.existsSync(path.join(root, 'My Posters', 'designs'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'My Posters', 'project.yaml'))).toBe(true);
  });

  it('createFolder rejects a duplicate and an unsafe name', () => {
    expect(createFolder(root, 'dup').success).toBe(true);
    expect(createFolder(root, 'dup').success).toBe(false);                 // already exists
    expect(createFolder(root, '../escape').success).toBe(false);            // traversal
    expect(createFolder(root, '.hidden').success).toBe(false);             // dot-prefixed
    expect(createFolder(root, 'a/b').success).toBe(false);                 // separator
  });

  it('renameFolder moves the dir and keeps designs inside', () => {
    createFolder(root, 'old');
    fs.writeFileSync(path.join(root, 'old', 'designs', 'a.design.yaml'), 'meta:\n  name: A\n');
    const r = renameFolder(root, 'old', 'new');
    expect(r.success).toBe(true);
    expect(fs.existsSync(path.join(root, 'old'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'new', 'designs', 'a.design.yaml'))).toBe(true);
  });

  it('renameFolder refuses a collision and a reserved name', () => {
    createFolder(root, 'one'); createFolder(root, 'two');
    expect(renameFolder(root, 'one', 'two').success).toBe(false);          // target exists
    expect(renameFolder(root, '.trash', 'x').success).toBe(false);          // reserved
  });

  it('deleteFolder moves the dir to a recoverable root .trash', () => {
    createFolder(root, 'gone');
    fs.writeFileSync(path.join(root, 'gone', 'designs', 'd.design.yaml'), 'meta:\n  name: D\n');
    const r = deleteFolder(root, 'gone');
    expect(r.success).toBe(true);
    expect(fs.existsSync(path.join(root, 'gone'))).toBe(false);
    expect(r.trashed_path && fs.existsSync(r.trashed_path)).toBe(true);     // recoverable
    expect(fs.existsSync(path.join(r.trashed_path!, 'designs', 'd.design.yaml'))).toBe(true);
  });

  it('safeFolderName validates segments', () => {
    expect(safeFolderName('Good Name_1-2')).toBe('Good Name_1-2');
    expect(safeFolderName('  spaced  ')).toBe('spaced');
    expect(safeFolderName('../x')).toBeNull();
    expect(safeFolderName('.dot')).toBeNull();
    expect(safeFolderName('a/b')).toBeNull();
    expect(safeFolderName('')).toBeNull();
    expect(safeFolderName('x'.repeat(81))).toBeNull();
  });
});
