// The Grade section — exposure, contrast, saturation, warmth, tint and a LUT, on the numbers the export
// runs (animation/clip-color.ts): the canvas shows them as an SVG filter, ffmpeg as the same matrix.
// A LUT is applied by the export only; the canvas cannot draw a 3D lookup exactly, and says so.

import type { ClipLayer } from '../../animation/video-clip';
import { colorOf, type ClipColor } from '../../animation/clip-color';
import { writeClip, type ClipEnv } from './clip-commit';
import { bindClip, block, button, esc, note, range, type ClipSet, type Section } from './clip-controls';
import { openProject, projectAssets } from './clip-assets';

const SLIDERS = [
  ['exposure', 'Exposure', -3, 3, 0.05, ' EV'], ['contrast', 'Contrast', -1, 1, 0.01, ''], ['saturation', 'Saturation', -1, 1, 0.01, ''],
  ['temperature', 'Warmth', -1, 1, 0.01, ''], ['tint', 'Tint', -1, 1, 0.01, ''],
] as const;

type Numeric = Exclude<keyof ClipColor, 'lut'>;

/** The grade with one value changed: a zero is no change, so it leaves the file; an empty grade is no grade. */
function withChange(env: ClipEnv, change: Partial<ClipColor>): ClipColor | null {
  const now = colorOf(env.state.findLayer(env.layerId) as ClipLayer) ?? {};
  const next: Record<string, unknown> = { ...now, ...change };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === 0 || next[k] === '') delete next[k];
  return Object.keys(next).length ? next as ClipColor : null;
}

export function gradeSection(layer: ClipLayer, env: ClipEnv): Section {
  const c = colorOf(layer) ?? {};
  const lut = c.lut ?? '';
  const html = block('Grade',
    SLIDERS.map(([k, label, lo, hi, step, unit]) => range(k, label, c[k as Numeric] ?? 0, lo, hi, step, 2, unit)).join('')
    + `<div class="clip-row"><span class="prop-label">LUT</span><select class="clip-input" data-clip="lut" data-have="${esc(lut)}" aria-label="LUT">`
    + `<option value="">None</option>${lut ? `<option value="${esc(lut)}" selected>${esc(lut.split('/').pop() ?? lut)}</option>` : ''}</select></div>`
    + `<div class="clip-row"><span class="prop-label"></span>${button('reset', 'Reset grade', 'Take the whole grade off this clip', !colorOf(layer))}</div>`
    + note('A LUT (a .cube in assets/docs) is applied in the export; the canvas previews the five sliders.'), !colorOf(layer));
  const set: ClipSet = (key, value) => {
    const change = key === 'lut' ? { lut: String(value) } : { [key]: value as number };
    writeClip(env, { color: withChange(env, change) });
  };
  return {
    html,
    bind: root => {
      bindClip(root, env, set, act => { if (act === 'reset') writeClip(env, { color: null }); });
      // The project's .cube files fill the picker once the listing arrives.
      const select = root.querySelector<HTMLSelectElement>('select[data-clip="lut"]');
      if (!select || !openProject()) return;
      void projectAssets().then(assets => {
        const cubes = assets.filter(a => /\.cube$/i.test(a.path)).map(a => a.path);
        if (!select.isConnected || !cubes.length) return;
        const have = select.dataset['have'] ?? '';
        select.innerHTML = `<option value="">None</option>` + [...new Set([...(have ? [have] : []), ...cubes])]
          .map(p => `<option value="${esc(p)}"${p === have ? ' selected' : ''}>${esc(p.split('/').pop() ?? p)}</option>`).join('');
      });
    },
  };
}
