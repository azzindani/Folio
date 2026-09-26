// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { compactYAML } from './yaml-compact';

const SWEEP = path.join(__dirname, '../../scratchpad/bench-sweep');
const designs = fs.existsSync(SWEEP) ? fs.readdirSync(SWEEP).filter(f => f.endsWith('.design.yaml')) : [];

describe('compact YAML', () => {
  it('parses back to exactly the same data, awkward values included', () => {
    const data = {
      _protocol: 'design/v1', meta: { id: 'm', created: '2026-09-26', name: 'A: "quoted" # not a comment' },
      layers: [
        { id: 'a', type: 'rect', 'y': 0, on: true, x: -1.5, fill: '#E4572E', nothing: null, empty: '', list: [], map: {} },
        { id: 'js', type: 'script', js: 'folio.frame(t => {\n  g.clearRect(0, 0, 10, 10);\n})\n', html: '  leading spaces\nsecond', tags: ['x', 'y', 'n'] },
        { id: 'deep', layers: [{ id: 'k', animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }], playback: { duration: 400 } } }] },
        [['nested', 'lists'], { in: 'lists' }],
        'Ünïcødé · — “quotes”',
      ],
    };
    expect(yaml.load(compactYAML(data))).toEqual(data);
  });

  it('writes a small mapping on one line and keeps structure in blocks', () => {
    const text = compactYAML({ layers: [{ id: 'bg', type: 'rect', x: 0, 'y': 0, width: 1080, height: 1080, fill: '#FAF5EC' }] });
    expect(text).toBe("layers:\n- {id: bg, type: rect, x: 0, 'y': 0, width: 1080, height: 1080, fill: '#FAF5EC'}\n");
  });

  it.skipIf(!designs.length)('round-trips every benchmark design, in fewer lines', () => {
    let before = 0, after = 0;
    for (const f of designs) {
      const text = fs.readFileSync(path.join(SWEEP, f), 'utf8');
      const data = yaml.load(text);
      const out = compactYAML(data);
      expect(yaml.load(out), f).toEqual(data);
      before += text.split('\n').length;
      after += out.split('\n').length;
    }
    expect(after).toBeLessThan(before * 0.6);
  });
});
