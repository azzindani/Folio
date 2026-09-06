import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { readYAML } from './utils';
import { inspectDesign } from '../engine';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-cycle-'));
fs.mkdirSync(path.join(root, 'p', 'designs'), { recursive: true });
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const write = (name: string, body: string): string => {
  const p = path.join(root, 'p', 'designs', name);
  fs.writeFileSync(p, body);
  return p;
};
const head = (extra = ''): string => [
  '_protocol: "design/v1"',
  'meta: { id: d, name: D, type: poster }',
  'document: { width: 100, height: 100 }',
  extra,
].join('\n');

// A group that contains itself is ordinary YAML — an anchor and an alias — and
// js-yaml resolves it into a real cyclic object. Every walker in the engine is a
// plain recursion over `layers`, so reading one blew the stack: inspect answered
// "Maximum call stack size exceeded", which names nothing and suggests nothing.
const CYCLE = head([
  'layers:',
  '  - &g',
  '    id: loop',
  '    type: group',
  '    x: 0',
  '    y: 0',
  '    width: 100',
  '    height: 100',
  '    layers:',
  '      - *g',
].join('\n'));

describe('a design that contains itself', () => {
  it('is genuinely cyclic once loaded (the fixture is real)', () => {
    const p = write('c1.design.yaml', CYCLE);
    const raw = yaml.load(fs.readFileSync(p, 'utf8')) as { layers: { layers: unknown[] }[] };
    expect(raw.layers[0]?.layers[0]).toBe(raw.layers[0]);
  });

  it('is named rather than crashed on', () => {
    const p = write('c2.design.yaml', CYCLE);
    expect(() => readYAML(p)).toThrow(/reference cycle/);
    try { readYAML(p); } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain('loop');           // which layer
      expect(m).toContain('anchor');         // and how it got there
      expect(m).not.toMatch(/call stack/);
    }
  });

  it('reaches a tool as a named failure, not a stack overflow', () => {
    // Tool functions let a load error propagate; the HTTP layer is what turns a
    // throw into {success:false, error}. What changed is the SENTENCE the caller
    // ends up with — "Maximum call stack size exceeded" told them nothing.
    const p = write('c3.design.yaml', CYCLE);
    expect(() => inspectDesign({ design_path: p })).toThrow(/reference cycle/);
    try { inspectDesign({ design_path: p }); } catch (e) {
      expect((e as Error).message).not.toMatch(/call stack/);
    }
  });

  it('leaves ordinary and deeply nested designs alone', () => {
    let inner = '{ id: leaf, type: rect, x: 0, y: 0, width: 10, height: 10 }';
    for (let i = 0; i < 200; i++) {
      inner = `{ id: g${i}, type: group, x: 0, y: 0, width: 100, height: 100, layers: [ ${inner} ] }`;
    }
    const p = write('deep.design.yaml', `${head()}\nlayers: [ ${inner} ]`);
    expect(() => readYAML(p)).not.toThrow();

    // The same object appearing TWICE as siblings is not a cycle and must pass.
    const shared = write('shared.design.yaml', head([
      'layers:',
      '  - &r { id: a, type: rect, x: 0, y: 0, width: 5, height: 5 }',
      '  - *r',
    ].join('\n')));
    expect(() => readYAML(shared)).not.toThrow();
  });
});
