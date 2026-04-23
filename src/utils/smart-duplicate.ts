import type { Layer } from '../schema/types';

export interface DuplicateOptions {
  mode: 'offset' | 'grid';
  offsetX?: number;
  offsetY?: number;
  cols?: number;
  rows?: number;
  colGap?: number;
  rowGap?: number;
}

let idCounter = 0;
const nextId = () => `dup_${Date.now()}_${++idCounter}`;

export function smartDuplicate(layers: Layer[], opts: DuplicateOptions): Layer[] {
  const result: Layer[] = [];

  if (opts.mode === 'offset') {
    const dx = opts.offsetX ?? 20;
    const dy = opts.offsetY ?? 20;
    for (const l of layers) {
      result.push(cloneLayer(l, dx, dy));
    }
    return result;
  }

  // Grid mode
  const cols = Math.max(1, opts.cols ?? 3);
  const rows = Math.max(1, opts.rows ?? 3);
  const cg = opts.colGap ?? 10;
  const rg = opts.rowGap ?? 10;

  for (const l of layers) {
    const w = typeof l.width  === 'number' ? l.width  : 100;
    const h = typeof l.height === 'number' ? l.height : 100;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === 0 && c === 0) continue; // skip original position
        result.push(cloneLayer(l, c * (w + cg), r * (h + rg)));
      }
    }
  }

  return result;
}

function cloneLayer(l: Layer, dx: number, dy: number): Layer {
  const clone = JSON.parse(JSON.stringify(l)) as unknown as Record<string, unknown>;
  clone['id'] = nextId();
  clone['x'] = ((l as unknown as Record<string, unknown>)['x'] as number ?? 0) + dx;
  clone['y'] = ((l as unknown as Record<string, unknown>)['y'] as number ?? 0) + dy;
  clone['z'] = ((l as unknown as Record<string, unknown>)['z'] as number ?? 0) + 1;
  return clone as unknown as Layer;
}
