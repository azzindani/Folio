// Folio schema — the script component layer (phase 3, S7). Split from layers.ts,
// which re-exports it through the Layer union.
import type { BaseLayer } from './layers';

/**
 * A self-contained HTML/CSS/JS component on Folio's clock: it draws the moment
 * `t` it is asked for (folio.frame(t => …)), with randomness from a seed — so
 * the editor, the HTML export and every captured video frame agree. No network
 * (CSP), no wall clock (Date.now/performance.now read `t`), no free-running
 * timers; a canvas inside is fine. Runtime: scripting/script-runtime.ts.
 */
export interface ScriptLayer extends BaseLayer {
  type: 'script';
  /** Markup inside the component's box (a <canvas>, some divs…). */
  html?: string;
  css?: string;
  /** The component's code: register the drawing with folio.frame(t => …). */
  js: string;
  /** Seed for folio.random / folio.hash (default: from the layer id). */
  seed?: number;
  /** How long it plays, ms — the scene is at least this long. */
  duration?: number;
  /** Replay its clock every `duration` ms. */
  loop?: boolean;
  /** Set by the frame sampler, never authored: the page time a raster render draws it at (scripting/script-frames.ts). */
  script_t?: number;
}
