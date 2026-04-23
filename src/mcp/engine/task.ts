import * as fs from 'fs';
import * as path from 'path';
import { readYAML, writeYAML, generateId } from './utils';
import type { NextAction } from '../types';

export interface TaskPage {
  id: string;
  label: string;
  hints?: string;
  status: 'pending' | 'done';
}

export interface TaskSpec {
  _protocol: 'task/v1';
  task_id: string;
  brief: string;
  design_path: string;
  task_path: string;
  theme: string;
  total_pages: number;
  pages: TaskPage[];
  created: string;
  modified: string;
}

export function readTask(taskPath: string): TaskSpec {
  return readYAML<TaskSpec>(taskPath);
}

export function writeTask(taskPath: string, spec: TaskSpec): void {
  spec.modified = new Date().toISOString().split('T')[0];
  writeYAML(taskPath, spec);
}

export function markPageDone(spec: TaskSpec, pageId: string): void {
  const page = spec.pages.find(p => p.id === pageId);
  if (page) page.status = 'done';
}

export function getNextPendingPage(spec: TaskSpec): TaskPage | undefined {
  return spec.pages.find(p => p.status === 'pending');
}

// Compute the relay baton: tells the model exactly what tool to call next.
export function buildNextAction(spec: TaskSpec, taskPath: string): NextAction {
  const next = getNextPendingPage(spec);
  const remaining = spec.pages.filter(p => p.status === 'pending').length;

  if (!next || remaining === 0) {
    return {
      tool: 'seal_design',
      params: { design_path: spec.design_path },
      remaining: 0,
      hint: 'All pages complete. Call seal_design to finalise.',
    };
  }

  return {
    tool: 'append_page',
    params: {
      design_path: spec.design_path,
      page_id: next.id,
      label: next.label,
      task_path: taskPath,
    },
    remaining,
    hint: next.hints ?? `Create content for page "${next.label}".`,
  };
}

export function createTaskFile(opts: {
  projectPath: string;
  taskName: string;
  brief: string;
  designPath: string;
  theme: string;
  pages: { id?: string; label: string; hints?: string }[];
}): { taskPath: string; spec: TaskSpec } {
  const slug = opts.taskName.toLowerCase().replace(/\s+/g, '-');
  const tasksDir = path.join(opts.projectPath, '.tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  const taskPath = path.join(tasksDir, `${slug}.task.yaml`);
  const today = new Date().toISOString().split('T')[0];

  const spec: TaskSpec = {
    _protocol: 'task/v1',
    task_id: generateId(),
    brief: opts.brief,
    design_path: opts.designPath,
    task_path: taskPath,
    theme: opts.theme,
    total_pages: opts.pages.length,
    pages: opts.pages.map((p, i) => ({
      id: p.id ?? `page_${i + 1}`,
      label: p.label,
      hints: p.hints,
      status: 'pending',
    })),
    created: today,
    modified: today,
  };

  writeYAML(taskPath, spec);
  return { taskPath, spec };
}
