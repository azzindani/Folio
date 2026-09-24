// Sweep: overprint findings on each benchmark design copy. bun scratchpad/overprint-sweep.ts <dir>
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type { DesignSpec, Layer } from '../src/schema/types';
import { overprintFindings } from '../src/mcp/engine/diagnose-overprint';

const dir = process.argv[2] ?? '.';
let total = 0;
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yaml')).sort()) {
  const spec = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')) as DesignSpec;
  const W = spec.document?.width ?? 1080, H = spec.document?.height ?? 1080;
  const surfaces: Array<[string, Layer[]]> = spec.pages?.length ? spec.pages.map(p => [p.id, p.layers ?? []]) : [['-', spec.layers ?? []]];
  for (const [id, ls] of surfaces) for (const x of overprintFindings(ls, W, H)) { total++; process.stdout.write(`${f.slice(0, 40)} ${id}: ${x.message}\n`); }
}
process.stdout.write(`total ${total}\n`);
