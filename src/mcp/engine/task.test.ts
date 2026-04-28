import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readTask, writeTask, markPageDone, getNextPendingPage, buildNextAction, createTaskFile } from './task';
import type { TaskSpec } from './task';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'folio-task-test-'));
}

function sampleSpec(pages: TaskSpec['pages'] = []): TaskSpec {
  const today = new Date().toISOString().split('T')[0];
  return {
    _protocol: 'task/v1',
    task_id: 'abc123',
    brief: 'Test brief',
    design_path: '/tmp/test.design.yaml',
    task_path: '/tmp/.tasks/test.task.yaml',
    theme: 'minimal',
    total_pages: pages.length,
    pages,
    created: today,
    modified: today,
  };
}

describe('markPageDone', () => {
  it('marks the matching page as done', () => {
    const spec = sampleSpec([
      { id: 'p1', label: 'Page 1', status: 'pending' },
      { id: 'p2', label: 'Page 2', status: 'pending' },
    ]);
    markPageDone(spec, 'p1');
    expect(spec.pages[0].status).toBe('done');
    expect(spec.pages[1].status).toBe('pending');
  });

  it('is a no-op when pageId does not exist', () => {
    const spec = sampleSpec([{ id: 'p1', label: 'Page 1', status: 'pending' }]);
    expect(() => markPageDone(spec, 'nonexistent')).not.toThrow();
    expect(spec.pages[0].status).toBe('pending');
  });
});

describe('getNextPendingPage', () => {
  it('returns first pending page', () => {
    const spec = sampleSpec([
      { id: 'p1', label: 'Page 1', status: 'done' },
      { id: 'p2', label: 'Page 2', status: 'pending' },
    ]);
    expect(getNextPendingPage(spec)?.id).toBe('p2');
  });

  it('returns undefined when all pages are done', () => {
    const spec = sampleSpec([
      { id: 'p1', label: 'Page 1', status: 'done' },
    ]);
    expect(getNextPendingPage(spec)).toBeUndefined();
  });

  it('returns undefined for empty pages', () => {
    expect(getNextPendingPage(sampleSpec([]))).toBeUndefined();
  });
});

describe('buildNextAction', () => {
  it('returns seal_design when all pages done', () => {
    const spec = sampleSpec([
      { id: 'p1', label: 'Page 1', status: 'done' },
    ]);
    const action = buildNextAction(spec, '/path/to.task.yaml');
    expect(action.tool).toBe('seal_design');
    expect(action.remaining).toBe(0);
    expect(action.params).toMatchObject({ design_path: spec.design_path });
  });

  it('returns seal_design when pages array is empty', () => {
    const action = buildNextAction(sampleSpec([]), '/task.yaml');
    expect(action.tool).toBe('seal_design');
    expect(action.remaining).toBe(0);
  });

  it('returns append_page for next pending page', () => {
    const spec = sampleSpec([
      { id: 'p1', label: 'Intro', status: 'done' },
      { id: 'p2', label: 'Main', hints: 'Make it bold', status: 'pending' },
      { id: 'p3', label: 'End', status: 'pending' },
    ]);
    const action = buildNextAction(spec, '/my.task.yaml');
    expect(action.tool).toBe('append_page');
    expect(action.remaining).toBe(2);
    expect(action.params).toMatchObject({ page_id: 'p2', label: 'Main', task_path: '/my.task.yaml' });
    expect(action.hint).toBe('Make it bold');
  });

  it('uses default hint when page has no hints', () => {
    const spec = sampleSpec([
      { id: 'p1', label: 'Overview', status: 'pending' },
    ]);
    const action = buildNextAction(spec, '/t.yaml');
    expect(action.hint).toContain('Overview');
  });
});

describe('writeTask / readTask round-trip', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('writes and reads back the spec', () => {
    const taskPath = path.join(tmpDir, 'my.task.yaml');
    const spec = sampleSpec([{ id: 'p1', label: 'P1', status: 'pending' }]);
    writeTask(taskPath, spec);
    const loaded = readTask(taskPath);
    expect(loaded._protocol).toBe('task/v1');
    expect(loaded.task_id).toBe('abc123');
    expect(loaded.pages).toHaveLength(1);
  });

  it('writeTask updates the modified date', () => {
    const taskPath = path.join(tmpDir, 'mod-date.task.yaml');
    const spec = sampleSpec();
    spec.modified = '2020-01-01'; // stale date
    writeTask(taskPath, spec);
    const today = new Date().toISOString().split('T')[0];
    expect(spec.modified).toBe(today);
  });
});

describe('createTaskFile', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates .tasks/ dir and task yaml file', () => {
    const { taskPath, spec } = createTaskFile({
      projectPath: tmpDir,
      taskName: 'My Deck',
      brief: 'A 3-page carousel',
      designPath: path.join(tmpDir, 'deck.design.yaml'),
      theme: 'dark',
      pages: [
        { label: 'Intro' },
        { label: 'Main', hints: 'Use hero image' },
        { id: 'custom_id', label: 'End' },
      ],
    });

    expect(fs.existsSync(taskPath)).toBe(true);
    expect(spec._protocol).toBe('task/v1');
    expect(spec.total_pages).toBe(3);
    expect(spec.pages[0].id).toBe('page_1');
    expect(spec.pages[2].id).toBe('custom_id');
    expect(spec.pages[1].hints).toBe('Use hero image');
    expect(spec.pages.every(p => p.status === 'pending')).toBe(true);
  });

  it('slugifies task name into file path', () => {
    const { taskPath } = createTaskFile({
      projectPath: tmpDir,
      taskName: 'Hello World Task',
      brief: 'b',
      designPath: path.join(tmpDir, 'd.design.yaml'),
      theme: 't',
      pages: [],
    });
    expect(path.basename(taskPath)).toBe('hello-world-task.task.yaml');
  });
});
