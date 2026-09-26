/**
 * What a script component must not do (phase 3, S7) — read at authoring time,
 * reported by diagnose (script_unsafe), because the runtime silently blocks it
 * and a model cannot see a component that draws nothing.
 */

import type { ScriptLayer } from '../schema/types';

export interface ScriptIssue { severity: 'error' | 'warning'; message: string }

const RULES: { re: RegExp; where: 'js' | 'markup'; severity: ScriptIssue['severity']; message: string }[] = [
  { re: /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|\bimport\s*\(|importScripts|sendBeacon/, where: 'js', severity: 'error',
    message: 'reaches the network — blocked in a component; carry the data inline (a JS array, a data: URI)' },
  { re: /<script[^>]*\bsrc\s*=|<link[^>]*\bhref\s*=\s*["']?(https?:)?\/\/|url\(\s*["']?(https?:)?\/\/|@import|\bsrc\s*=\s*["']?(https?:)?\/\//i, where: 'markup', severity: 'error',
    message: 'loads from the network (a CDN, a web font, an image URL) — blocked by the component\'s CSP; inline it as code or a data: URI' },
  { re: /\bnew\s+Date\s*\(\s*\)|(^|[^.\w])Date\s*\(\s*\)/, where: 'js', severity: 'error',
    message: 'reads the wall clock — frames would differ on every export; use the t folio.frame passes (Date.now and performance.now already read it)' },
  { re: /crypto\.getRandomValues|crypto\.randomUUID/, where: 'js', severity: 'error',
    message: 'draws unseeded randomness — use folio.random() or folio.hash(n), which repeat for the same seed' },
  { re: /\bset(Timeout|Interval)\s*\(/, where: 'js', severity: 'warning',
    message: 'uses setTimeout/setInterval, which never fire on Folio\'s clock — compute the moment from t instead' },
];

/** The problems in one script layer. */
export function lintScript(layer: ScriptLayer): ScriptIssue[] {
  const js = layer.js ?? '';
  const markup = `${layer.html ?? ''}\n${layer.css ?? ''}\n${js}`;
  const out: ScriptIssue[] = [];
  for (const r of RULES) if (r.re.test(r.where === 'js' ? js : markup)) out.push({ severity: r.severity, message: r.message });
  if (!/folio\s*\.\s*frame\s*\(|requestAnimationFrame\s*\(/.test(js)) {
    out.push({ severity: 'warning', message: 'never registers a drawing with folio.frame(t => …) — it shows one still, and no export can move it' });
  }
  if (typeof layer.width !== 'number' || typeof layer.height !== 'number') {
    out.push({ severity: 'warning', message: 'has no width/height — its box defaults to 400×300' });
  }
  return out;
}
