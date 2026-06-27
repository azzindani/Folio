// Folio editor — build a fresh, valid DesignSpec for "New design".
// Pure + caller-supplied timestamp so it stays testable (no Date in here).
import type { DesignSpec } from '../schema/types';

export interface BlankDesignOpts {
  width: number;
  height: number;
  unit?: string;
  dpi?: number;
  name?: string;
  /** ISO timestamp for meta.created/modified — the caller supplies it. */
  now?: string;
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
}

/** A minimal, valid single-page design: one white background rect on a blank
 *  canvas at the requested size. The starting point for a brand-new design. */
export function makeBlankDesign(opts: BlankDesignOpts): DesignSpec {
  const width = Math.max(1, Math.round(opts.width));
  const height = Math.max(1, Math.round(opts.height));
  const now = opts.now ?? '';
  const name = (opts.name ?? 'Untitled').trim() || 'Untitled';
  return {
    _protocol: 'design/v1',
    _mode: 'complete',
    meta: {
      id: `design-${slugify(name)}`,
      name,
      type: 'poster',
      created: now,
      modified: now,
      generator: 'human',
    },
    document: { width, height, unit: opts.unit ?? 'px', dpi: opts.dpi ?? 96 },
    layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width, height, fill: { type: 'solid', color: '#ffffff' } },
    ],
  } as DesignSpec;
}
