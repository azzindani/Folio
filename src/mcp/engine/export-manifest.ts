// Make an exported HTML file say where it came from.
//
// Review PART III, item 4: "Every dashboard header embeds spec.json +
// data_hash so next agent can get_spec → patch_spec → re-render instead of
// starting over." Today a Folio HTML export is a dead end — it carries the
// pixels and nothing else, so an agent handed the artifact cannot find the
// design that made it, cannot tell whether that design has moved on since, and
// cannot tell what the thing was authored FROM. Its only option is to rebuild,
// which is the L2 behaviour the whole review is arguing against.
//
// What goes in is deliberately the SPARSE view — the authored `_spec` blocks,
// the model's own intent — not the expanded layer tree. The expanded tree is
// output; re-embedding it would double the file to say nothing new. This is
// the same sparse-then-detail split `get_spec` already makes.
//
// `source_hash` is the design's bytes at export time. It answers the question
// that actually matters when someone finds an artifact later: is this still
// what the design says, or has the design moved on since this was rendered?
import * as crypto from 'crypto';
import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import { collectAuthoredSpecs } from '../design-spec';

export const MANIFEST_ID = 'folio-manifest';

export interface ExportManifest {
  protocol: 'folio/export-manifest@1';
  exported: string;
  design: { id?: string; name?: string; type?: string; width?: number; height?: number; pages?: number };
  source: { path: string; hash?: string };
  specs: Array<{ layer_id: string; type: string; page_id?: string; spec: Record<string, unknown> }>;
  round_trip: string;
}

/** sha256 of the design file as it stood when this artifact was rendered. */
export function sourceHash(designPath: string): string | undefined {
  try { return crypto.createHash('sha256').update(fs.readFileSync(designPath)).digest('hex').slice(0, 32); }
  catch { return undefined; }
}

export function buildManifest(spec: DesignSpec, designPath: string): ExportManifest {
  const pages = spec.pages ?? [];
  const specs = pages.length
    ? pages.flatMap(p => collectAuthoredSpecs((p.layers ?? []) as Layer[], p.id))
    : collectAuthoredSpecs((spec.layers ?? []) as Layer[]);
  const hash = sourceHash(designPath);
  return {
    protocol: 'folio/export-manifest@1',
    exported: new Date().toISOString(),
    design: {
      id: spec.meta?.id, name: spec.meta?.name, type: spec.meta?.type,
      width: spec.document?.width, height: spec.document?.height,
      ...(pages.length ? { pages: pages.length } : {}),
    },
    source: { path: designPath, ...(hash ? { hash } : {}) },
    specs,
    round_trip: 'manage_design {op:"get_spec", design_path} reads these back live; '
      + 'edit_layer {op:"patch_spec", layer_id, changes} edits one and re-renders in place. '
      + 'Compare source.hash against the design on disk to tell whether it has moved on since this render.',
  };
}

/** JSON is escaped so it cannot terminate the script element early. */
export function manifestScript(manifest: ExportManifest): string {
  const json = JSON.stringify(manifest).replace(/</g, '\\u003c');
  return `<script type="application/json" id="${MANIFEST_ID}">${json}</script>`;
}

/**
 * Insert the manifest before </head>, or before </body> if there is no head.
 * A document with neither is returned untouched: an export that cannot carry
 * provenance is still a valid export, and corrupting the artifact to attach a
 * note about the artifact would be a poor trade.
 */
export function embedManifest(html: string, manifest: ExportManifest): string {
  const tag = manifestScript(manifest);
  const head = html.toLowerCase().lastIndexOf('</head>');
  if (head !== -1) return html.slice(0, head) + tag + html.slice(head);
  const body = html.toLowerCase().lastIndexOf('</body>');
  if (body !== -1) return html.slice(0, body) + tag + html.slice(body);
  return html;
}
