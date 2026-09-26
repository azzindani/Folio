/**
 * Script components in the layout review (phase 3 close-out, C4). The review
 * measures raster renders, and resvg draws no <foreignObject> — so a script
 * piece was read as an empty canvas ("69% of the canvas is one empty area"
 * over a walking figure). The review now poses every component at the moment
 * it measures (layout-review.ts, layout-review-motion.ts); this captures those
 * moments first, so the review draws the component's picture.
 *
 * Captured BEFORE the tool runs, not by running it twice: a gate heals (writes)
 * before it reviews, and a second pass would heal again and lose its report.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer } from '../../schema/types';
import { reviewLayout } from './layout-review';
import { withMotion } from './layout-review-motion';
import { captureScripts } from './script-capture';
import { collectScripts, hasScripts } from '../../scripting/script-frames';
import { readYAML, resolveDesignPath } from './utils';

const allLayers = (s: DesignSpec): Layer[] => [...(s.layers ?? []), ...(s.pages ?? []).flatMap(p => p.layers ?? [])];

/** Capture the component frames a review of `spec` draws; the keys to drop once the review is written. */
export async function captureForReview(spec: DesignSpec, projectDir: string, pageId?: string): Promise<{ notes: string[]; keys: string[] }> {
  if (!hasScripts(allLayers(spec))) return { notes: [], keys: [] };
  const { missing } = collectScripts(() => withMotion(reviewLayout(spec, projectDir, pageId), spec, projectDir, pageId));
  return captureScripts(missing);
}

/** The same for a design on disk — what diagnose_design's review and gate ask for. */
export async function captureDesignForReview(args: { design_path?: unknown; project_path?: unknown; page_id?: unknown }): Promise<{ notes: string[]; keys: string[] }> {
  if (typeof args.design_path !== 'string') return { notes: [], keys: [] };
  const projectPath = typeof args.project_path === 'string' ? args.project_path : undefined;
  const dPath = resolveDesignPath(args.design_path, projectPath);
  if (!fs.existsSync(dPath)) return { notes: [], keys: [] };
  let spec: DesignSpec;
  try { spec = readYAML<DesignSpec>(dPath); } catch { return { notes: [], keys: [] }; }
  return captureForReview(spec, projectPath ?? path.dirname(path.dirname(dPath)), typeof args.page_id === 'string' ? args.page_id : undefined);
}
