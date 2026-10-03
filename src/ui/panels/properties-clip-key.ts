// The Green screen section — the colour to take out of the clip, how much near it goes, how soft the edge.
// On the canvas the clip goes transparent where it matches, over whatever lies under it, by the same line
// the export cuts with (animation/clip-key.ts). The colour can be picked out of the picture itself.

import type { ClipLayer } from '../../animation/video-clip';
import { keyOf, DEFAULT_KEY } from '../../animation/clip-key';
import { writeClip, type ClipEnv } from './clip-commit';
import { bindClip, block, button, colour, note, range, type ClipSet, type Section } from './clip-controls';
import { pickFromClip } from './clip-pick';

/** The screen colour offered before one is chosen — the usual chroma green. */
const SCREEN = '#00b140';

export function keySection(layer: ClipLayer, env: ClipEnv): Section {
  const k = keyOf(layer);
  const on = k !== null;
  const dis = (html: string): string => (on ? html : html.replace(/<input type="range"/g, '<input type="range" disabled'));
  const html = block('Green screen',
    colour('color', 'Screen colour', (k?.color ?? SCREEN).toLowerCase())
    + dis(range('similarity', 'Takes out', k?.similarity ?? DEFAULT_KEY.similarity, 0, 1, 0.01))
    + dis(range('blend', 'Soft edge', k?.blend ?? DEFAULT_KEY.blend, 0, 1, 0.01))
    + `<div class="clip-row"><span class="prop-label"></span>${button('pick', 'Pick from clip', 'Click the screen colour in the picture')}${button('remove', 'Remove', 'Stop keying this clip', !on)}</div>`
    + note(on ? 'Keyed before the grade. Raise "Takes out" for shadows on the screen; raise "Soft edge" to feather hair.'
      : 'Pick the screen colour (or choose it) and the clip goes transparent where it matches.'), !on);

  const write = (change: Record<string, unknown>): void => {
    const now = keyOf(env.state.findLayer(env.layerId) as ClipLayer);
    writeClip(env, { key: { color: now?.color ?? SCREEN, similarity: now?.similarity ?? DEFAULT_KEY.similarity, blend: now?.blend ?? DEFAULT_KEY.blend, ...change } });
  };
  const set: ClipSet = (key, value) => write({ [key]: value });
  return {
    html,
    bind: root => bindClip(root, env, set, act => {
      if (act === 'remove') writeClip(env, { key: null });
      else if (act === 'pick') pickFromClip(env.layerId, c => write({ color: c }));
    }),
  };
}
