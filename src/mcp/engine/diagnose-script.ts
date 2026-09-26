// diagnose: script components (phase 3, S7) — what their runtime silently blocks
// (network, wall clock, unseeded randomness, free timers), named per layer.
import type { Layer, ScriptLayer } from '../../schema/types';
import type { Finding } from './diagnose';
import { lintScript } from '../../scripting/script-lint';

export function scriptFindings(layers: Layer[]): Finding[] {
  const out: Finding[] = [];
  const walk = (ls: Layer[]): void => {
    for (const l of ls) {
      if (l.type === 'script') {
        for (const i of lintScript(l as ScriptLayer)) {
          out.push({ code: 'script_unsafe', severity: i.severity, message: `"${l.id}" ${i.message}.`, layers: [l.id],
            fix: 'get_engine_guide {section:"source"} → script components: draw the moment t, seeded randomness, no network.' });
        }
      }
      const kids = (l as Layer & { layers?: Layer[] }).layers;
      if (Array.isArray(kids)) walk(kids);
    }
  };
  walk(layers);
  return out;
}
