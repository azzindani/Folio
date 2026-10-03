// The Reframe section — which part of the footage the box keeps: where it rests (focus, zoom) and, with pan
// keys, how it moves (animation/clip-crop.ts). Sliders and the canvas drag follow one rule (clip-reframe.ts):
// no keys → the resting crop; keys → the key at the playhead.

import type { ClipLayer } from '../../animation/video-clip';
import { cropAt, panKeys, baseCrop, MAX_ZOOM } from '../../animation/clip-crop';
import { writeClip, type ClipEnv } from './clip-commit';
import { bindClip, block, button, note, range, type ClipSet, type Section } from './clip-controls';
import { addKeyEdit, cropEdit, isReframing, playheadFileMs, reframeOnCanvas, stopReframing } from './clip-reframe';

const secs = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;

export function reframeSection(layer: ClipLayer, env: ClipEnv): Section {
  const keys = panKeys(layer);
  const ms = playheadFileMs(layer);
  const c = cropAt(layer, ms), base = baseCrop(layer);
  const framed = base.zoom !== 1 || base.focus[0] !== 0.5 || base.focus[1] !== 0.5 || keys.length > 0;
  const fits = ((layer as { fit?: unknown }).fit ?? 'cover') === 'cover';
  const rows = keys.map((k, i) => {
    const at = cropAt({ ...layer, video: { ...layer.video, pan: [k] } } as ClipLayer, k.at_ms);
    return `<div class="clip-row"><span class="prop-label">file ${secs(k.at_ms)}</span><span class="clip-val" style="flex:1;text-align:left">${at.focus[0].toFixed(2)}, ${at.focus[1].toFixed(2)} · ${at.zoom.toFixed(2)}×</span>`
      + `<button type="button" class="btn btn-sm" data-clip-act="key-del:${i}" title="Remove this key">×</button></div>`;
  }).join('');
  const html = block('Reframe',
    range('fx', keys.length ? 'Focus X here' : 'Focus X', c.focus[0], 0, 1, 0.01)
    + range('fy', keys.length ? 'Focus Y here' : 'Focus Y', c.focus[1], 0, 1, 0.01)
    + range('zoom', keys.length ? 'Zoom here' : 'Zoom', c.zoom, 1, MAX_ZOOM, 0.01, 2, '×')
    + `<div class="clip-row"><span class="prop-label"></span>${button('canvas', isReframing() ? 'Done reframing' : 'Reframe on canvas', 'Drag the picture to pan it, scroll to zoom')}${button('key-add', '◆ Key here', 'Keep this crop at the playhead — the frame then moves between keys')}${button('reset', 'Reset', 'Back to the centred, unzoomed picture', !framed)}</div>`
    + (keys.length ? `<div class="clip-note">Pan keys sit on the footage (file time), so they stay with it when the clip is trimmed or moved. Reframing now edits the key at the playhead.</div>${rows}` : '')
    + (fits ? note(isReframing() ? 'Drag the picture to pan, scroll to zoom. Esc or a click outside ends it.' : 'Pan and zoom inside the footage — a wide shot reframed for a tall box.') : note('Reframing applies to a clip that fills its box (Fit: Fill the box).')), !framed);

  const set: ClipSet = (key, value) => {
    const l = env.state.findLayer(env.layerId) as ClipLayer | undefined;
    if (!l) return;
    const at = playheadFileMs(l), cur = cropAt(l, at);
    const next = key === 'zoom' ? { focus: cur.focus, zoom: value as number }
      : { focus: (key === 'fx' ? [value as number, cur.focus[1]] : [cur.focus[0], value as number]) as [number, number], zoom: cur.zoom };
    writeClip(env, cropEdit(l, next, at));
  };
  return {
    html,
    bind: root => bindClip(root, env, set, act => {
      const l = env.state.findLayer(env.layerId) as ClipLayer | undefined;
      if (!l) return;
      if (act === 'canvas') { if (isReframing()) stopReframing(); else reframeOnCanvas(env, () => env.refresh()); env.refresh(); }
      else if (act === 'key-add') writeClip(env, addKeyEdit(l, playheadFileMs(l)));
      else if (act === 'reset') writeClip(env, { focus: null, zoom: null, pan: null });
      else if (act.startsWith('key-del:')) {
        const left = panKeys(l).filter((_, i) => i !== Number(act.slice(8)));
        writeClip(env, { pan: left.length ? left : null });
      }
    }),
  };
}
