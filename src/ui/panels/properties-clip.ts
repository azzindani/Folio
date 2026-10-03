// The Clip inspector — what a person can do to a selected video layer, on the engine's own rules
// (animation/clip-edit.ts). This file draws the basics and the clip's sound at its edges; the look
// (grade, key, reframe, ramp, transition) is one sibling section each, listed in clipPanel().

import type { Layer } from '../../schema/types';
import { summarize, type ClipLayer } from '../../animation/video-clip';
import { writeClip, type ClipEnv } from './clip-commit';
import { bindClip, block, check, esc, num, pick, range, button, rememberBlocks, type Section, type ClipSet } from './clip-controls';
import { gradeSection } from './properties-clip-grade';
import { keySection } from './properties-clip-key';
import { reframeSection } from './properties-clip-reframe';
import { rampSection } from './properties-clip-ramp';
import { transitionSection } from './properties-clip-transition';

const secs = (ms: number | null, open = 'end'): string => (ms === null ? open : `${(ms / 1000).toFixed(2)}s`);
const info = (label: string, value: string): string => `<div class="prop-info-row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;

/** Timing readout, speed, volume, mute, loop and fit. */
function basics(layer: ClipLayer, env: ClipEnv): Section {
  const s = summarize(layer);
  const fit = String((layer as { fit?: unknown }).fit ?? 'cover');
  const html = block('Clip',
    info('Plays', `${secs(s.plays.from)} – ${secs(s.plays.until, '…')}`)
    + info('From file', `${secs(s.file.from)} – ${secs(s.file.to)}`)
    + num('speed', 'Speed', +s.speed.toFixed(3), 0.1, 8, 0.05, '×')
    + `<div class="clip-row"><span class="prop-label"></span>${[0.5, 1, 2].map(x => button(`speed:${x}`, `${x}×`, `Play at ${x}× speed`)).join('')}</div>`
    + range('volume', 'Volume', s.volume, 0, 1, 0.01)
    + check('muted', 'Mute', s.muted)
    + check('loop', 'Loop', s.loop)
    + pick('fit', 'Fit', [['cover', 'Fill the box'], ['contain', 'Fit inside'], ['fill', 'Stretch'], ['none', 'Own size']], fit));
  const set: ClipSet = (key, value) => {
    if (key === 'fit') writeClip(env, { fit: String(value) });
    else if (key === 'speed' || key === 'volume') writeClip(env, { [key]: value as number });
    else if (key === 'muted' || key === 'loop') writeClip(env, { [key]: value as boolean });
  };
  return { html, bind: root => bindClip(root, env, set, act => { if (act.startsWith('speed:')) writeClip(env, { speed: Number(act.slice(6)) }); }) };
}

/** Fades, and the sound running ahead of (J) or past (L) the picture. */
function soundEdges(layer: ClipLayer, env: ClipEnv): Section {
  const s = summarize(layer).sound ?? {};
  const html = block('Sound edges',
    num('fade_in', 'Fade in', s.fade_in_ms ?? 0, 0, 10000, 50, 'ms')
    + num('fade_out', 'Fade out', s.fade_out_ms ?? 0, 0, 10000, 50, 'ms')
    + num('audio_lead_ms', 'Leads picture', s.lead_ms ?? 0, 0, 10000, 50, 'ms')
    + num('audio_tail_ms', 'Trails picture', s.tail_ms ?? 0, 0, 10000, 50, 'ms')
    + '<div class="clip-note">Leads = a J-cut: its sound starts before its picture. Trails = an L-cut: it runs on past it.</div>', true);
  const set: ClipSet = (key, value) => { writeClip(env, { [key]: value as number }); };
  return { html, bind: root => bindClip(root, env, set) };
}

/** Every Clip section for a video layer; null for any other layer. */
export function clipPanel(layer: Layer, env: ClipEnv): Section | null {
  if (layer.type !== 'video') return null;
  const clip = layer as ClipLayer;
  const parts = [basics(clip, env), transitionSection(clip, env), rampSection(clip, env), reframeSection(clip, env), gradeSection(clip, env), keySection(clip, env), soundEdges(clip, env)];
  return {
    html: parts.map(p => p.html).join(''),
    bind: root => {
      // Each section binds to ITS block alone: two sections share control names (Grade and Reframe both have a
      // Reset, Transition and Green screen both a colour) and bound to the whole panel each would answer the other's.
      const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-clip-block]'));
      parts.forEach((p, i) => { const own = blocks[i]; if (own) p.bind(own); });
      rememberBlocks(root);
    },
  };
}
