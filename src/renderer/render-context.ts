import type { DataSource } from '../schema/types';

// Editor-only preview data context.
//
// Interactive report widgets (interactive_chart / interactive_table) bind to a
// `data_ref` that names a dataset in `report.data.sources`. In the EXPORTED
// HTML those datasets are loaded + drawn by the Chart.js/Tabulator runtime; in
// the studio canvas there is no runtime, so the renderers need a way to reach
// the inline rows declared in the design itself to draw a real preview.
//
// canvas.ts populates this before each render pass (scoped to the active
// design); the renderers read it at draw time. Only `inline` sources carry
// rows at design time — external (csv/api/…) sources resolve to [] and the
// renderers fall back to a representative sample so the shape is still visible.

let sources = new Map<string, Record<string, unknown>[]>();
let accent = '#6c5ce7';

export function setPreviewContext(opts: { sources?: DataSource[]; accent?: string }): void {
  sources = new Map();
  if (opts.sources) {
    for (const s of opts.sources) {
      if (Array.isArray(s.rows)) sources.set(s.id, s.rows);
    }
  }
  accent = opts.accent && opts.accent.trim() ? opts.accent : '#6c5ce7';
}

export function clearPreviewContext(): void {
  sources = new Map();
  accent = '#6c5ce7';
}

/** Resolve a widget data_ref ("ds" or "$data.ds") to its inline rows, or [] if unavailable. */
export function getPreviewRows(dataRef?: string): Record<string, unknown>[] {
  if (!dataRef) return [];
  const id = dataRef.startsWith('$data.') ? dataRef.slice(6) : dataRef;
  return sources.get(id) ?? [];
}

export function getPreviewAccent(): string {
  return accent;
}
