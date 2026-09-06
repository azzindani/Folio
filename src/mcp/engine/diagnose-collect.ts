// What is wrong with this design — the ONE composition of the checks.
//
// diagnose_design assembles its findings from four sources: the geometry/
// contrast analysis per surface, the image audit, the flat-text-style walk, and
// (since the group-alias find) the renderer itself. Nothing else could ask the
// same question without restating that list, and one caller very much needed to.
//
// `seal_design` is the last gate before a design is called complete and its
// share link handed to a user. It refuses a blank poster and a blank carousel
// page, runs its rescue sweep — and never consults the diagnosis. Measured on
// the live corpus: 7 of 276 designs are `_mode: complete` with errors their own
// diagnostic reports, one of them with 38 clipped layers. Live, end to end:
//
//     diagnose_design → "1 error(s) + 0 warning(s) to fix."
//     seal_design     → status: sealed, remaining: 0,
//                       "give the user this link EXACTLY as written"
//
// Restating the list here would have been the session's most-repeated mistake
// (a rule with two implementations, drifting), so both callers share this.

import type { DesignSpec, Layer } from '../../schema/types';
import { analyzeLayers, flatTextStyleFindings, type Finding } from './diagnose';
import { auditImageAssets } from './asset-resolve';
import { renderFailureFindings } from './diagnose-render';

export type PageFinding = Finding & { page?: string };

/**
 * Every finding for `spec`, across each surface it has.
 *
 * `pageId` scopes to one page of a paged design — the renderer audit is skipped
 * there, because it draws the whole document and would report other pages.
 */
export function collectFindings(
  spec: DesignSpec,
  designPath: string,
  projectPath?: string,
  pageId?: string,
): PageFinding[] {
  const W = spec.document?.width ?? 1080, H = spec.document?.height ?? 1080;
  const run = (layers: Layer[] | undefined, page?: string): PageFinding[] =>
    analyzeLayers(layers ?? [], W, H).map(f => (page ? { ...f, page } : f));

  const findings: PageFinding[] = [];
  if (pageId && spec.pages) {
    findings.push(...run(spec.pages.find(p => p.id === pageId)?.layers, pageId));
  } else if (spec.pages) {
    for (const page of spec.pages) findings.push(...run(page.layers, page.id));
  } else {
    findings.push(...run(spec.layers));
  }

  // Unresolvable image srcs (blank in exports) + distortion/upscale.
  findings.push(...auditImageAssets(spec, designPath, projectPath));
  // Styling written at layer level that the renderer ignores (see diagnose.ts).
  findings.push(...flatTextStyleFindings(spec));
  // Ask the renderer whether every layer actually draws.
  if (!pageId) findings.push(...renderFailureFindings(spec));
  return findings;
}

/** Just the errors — what a gate needs to decide whether a design is finished. */
export function errorFindings(
  spec: DesignSpec,
  designPath: string,
  projectPath?: string,
): PageFinding[] {
  return collectFindings(spec, designPath, projectPath).filter(f => f.severity === 'error');
}
